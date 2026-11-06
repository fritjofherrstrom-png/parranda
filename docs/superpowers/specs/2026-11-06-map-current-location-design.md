# Current position on the day's map

Fritjof wants the map to show where the reader is now and asks for other small improvements that make the day easier to use. His supplied phone screenshot shows a valid walking route and numbered stops, but no position marker. Code inspection confirms that Follow the day owns a GPS watch only inside StopLine; RouteMap cannot read it. Preserve Linje. The existing instruction to build with independent detail decisions and no more design questions applies.

Codex's approach is to share the existing opt-in GPS session between map and list, rather than add a second MapLibre GeolocateControl/watch. A one-shot dot would stop moving as the reader walks. A shared in-memory controller gives one current position and one permission flow. This is Codex's implementation choice, not a new user-specified design.

## Behavior

- Follow the day and a visible My location map action use one watch. No location request on page load. My location starts location or recentres the map on a current fix; it can retry an error. A separate Stop location action ends it. The map can orient the reader while viewing another date, but the list's Follow action and progress claims remain today-only.
- Draw a distinct blue dot and the browser-reported accuracy radius. Expose status/accuracy in words. Show route restores the complete route after looking elsewhere. A GPS update never drags the map back after the reader pans; only an explicit centre action does so.
- Use a compact action row beneath the map, preserving the full overview for stop numbers. A fixed visual halo keeps the location indicator visible when it coincides with a stop; the actual accuracy circle and textual accuracy remain independent. Do not move the GPS coordinate or exceed the map's existing bounded stop-label offsets.
- Location is memory-only and display-only: never stored, shared, sent to a product API, used as the day's anchor, or used to change stops/geometry/Maps export.
- Stop on unmount and pause while hidden/page-hidden. Resume an opted-in visible session with a fresh read. Denied, unsupported, invalid, stale (>60s) and late-after-stop callbacks never produce a live dot. Accept finite latitude/longitude within geographic bounds, nonnegative finite accuracy and an epoch timestamp no more than 5s in the future. Existing 15s maximumAge/20s timeout remain.
- Changing the place/date ends the session and returning to that earlier place/date does not silently restart it. Map location may be started explicitly on a future day; the list must not claim today's progress on that future route. Coarse accuracy (>120m) must not claim the reader is at a stop.
- Published near-me endpoint distances remain measured from the original start. Label them Your starting point, not a moving current position. No distance or street path is inferred from the GPS dot.

## Other screenshot findings

The generic Replaced/Undo box and the large gap before the first stop deserve a later focused pass. Grouped pins already have a working picker. This delivery adds orientation controls and clarifies the starting-point label; it does not redesign the header or move route/history sections.

## Ownership and evidence

Owner: Codex; branch codex/map-current-location-20261106 from main83a61ec16fd65f5ed75f2217b9f93041cabbec17. Existing isolated worktree reused; #685 activation belongs to Fritjof/Hermes and is not part of this branch. No new dependency/provider, routing request or paid service. Deliver focused RED/GREEN, relevant map/line/navigation controls, typecheck/build/dist, same-viewport screenshots, one independent whole-branch review and a main-target PR with exact-head Linux CI. Browser fixes use controlled coordinates, not the reader's real location; physical iPhone GPS/Safari remains a separate observation limit.
