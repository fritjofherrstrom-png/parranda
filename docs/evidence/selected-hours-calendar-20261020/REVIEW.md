# Review record

Scope: continuation from frozen `4eeaa628e6beeaad1b43416b7308c174946da787`; its ancestry is preserved. Independent agents reviewed source/calendar/publication boundaries and the later source-row corrections. Findings below were reproduced through real internal components before correction. This is not a claim of external human approval or public acceptance.

| Reproduced issue | Correction and discriminator |
| --- | --- |
| Hidden child times bypassed contact visibility filtering | Paragraph traversal uses the already filtered visible-node set; hidden and aria-hidden child schedules reject |
| Non-paragraph current closure was ignored | Contact-local visible condition check also covers div/span and inline fragments |
| Arbitrary text ending in closed/time became a date override | Whole bounded positive row grammar; negation and another service remain unresolved |
| Unsupported inline 2027 borrowed the 2026 heading | Unsupported year assertion remains broadly unresolved, including the future date |
| Unresolved same-date exception was hidden by a resolved override | Contradictory/unsupported conditions remain unknown; only supported ordinary holiday caveats can be superseded |
| Expired supplied calendar excluded a route | Runtime source age uses a trusted UTC observation instant, separate from frozen local-day context; failed refresh cannot renew old facts |
| Conditional unknown fact disappeared at the route formatter | Validated unknown facts survive the actual published route, remain unknown, and render qualified ordinary hours |

RED → GREEN evidence is executable in the named test files; the PR includes machine-readable counts. The final independent source-row re-review reran 9 reader tests successfully after the last three source-row findings. Root reviewed the runtime delta and reran real HTTP and built-browser proofs. Original capture and fixture checks are distinct from simulated transport/clock verification.

One source-text UI contract assertion still expected the old unknown-label JSX after the intentional conditional display change. Its exact assertion was updated to require the new qualified-label-or-unavailable branch; mounted DOM/browser tests independently assert the visible behavior. No test was removed, skipped or relaxed to hide product failure.
