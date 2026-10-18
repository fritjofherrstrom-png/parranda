# Exact source-name diagnosis

The previously observed route stop
`overture-011783b7-1962-49ca-a8ea-4542d15b81a5` has now been read by exact ID
from its pinned original Overture release `2026-09-23.1`. The result is in
[exact-park-raw.json](exact-park-raw.json).

```json
{"primary":"攝政公園","common":null,"rules":null}
```

This is the original source row, not the already normalized local record.
All five range requests passed the existing If-Match/ETag, HTTP206,
Content-Range and exact-length checks against the saved asset identity.
The read transferred 1,242,542 bytes and returned exactly one matching ID.
The diagnostic used the existing unmodified private range/footer helpers in
a disposable process, a pruned copy of original rowgroup98, 128MB DuckDB memory
and one thread, within the existing45-second observation bound. Its owned
sparse file was removed. No product, shared source cache, Pi configuration or
public data was changed.

Conclusion: this specific label cannot be fixed by selecting an existing
English common-name or rule value; both are absent. The hypothesis that the
English alternative was discarded by normalization is disproven for this
record. The general primary-only projection does omit other records' optional
language fields, but that fact alone does not repair this case or justify a
new acquisition/localization implementation.

The field semantics are checked against the official versioned
[Overture Names schema](https://docs.overturemaps.org/schema/v1.18.0/reference/common/names/)
and [NameRule schema](https://docs.overturemaps.org/schema/v1.18.0/reference/common/name_rule/).
No translation, canonical physical-venue identity, corrected coordinates or
venue-owned website is inferred from this name or its supplied Wikipedia URL.
SKVP Reading remains the separate previously demonstrated source-identity/
coordinate fault. No city/name blacklist or new corroboration gate is added.

Runtime of this diagnostic: Node24.15.0/macOS arm64. This is a successful exact
raw-data read, not provider freshness, route usability or deployment acceptance.
