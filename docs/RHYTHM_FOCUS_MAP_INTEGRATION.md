# Focused rhythm and legible route maps

This candidate combines the selected-interest engine in #536
(`98fb0718107f4823160d73474d718c72a369280e`) and the native fixture lifecycle
and fail-closed test timeout in #537
(`6dd657708d3f04fb0e9ec3c0870ad02ccf2f5fca`). Its map changes are a combined
staged/unstaged snapshot of `fix/mobile-map-legibility` based on
`aa9bceeb1122ca42b9629f26e7a674c8378d18a3`; the original Pi checkout was not
changed. This snapshot integrates the control-clearance and tap-target work
from #526/#529 and adds placement in screen pixels and zoom/pan lifecycle
coverage. It must be tested on the combined commit, not certified from either
parent's CI or a previous image.

The modern UI keeps **Dagens rytm**. A focused day may reach farther for relevant
places when time permits, without adding unselected interests or filling a
kilometre target. Distance remains an estimate of the resulting day. Views
remain a soft wish with partial matches labelled; a general park or landmark
must not silently become an exact viewpoint match.

Map placement changes presentation only. Displaced numbers retain a dot at
their source coordinate. The stop coordinates, sequence and route geometry
are unchanged. A layout that cannot fit all numbers displays a crowding
message; it does not assert that they are all readable.

`npm test` includes the real Chromium map tests. They intercept fixture API
responses and reject external hosts, so they verify presentation rather than
provider coverage, shop availability or a real walking day. Chromium absence
fails CI; a local skip must be reported as NOT OBSERVED. CI installs Chromium
explicitly. Native fixtures still drain accepted queries before closing, and
a stalled test file fails at the runner timeout.

Real-source acceptance remains separate. In particular, the prior #536 run
found unknown opening hours allowing a shop ordinarily closed on the selected
Thursday. Göteborg/Berlin also lacked complete route evidence. Neither this
map integration nor passing fixture tests resolves those supply/visitability
gaps. No public deployment or main merge is implied by this candidate.
