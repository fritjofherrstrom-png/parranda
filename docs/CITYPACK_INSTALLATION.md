# City-Pack Install Workflow

This document describes the current v0 workflow for creating a new Parranda city-pack foundation. It is tooling guidance, not a promise that a generated city is ready for users.

City packs should make Parranda sharper, but they should not become the only way Parranda can function. A new city starts as an honest skeleton, then earns runtime capability through verified catalog data, route templates, source wiring, and readiness checks.

## Current Workflow

1. Create a skeleton city pack.

```sh
node scripts/create-city-pack.js athens \
  --label "Athens" \
  --timezone "Europe/Athens" \
  --locale "el-GR" \
  --currency "EUR" \
  --lat 37.9838 \
  --lng 23.7275 \
  --visibility preview
```

The generator writes:

```txt
server/cities/athens/catalog.js
server/cities/athens/index.js
```

The generated pack has a valid `CityConfig` shape, empty catalog data, empty route templates, noop Pulse/Live services, heuristic walking config, and a minimal `center` area. It does not add fake places, fake routes, source adapters, local truth, or frontend copy.

2. Inspect the generated city pack.

```sh
node scripts/inspect-city-pack.js athens
```

The inspector only works for registered cities. Before registration, use tests or a temporary require in development to validate the generated config with `validateCityConfig` and `inspectCityPack`.

3. Register the city manually.

The v0 generator intentionally does not edit `server/cities/index.js`. Registration is still a manual code step so reviewers can see when a city becomes part of runtime resolution.

For now, add the generated city to the city registry by following the existing `rome`, `barcelona`, and `test-city` pattern in `server/cities/index.js`.

4. Re-run readiness.

```sh
node scripts/inspect-city-pack.js athens
```

A fresh skeleton should be `preview_ready` or `partial`, not `blocked`. At this stage, it should support an honest city page and Pulse baseline, but it should not claim Blitz or Planner readiness without real candidates and route support.

5. Add real catalog data.

Promote verified places into `catalog.js` only after source/provenance review. Follow `docs/citypack-sourcing-provenance.md` and keep runtime entries distinct from candidate-pack intake notes.

6. Add route templates and source wiring.

Route templates, source descriptors, live adapters, local truth, and richer Pulse behavior should arrive after the city has enough real coverage to make those layers useful.

## Generator Safety Rules

- City keys must use lowercase letters, numbers, and hyphens only.
- The generator refuses to overwrite an existing city folder unless `--force` is passed.
- `--force` overwrites only generated skeleton files: `catalog.js` and `index.js`.
- `--force` preserves unrelated files such as `sources.js`, notes, adapters, and local truth files.
- `--dry-run` prints planned paths and metadata without writing files.
- The generator does not auto-register cities.
- The generator does not create real Athens content or any other real city content by itself.

## Useful Commands

Preview the files without writing:

```sh
node scripts/create-city-pack.js athens \
  --label "Athens" \
  --timezone "Europe/Athens" \
  --locale "el-GR" \
  --currency "EUR" \
  --lat 37.9838 \
  --lng 23.7275 \
  --visibility preview \
  --dry-run
```

Generate into a test output root:

```sh
node scripts/create-city-pack.js athens \
  --label "Athens" \
  --timezone "Europe/Athens" \
  --locale "el-GR" \
  --currency "EUR" \
  --lat 37.9838 \
  --lng 23.7275 \
  --output-root /tmp/parranda-citypack-test/server/cities
```

Inspect a registered city:

```sh
node scripts/inspect-city-pack.js barcelona
node scripts/inspect-city-pack.js rome
node scripts/inspect-city-pack.js test-city
```

Show CLI help:

```sh
node scripts/create-city-pack.js --help
node scripts/inspect-city-pack.js --help
```

## Readiness Meaning

`ready` means the current registered city has safe city page, Pulse baseline, Blitz baseline, and Planner baseline support with no reported data-quality warnings.

`preview_ready` means the city can render and fail honestly, but does not yet have enough candidate or route density for richer product behavior.

`partial` means the city is inspectable but has warnings or incomplete capability. Legacy Rome area-label warnings currently fall here.

`blocked` means the city has a configuration or catalog issue that prevents safe installation or inspection.

## Path Toward Athens

The next Athens step should be a generated skeleton PR, not a content PR:

```txt
create-city-pack
-> validate generated config
-> manual registration
-> inspect-city-pack
-> verify source strategy
-> add real catalog
-> add route templates and sources
-> future install automation
```

Future automation can safely add a `--register` or `install-city-pack` flow once the manual registration step has enough test coverage and review confidence.
