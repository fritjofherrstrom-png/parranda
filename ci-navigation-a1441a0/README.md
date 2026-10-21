# Browser readiness delta — a1441a0

Candidate `a1441a0c73d556959e02fa7bcd0db5c6fc69371a`, tree `67b01048ad1a33229cd75982fe46c21da831ed21`, base `0643bc56202a8d1d552ea09e302a0bb0a1cd2aca`.

Only `tests/compact-day-cards-http-browser.test.js` changed relative to the independently reviewed product candidate `8aa85a2ce6c554a633ae9a7d8c4e132fa0774319`. All product source and built distribution remain byte-identical. The new commit waits for the real landing island's hydration before input, records readiness and captures URL/DOM state on later failure. No timeout, API fixture response, product assertion, or source policy was weakened.

## Evidence

The first CI run (39637869677) on 8aa85a2 failed once: the new browser journey timed out waiting for navigation, before any compose request. It recorded no current URL or hydration state, so its historical internal cause cannot be directly established.

The bounded controlled probe withholds only the actual landing JavaScript module. The initial HTML is fully loaded (`document.readyState=complete`) while its real Astro island still has `ssr`. Without a readiness wait, filling/clicking submits the unhydrated HTML form to `/?`, losing the field; the route assertion fails RED. Releasing the same module and waiting for the island to finish hydration makes the same real free-text input navigate to `/anywhere?place=Fixture+Area`: GREEN. This establishes the missing precondition and a failure matching the CI symptom, not a retrospective DOM capture from GitHub.

The corrected test uses the established readiness pattern already present in the autocomplete and Live-discovery HTTP browser journeys. The real API/normalizers/composer remain in use. Focused combined run: **7 PASS, 0 FAIL, 0 SKIP** on Node24.15.0/macOSarm64. Node22 full CI is tracked on PR631; do not transfer the old head's local full-suite result to this new head.

To replay from the product repository with its installed dependencies/browser, run this documentation-branch script by absolute path:

```
node --require ./tests/helpers/no-live-network.js /path/to/verify-entry.cjs
node --require ./tests/helpers/no-live-network.js /path/to/verify-entry.cjs --wait-for-hydration
```

The first command must exit1 with `/` versus `/anywhere`; the second must exit0. No external provider traffic, shared-cache mutation or product API interception occurs. This does not fix or certify pre-JavaScript product usability. No merge/deploy is included.
