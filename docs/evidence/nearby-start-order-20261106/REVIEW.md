# Independent whole-branch review and disposition

Reviewed base `c8cae52c3258932eceb47d15ea366082dd9f922c` through initial candidate
`18f1948de94fd5946332b15f69359f7ca501ac59`, read-only in a fresh reviewer
context. The reviewer independently ran the original 54 focused tests (PASS)
and replayed the new tests against the base engine (two genuine RED failures).

## Important finding — resolved with a regression

Accepting geometry ties inside bounded 2-opt changed its subsequent search
trajectory. A frozen nine-stop input produced objective 4.30 / 3.4 km instead
of the legacy 4.28 / 3.2 km, without a shorter final first gap. This violated
primary geometry precedence.

The maintained test `a near-start tie cannot divert bounded refinement to a
worse final geometry` reproduces the failure before the fix (`REVIEW-RED.log`).
The correction retains the strict-objective legacy search cursor and tracks
the preferred return candidate separately among the same evaluated candidates.
No additional passes, enumeration or candidate evaluations were introduced.
The final affected run is 170 PASS / 0 FAIL / 0 skips (`GREEN.log`).

## Minor finding — resolved

The saved RED diagnostics had trailing spaces. These were removed, and the
full branch range is checked, rather than only the uncommitted working diff.

## Review boundaries

The review set aside missing catalogue identities and visited/rating features
as separate work; universal nearest-first ordering because stronger geometry
and scheduling intentionally win; global optimality for the existing bounded
search; and live-provider/browser/physical-device/Pi/deployment acceptance.
These remain outside this candidate. They are not silently counted as PASS.

Original verdict: **With fixes**, no Critical findings. The executor reproduced
and corrected the Important finding in one fix pass. Full CI on the corrected
head remains the final candidate gate; this is not a second independent review
or runtime acceptance.
