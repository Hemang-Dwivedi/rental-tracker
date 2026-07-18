# Rental Tracker Capture Bridge

Watches the property-portal API responses **while you browse normally** and syncs
them into your local Rental Tracker automatically. No AI, no accounts, no tokens —
everything runs and stays on your machine.

## Install (once, ~1 minute)
1. Open `chrome://extensions`
2. Turn on **Developer mode** (top-right)
3. Click **Load unpacked** → select this `capture-bridge` folder
4. On the extension's card → **Details** → enable **Allow access to file URLs**
   (needed so it can talk to the tracker, which is a `file://` page)

## Use
1. Browse NoBroker / Magicbricks / 99acres / Housing / Square Yards as usual —
   set your filters on the portal, scroll the results. The extension's badge
   counts captured pages.
2. Open (or switch to) your `nobroker_tracker.html` tab. Pending captures sync
   in automatically — you'll see "Live capture synced …" toasts, and the badge
   drains to zero. New listings get the usual "new" outline.
3. That's it. Recalibration, pin trust, shared-pin detection, and your verified
   pins all apply to captured data exactly as they do to HAR imports.

## Saving searches as you browse
Whenever a page on a supported portal actually yields listing data, a small
card offers "Save this search for one-click capture runs?" — Save adds the URL
to your Run list; "Not this one" remembers the dismissal so it never asks about
that search again. It auto-dismisses in 20s if ignored.

## One-click refresh (the Run button)
Save your portal search URLs once in the popup (one per line — set your filters
on the portal first, then copy the result-page URL). For paginated portals like
99acres, write `-page-{1-5}` and it expands to pages 1…5. Click **▶ Run capture**:
a runner tab opens each URL in turn, scrolls to the bottom at human pace until
the page stops growing, closes it, and rests a few seconds before the next.
Watch the log; Stop aborts after the current page. When it finishes, open the
tracker — the buffer drains in automatically.

Be reasonable with frequency: this is automated browsing of the portals in your
own logged-in browser. A run every day or two across a handful of searches is
modest; hammering it hourly is how bot walls get raised. If a portal shows a
CAPTCHA during a run, solve it by hand and let the run continue.

## Fallback
If auto-sync ever misbehaves, click the extension icon → **Download as HAR** and
import that file with the tracker's HAR button — identical result.

## Notes
- Captures only listing search responses on the five portals; touches nothing else.
- Buffer caps at 400 pages (oldest drop first). Clear anytime from the popup.
- Sync while big fetches run is fine — imports go through the same tested merge
  path as HAR files.
