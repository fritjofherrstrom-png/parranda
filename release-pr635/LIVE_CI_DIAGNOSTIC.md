# Main CI attempt 1 — separate Live rendering observation

Exact main a3e4edaabc7f3834e71451cb9a1b2fcabe76b582, identical accepted candidate tree. Run39828752687 attempt1:4922PASS/1FAIL/3SKIP; only failure tests/live-program-http-browser.test.js:43 (0 programme cards expected1 immediately after an earlier visibility observation).

Exact candidate CI and full final local suite both passed all4923tests. An instrumented copy of that single test outside the product tree retained the original assertions and deadlines and passed. Its MutationObserver recorded card counts1→0→1 across36–38ms while the sheet remained open. This demonstrates a transient render window; no CI DOM artifact exists to prove that window was the actual failure cause.

Relevant existing code: AnywherePlanner.tsx's safeResponse effect clears the prior Live query and, while open, requests the current scope again. LiveSheet.tsx renders a refresh state instead of cards while liveQueryPending. The complete test then verified forty occurrence IDs, local-source preservation and later-page future events. No persistent disappearance was observed in the diagnostic runs. No product or test change was made. One failed-job rerun on the unchanged main SHA is required to finish green main CI before deployment.

This is not source-provider acceptance, a claim of universal UI correctness, or an additional product fix. Initial local browser failures under unrestricted concurrency remain separately recorded; the final concurrency-two whole suite passed. Do not infer PASS merely because these files are unchanged.
