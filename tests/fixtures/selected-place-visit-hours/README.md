# Selected-place owner HTML fixtures

These are reduced, owner-derived HTML captures, not new provider acceptance.
The schedule paragraphs/lists and the linked exceptions URL are retained from
the source. The wrapper keeps the relevant source structure: the entry-page
hero heading is outside `main`, and the institution self-link is in navigation.
Unrelated navigation, scripts, personal-data forms and page decoration are
omitted. The full captured pages were also replayed offline during verification.

| Fixture | Owner URL | Captured UTC | Original bytes | Original SHA-256 |
| --- | --- | --- | ---: | --- |
| `gustavianum-entry.html` | https://www.uu.se/gustavianum | 2026-10-19 11:31:41 | 115673 | `be3afc72a24a7c9da66346f1c9684925f92d5d5e97521e8ced5de11c81beb8b2` |
| `gustavianum-hours.html` | https://www.uu.se/gustavianum/besok-oss/oppettider | 2026-10-19 11:34:49 | 89025 | `0a67637ef49093fb571b5d960e5dd6d37e5c8abbe3bc9f8eb364d2f5e47f3cbd` |

For October 19, 2026, the published autumn/winter week explicitly closes
Monday. The parser deliberately returns unknown for unsupported or ambiguous
exceptions, including the source's special Tuesday evening wording. It must
not turn those conditions into a confident weekly schedule.

HTTP and browser integration tests use these recorded documents, a controlled
clock, controlled place supply and a controlled geocoder transport. The browser
uses the built application and its real HTTP handlers, enrichment, composition
and publication. They do not prove fresh provider availability, all real-world
opening hours or deployment to the public QA surface.
