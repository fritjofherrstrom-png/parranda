# Map current location implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. One fresh independent whole-branch review at the end.

**Goal:** Show current opt-in position on the route map and let the reader centre on it or restore the route.
**Architecture:** Lift the existing Follow session into AnywherePlanner; map and list read the same in-memory fix. MapLibre renders position/accuracy without acquiring location or mutating the day.
**Tech Stack:** Existing React/TypeScript, MapLibre6.12, Node/jsdom and IAB verification.
**Spec:** docs/superpowers/specs/2026-11-06-map-current-location-design.md

## Global constraints

- Opt-in only; one watch; no product API, storage, URL, route, Maps-export or publication changes from location.
- GPS maximumAge15000ms, timeout20000ms; stale after60000ms; future tolerance5000ms; progress requires accuracy<=120m.
- Preserve Linje and existing map fit/pin controls. No new dependencies/providers.
- Place/date change ends tracking; future-date map orientation is explicit and separate from today-only progress.

## Review focus

- Late callbacks after stop, hidden, unmount and a newer session cannot reintroduce a fix.
- A future/restored day can show explicitly requested current position without claiming today's route progress.
- Inaccurate/expired/invalid fixes cannot claim a precise current point or arrival.
- Location and return-to-route controls cannot steal map-marker taps or conceal stops under controls.
- Theme, resize, route replacement and webgl/tile failure do not create another GPS watch or move route facts.

### Task 1: Share a safe position session with map and line

**Files:** modify frontend/src/components/planner/useFollowPosition.ts, AnywherePlanner.tsx, planner/StopLine.tsx; add frontend/tests/planner-map-location.test.mjs; update planner-line-facts.test.mjs to exercise the shared owner and actual Position shape.
**Interface:** useFollowPosition(enabled) returns supported/state/retry; tracking includes lat/lng/accuracy/timestamp. StopLine receives the controller, following and onToggleFollow. Parent scope is the displayed place/date plus current date choice; mismatched scope is immediately inactive and then cleared.

- [x] Add mounted tests for no automatic request, one shared watch, stop/error/retry, hidden/resume, stale/invalid/late fixes, date changes/return, future-day orientation and immutable storage/URLs/compose count. Observe RED.
- [x] Lift ownership and implement generation-guarded lifecycle/fix validation. Keep list progress today-only, suppress precise progress for accuracy>120m. Run tests GREEN.

### Task 2: Render and control the map position

**Files:** modify planner/RouteMap.tsx and styles/tailwind.css; add/update focused real-map fixture acceptance using existing tests/helpers patterns.
**Interface:** RouteMap receives current fix/status/enabled/supported, an explicit centre revision, onLocate and onStopLocation. Draw a location marker/accuracy radius separately from route facts. Return-to-route uses the existing control-aware refit.

- [x] Add tests proving the dot/radius follows accepted fixes, disappears on stop/error, camera moves only on explicit centring and Show route restores all stops; retain 44px targets/control keepouts. Observe RED.
- [x] Implement map controls, read-only markers and status. Clarify published near-me endpoint labels as starting point. Verify map and endpoint regression controls.
- [x] Typecheck/build/dist; inspect screenshots with controlled coordinates in IAB. User photo is private audit input; do not commit it or send it externally. Record screenshot-only findings and live-flow limits.
- [ ] Independent review, fix Important/Critical with RED/GREEN, push main-target PR and obtain exact-head Linux CI. No merge/deploy inferred for this new feature.

Review ruling: one shared GPS watch does not mean shared Follow intent. The first review caught My location silently enabling progress. Explicit followScope is now independent; a320px browser assertion failed before the fix and passes afterward. Stopping Follow preserves an explicit map request; Stop location ends both. Existing Follow-only stop/start still releases/reacquires the watch.
