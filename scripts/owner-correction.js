#!/usr/bin/env node
"use strict";

/**
 * Add, list and undo owner corrections on the host until the owner UI exists.
 *
 *   PARRANDA_CORRECTIONS_DIR=/var/lib/parranda/corrections \
 *     node scripts/owner-correction.js hide overture-537a9f68-f791-4e64-9b01-5b66db7aab08 \
 *       --reason "Property manager, not a shop" --label "Flat Service" --source overture
 *   node scripts/owner-correction.js retype osm-node-123 --osm shop=antiques --reason "Antiques, not a museum"
 *   node scripts/owner-correction.js revoke c_1a2b3c4d5e6f --reason "Was right after all"
 *   node scripts/owner-correction.js list
 *
 * The running server picks a change up within a second; no restart needed.
 */

const { createOwnerCorrectionStore } = require("../server/planner/owner-corrections");

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      flags[arg.slice(2)] = value;
      i += 1;
    } else positional.push(arg);
  }
  return { positional, flags };
}

function main(argv = process.argv.slice(2), env = process.env, out = console) {
  const { positional: [command, target], flags } = parseArgs(argv);
  const store = createOwnerCorrectionStore({ directory: flags.dir || env.PARRANDA_CORRECTIONS_DIR });
  if (!store) throw new Error("set PARRANDA_CORRECTIONS_DIR or pass --dir");
  const describe = event => `${event.id}  ${event.at}  ${event.action}${event.value ? ` ${event.value.osm}` : ""}  ` +
    `${event.target.id}${event.target.label ? ` (${event.target.label})` : ""}  — ${event.reason}`;
  if (command === "list") {
    const active = store.list();
    for (const event of active) out.log(describe(event));
    out.log(`${active.length} active correction(s) in ${store.file}`);
    if (store.skippedLines()) out.log(`warning: ${store.skippedLines()} unreadable line(s) skipped`);
    return 0;
  }
  if (command === "hide" || command === "retype") {
    if (!target) throw new Error(`${command} needs a place id`);
    const lat = flags.lat === undefined ? undefined : Number(flags.lat);
    const lng = flags.lng === undefined ? undefined : Number(flags.lng);
    const event = store.append({
      event: "add",
      action: command === "hide" ? "hide" : "set_type",
      target: { id: target, label: flags.label, source: flags.source, lat, lng },
      value: command === "retype" ? { osm: flags.osm } : null,
      reason: flags.reason,
    });
    out.log(`added ${describe(event)}`);
    return 0;
  }
  if (command === "revoke") {
    if (!target) throw new Error("revoke needs a correction id (c_…)");
    const event = store.append({ event: "revoke", id: target, ...(flags.reason ? { reason: flags.reason } : {}) });
    out.log(`revoked ${event.id}`);
    return 0;
  }
  throw new Error("usage: owner-correction.js list | hide <place-id> --reason … | retype <place-id> --osm key=value --reason … | revoke <c_id>");
}

if (require.main === module) {
  try { process.exitCode = main(); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { main };
