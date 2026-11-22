# Negative greenspace source consistency

## Observed failure

Public mobile QA of `parks_gardens` selected a residential care/retirement
facility as a park. The retained Overture sample already had that park type
before identity merging or preference ranking. Its own website atom pointed to
a named location under an explicit care-service path. The operator and municipal
listing identify the facility as retirement housing, not evidence for a public
park visit. The captured normalized source facts are in
`tests/fixtures/overture-care-park-20261108.json` with their attribution.

The original raw Parquet taxonomy was not reread. The synthetic fresh-mapper
regression is labelled accordingly; it is not a second real acquisition.

## Narrow correction

For Overture park/garden records only, withhold a record when:

- its website path has a closed, explicit care/residential-service segment;
- that scope precedes a specific facility path, rather than a service index;
- two distinct non-generic name atoms occur in the URL hostname/facility leaf,
  with at least one meaningful facility atom in the leaf.

A care-related name, hostname, query or fragment alone does not trigger the
check. An unrelated facility URL, missing website and ordinary park pages keep
their previous eligibility. This is a conservative negative consistency gate,
not proof of closure or a replacement category. A genuinely visitable garden
represented only by its residential facility's service page can be withheld;
that ambiguity is preferable to asserting a public park visit from this row.
It does not prove all other directory classifications correct.

Apply the same check during fresh mapping and retained-sample selection, before
corroboration and ranking. Do not rewrite source records, receipts or acquisition
times. No cache deletion, new source/query, source promotion, geographic rule,
known-hours requirement, output-cap increase or frontend change is introduced.

## Verification scope

The regression covers the captured retained records, a clearly labelled
synthetic fresh row, another identity/language/geography, preservation controls,
and real local HTTP composition/publication followed by the frontend's actual
coverage reader. It checks that the genuine captured parks remain available and
the residential site no longer receives park coverage. Ordinary Overture
source/taxonomy/cache/renewal and precise-interest contracts remain release gates.

Real public after-deployment acceptance and exact-head CI are separate gates;
source replay and controlled HTTP tests are not fresh provider/browser evidence.
The separate food consistency work in PR #667 is not integrated or superseded.
