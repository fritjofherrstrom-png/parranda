"use strict";

/**
 * A rate gate shared by every process that mounts the same directory.
 *
 * A provider's limit can be per application rather than per process: the
 * Nominatim usage policy allows at most one request per second for all of an
 * application's traffic, and the web process and the scout worker reach it
 * from the same machine. Each process keeping its own gate lets them call in
 * the same instant. Here the next free slot and any provider cooldown live in
 * one small state file, updated under an exclusive lock directory (mkdir is
 * atomic on POSIX filesystems, including a Docker named volume).
 *
 * Busy or abandoned locks fail closed. Age cannot distinguish a crashed owner
 * from a live process paused by I/O, nor can PIDs identify owners across Docker
 * namespaces. Recovery requires maintenance after every participant is stopped.
 * Dispatch and any response cooldown are committed under the same lock. A
 * sleeper rechecks the state before sending; future reservations alone cannot
 * protect against delayed wakeups or newly learned cooldowns.
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const DEFAULT_MAX_LOCK_WAIT_MS = 3000;
const LOCK_RETRY_MS = 15;

function createSharedRateGate({
  dir,
  name,
  intervalMs,
  now = () => Date.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  maxLockWaitMs = DEFAULT_MAX_LOCK_WAIT_MS,
} = {}) {
  if (typeof dir !== "string" || !dir || typeof name !== "string" || !/^[a-z0-9_-]+$/i.test(name)) {
    throw new TypeError("shared_rate_gate_invalid_config");
  }
  const lockPath = path.join(dir, `${name}.lock`);
  const statePath = path.join(dir, `${name}.gate.json`);
  const interval = Math.max(0, Math.floor(Number(intervalMs) || 0));

  async function withLock(update) {
    await fs.mkdir(dir, { recursive: true });
    const startedAt = Date.now();
    for (;;) {
      try {
        await fs.mkdir(lockPath);
        break;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        if (Date.now() - startedAt > maxLockWaitMs) throw new Error("shared_rate_gate_busy");
        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
      }
    }
    // A unique owner file means releasing our lock can never remove another
    // owner's nonempty directory, including after an external manual replacement.
    const ownerPath = path.join(lockPath, `${process.pid}-${randomUUID()}.owner`);
    let retainLock = false;
    let temp;
    try {
      await fs.writeFile(ownerPath, "", { flag: "wx" });
      const state = await readState();
      // If dispatch occurred but its state could not be committed, releasing
      // the lock could permit a second send. Preserve it until safe maintenance.
      retainLock = true;
      const result = await update(state);
      const confirmOwner = () => fs.access(ownerPath).catch(() => {
        throw new Error("shared_rate_gate_owner_lost");
      });
      await confirmOwner();
      temp = `${statePath}.${process.pid}.${randomUUID()}`;
      await fs.writeFile(temp, JSON.stringify(state));
      await confirmOwner();
      await fs.rename(temp, statePath);
      retainLock = false;
      return result;
    } finally {
      if (temp) await fs.unlink(temp).catch(() => {});
      if (!retainLock) {
        await fs.unlink(ownerPath).catch(() => {});
        await fs.rmdir(lockPath).catch(() => {});
      }
    }
  }

  async function readState() {
    try {
      const parsed = JSON.parse(await fs.readFile(statePath, "utf8"));
      if (!Number.isFinite(parsed?.next) || parsed.next < 0 ||
          !Number.isFinite(parsed?.cooldownUntil) || parsed.cooldownUntil < 0) {
        throw new Error("shared_rate_gate_state_invalid");
      }
      return { next: parsed.next, cooldownUntil: parsed.cooldownUntil };
    } catch (error) {
      if (error?.code === "ENOENT") return { next: 0, cooldownUntil: 0 };
      throw new Error("shared_rate_gate_state_invalid", { cause: error });
    }
  }

  return {
    // No future send reservation: recheck after every sleep, then own the lock
    // through the bounded request and persistence of its provider cooldown.
    async run(operation, { earliest = 0 } = {}) {
      for (;;) {
        const outcome = await withLock(async state => {
          const current = now();
          const start = Math.max(current, Number(earliest) || 0, state.next, state.cooldownUntil);
          if (start > current) return { wait: start - current };
          state.next = current + interval;
          const value = await operation({
            noteCooldown(until) {
              if (Number.isFinite(until)) state.cooldownUntil = Math.max(state.cooldownUntil, until);
            },
            noteStarted(at) {
              if (Number.isFinite(at)) state.next = Math.max(state.next, at + interval);
            },
          });
          return { value };
        });
        if (outcome.wait != null) await sleep(outcome.wait);
        else return outcome.value;
      }
    },
    // The earliest time this caller may send, no earlier than `earliest`.
    reserve(earliest = 0) {
      return withLock((state) => {
        const slot = Math.max(now(), Number(earliest) || 0, state.next, state.cooldownUntil);
        state.next = slot + interval;
        return slot;
      });
    },
    // A cooldown the provider asked for holds every process sharing the gate.
    noteCooldown(until) {
      return withLock((state) => {
        if (Number.isFinite(until)) state.cooldownUntil = Math.max(state.cooldownUntil, until);
        return state.cooldownUntil;
      });
    },
  };
}

module.exports = { createSharedRateGate };
