# Product TODO

Deferred product work. Entries here are not implemented features or release promises.

## Shuffle a stop / suggest an alternative

- [ ] **After candidate quality, evidence-backed selection depth and rhythm/location adaptation are fixed:** add a shuffle icon on a day's stop so the user can request another relevant suggestion, for example because they have already visited the place.

Requested by Fritjof: a day should not keep returning the same generic choices when the user wants an alternative.

### Intended behavior

- Shuffle proposes a different eligible place for that stop; it is not random replacement of the whole day.
- Preserve selected interests, date, rhythm, actual geographic anchor and explicit kept places. Recompose affected ordering/legs where necessary; never show old geometry as the new route.
- Draw alternatives only from trusted server-owned candidates. No user-supplied replacement becomes source evidence.
- Treat already-visited / already-offered choices as explicit exclusion or bounded session variety, with undo/reset. Do not invent persistent visit history.
- Prefer useful variety, not randomness for its own sake; do not weaken category, identity, known-closure or routing checks.
- If no suitable alternative exists, say so honestly and retain the current stop. Do not silently re-offer it as new or fill with an unrelated interest.
- Preserve evidence and any opening-hours uncertainty on the replacement. Update the map and Maps handoff consistently.

### Before implementation

Decide the exact interaction (proposal preview versus immediate replacement), undo behavior, and how this builds on existing pin/exclude commitments without contradictory state. Add end-to-end tests for replacement, no-alternative, pinned-neighbor preservation, rapid clicks/stale responses, and route/map consistency.

**Not part of the current evidence-backed candidate-depth fix.**
