# QA evidence for PR #643

This folder holds evidence only. It is not for merge.

## Chromium capture run (`*.png` except `webkit-sim-*`, and `report.json`)

- **When:** 2026-10-24, 13:00:51–13:02:00 UTC (`report.json` → `started`/`finished`).
- **Source state:** the working tree that became commit `3dda8829`, with one exception.
  - `inlineLinkTarget` in `frontend/src/components/shared/ui.tsx` still drew the target as `before:-inset-y-[14px]`. That is why `report.json` lists inline source links at 43 px.
  - The centred 44 px target was set after this run. Its size was measured separately on the `3dda8829` build with a hit test in Chromium; that measurement is not in this JSON.
- **Served:** that build's `frontend/dist`, through the local preview proxy, with `/api` from staging build `e4021a89`.
- **Place:** Göteborg, Saturday 24 Oct 2026, around 15:00 local time.
- **Browser:** headless Chromium (Playwright 1.63). Swedish and English, day and night, 375 px (2×) and 1280 px.
- **Night values were measured in this run.** They are under `runs[].themes.night` and `runs[].sheetNight`. The sheet's time-group headings measured 8.39:1 at night.

## iOS Simulator captures (`webkit-sim-*.png`)

- iPhone 17, iOS 27, Safari (WebKit), private tab, same preview.
- Taken about 13:06 UTC on the `3dda8829` build.
- This is not a physical device.

## Not in this evidence

The F1/F2 review fix (programme rows read by their current slot; start-only rows keep their date) is not in these captures. It came in a later commit and was not re-captured on provider data. It is covered by fixture tests in that commit.
