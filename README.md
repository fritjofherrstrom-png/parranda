# PR #550 original capture evidence

This evidence-only branch contains a hash-verified archive of the four complete
original saved response-body captures, original provenance, the inline replay
transcript and a portable offline replay script. No source pages were refetched.
PR #550 code head remains 0465366f52a094880d94f85333b4b0335b13055e.

Verify the archive against its companion .sha256, extract it, then run
`sha256sum -c SHA256SUMS` inside the extracted directory and
`node replay.cjs --repo /absolute/path/to/the/frozen/parranda/checkout`.
The exact original capture hashes/timestamps and replay instructions are inside.
This is evidence transport only: no implementation change, dependent PR, merge
or deployment is created by this branch.
