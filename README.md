# Rental Tracker

A local-first flat-hunting tool that pulls listings from five Indian property portals into one filterable, commute-ranked view — and **grades how much it trusts each listing's map pin**.

No server. No account. No API keys required. Everything lives in your browser.

[![tests](https://github.com/Hemang-Dwivedi/rental-tracker/actions/workflows/test.yml/badge.svg)](https://github.com/Hemang-Dwivedi/rental-tracker/actions/workflows/test.yml) ![license](https://img.shields.io/badge/license-MIT-blue)

---

## Why this exists

Searching for a flat means opening the same five sites, applying the same filters, and reading the same listings over and over — with no way to sort by *the thing that actually matters*: how long the commute is.

So I merged them. Then I found the real problem.

**The map pins lie.** A listing advertised a 6-minute commute. Google said 21. It wasn't a rounding error — the portal was stamping **one map pin across five unrelated societies** and labelling it building-grade. Another portal shipped latitude and longitude transposed on a subset of records. A third served a locality's centre point as if it were the building.

Sorting by drive time is worthless if the coordinates are fiction. So most of this project isn't the merge — it's the trust layer.

## What it does

- **Merges five portals** — NoBroker, 99acres, Magicbricks, Housing, Square Yards — deduplicated by listing id
- **Ranks by real commute** — road distance/time via OSRM to a destination you set
- **Grades every map pin** and says so on the card:
  - `✓ verified pin` — you confirmed it yourself
  - `◌ locality pin` — the portal admitted this is locality-level, not the building
  - `◌ shared pin` — this exact coordinate is stamped on other, different societies
  - `⚠ pin ≠ locality` — the pin sits far from where that locality's other listings cluster
  - *no coords* — the pin was implausible and was dropped. **No coords beats wrong coords.**
- **Lets you override any pin** — paste real coordinates from Google Maps; your correction outranks the portal permanently
- **Tracks what changed** — every capture marks listings `new` / `updated` / `same`, with `↓ was ₹22,000` when a price moves
- **Faceted filters** built from your own data, with live what-if counts on every chip
- **Commute prediction** — a calibratable peak-hour multiplier, or real traffic-aware predictions with a free [TomTom](https://developer.tomtom.com) key (optional)

## Two parts

| | |
|---|---|
| **`index.html`** | The whole app. One file. Open it in a browser. Data lives in IndexedDB. |
| **`capture-bridge/`** | Optional Chrome extension. Reads portal search responses *as you browse* and syncs them into the tracker. |

The extension is deliberately dumb: it captures raw responses and hands them over. All parsing, trust-grading and classification happens in the tracker — so the tool can evolve without ever reinstalling the extension.

## Quick start

1. Download `index.html` (or open the hosted version) and open it in Chrome (or host it — see below)
2. **Set your destination**: right-click your office in Google Maps → click the coordinates to copy → paste into the *Destination* field → *Set destination*
3. Get listings in, either way:
   - **Manual**: on a portal search page, DevTools → Network → export HAR → *Import HAR* in the tracker
   - **Automatic**: install the extension (below), browse portals normally, and captures sync themselves
4. Click **Fetch road times**, then filter and sort

### Installing the capture extension

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `capture-bridge/`
2. On its card → **Details** → enable **Allow access to file URLs** (the tracker is a local page)
3. Browse a portal search page. The extension badge counts captured pages. Open the tracker — it drains automatically.

**Saved searches + one-click runs**: paste your portal search URLs into the extension popup (or click *Save* on the prompt that appears while browsing), then hit **▶ Run capture**. It opens each search, scrolls to the bottom at human pace, walks paginated portals page by page, and reports coverage per search: `~250 listings / 502 available (50%)`.

### Hosting on GitHub Pages

Works fine — but two things:

- **IndexedDB is per-origin.** Data saved from `file://` will not appear at `https://you.github.io`. Export a **Backup** first, then **Restore** it once on the hosted URL.
- **The extension must know the new URL.** In `capture-bridge/manifest.json`, add your Pages origin to the `bridge.js` content-script matches:
  ```json
  "matches": ["file:///*", "https://Hemang-Dwivedi.github.io/*"]
  ```

## How it gets data

The extension observes the JSON responses **your own browser already receives** while you look at a portal's search results as a normal, logged-in visitor. It:

- reads only listing-search responses on five portal domains, and nothing else
- bypasses no authentication and defeats no protection
- **never touches CAPTCHAs** — if one appears, the run stops and asks you
- stores everything locally; there is no server, no telemetry, no upload
- paces itself deliberately (human-speed scrolling, rest gaps between pages)

This is a personal research tool for a personal flat hunt. It is not a bulk data pipeline, and using it that way would break the portals' terms of service — please don't. See [NOTICE.md](NOTICE.md).

## Portals push back — pace accordingly

Capturing is not free, and the portals differ enormously in how much they tolerate.

**99acres is the strictest.** A deep walk (53 pages / ~1,300 listings in 26 minutes)
earned a **site-wide IP block**: every request, including the homepage, answered
`HTTP 417` with an empty body from their edge. Not a per-URL rate limit — the whole
household's IP, every device, for hours. 417 is semantically meaningless here
(nothing sent an `Expect` header); it's simply their WAF's way of saying no in a
form that's hard to pattern-match.

Two things follow, and the second matters more:

1. **Cap deep walks.** The runner now pre-checks the HTTP status before starting,
   names the block instead of reporting "0 results", and saves progress so a later
   run resumes rather than re-walking. Even so: ~15 pages a session, not 50.
2. **Ask whether the portal is worth it.** In one real shortlist (Owner-posted,
   2-3 BHK, furnished, ≤₹30k), the sources contributed: NoBroker 227, Magicbricks 65,
   **99acres 21**. The strictest portal supplied under 7% of the candidates that
   passed the filters. Coverage is not the goal — decisions are.

Do not route around a block with a VPN or a different network. It converts
"reading responses my browser receives" into "circumventing an access control the
operator deliberately applied", and that is a different thing entirely — legally
and ethically. If a portal says no, take the no.

## What it can't do

Honesty is the whole point of this project, so:

- **Portal-supplied fields are all it has.** Square Yards never sends furnishing or deposit; only NoBroker sends amenity flags. Filters say so on their face rather than silently returning nothing.
- **OSRM is free-flow.** No traffic model. The peak multiplier is a heuristic — calibrate it against a couple of Google Maps checks, or add a TomTom key for real predictions.
- **It can flag a lying pin; it can't divine the truth.** When a portal shares one pin across five societies, no algorithm knows which building is which. That's what the manual override is for.
- **Capture patterns will drift.** When a portal redesigns its API, capture for that portal quietly stops. The coverage readout is how you notice.

## Development

```bash
npm install
npm test
```

The suite loads the real `index.html` into jsdom against a fake IndexedDB and drives the actual merge, filter, render and persistence paths — not mocks of them. It covers the five portal parsers, the coordinate guards, pin-trust grading, dedup, the capture bridge, change classification and the destination config.

Most of it is regression tests for bugs found in the wild, and each one encodes a rule worth keeping:

| Bug found | Rule it locked in |
|---|---|
| A portal shipped lat/lng transposed | Implausible coordinates are dropped, never "recovered" — a swap that *looks* plausible put a pin 3 km from the real building |
| One pin stamped across five societies, labelled building-grade | Cross-dataset detection flags shared pins; the card says so |
| Every response arrived twice, once as an empty `304` | Empty and not-modified responses are never captured |
| A portal server-rendered the page you land on and only *prefetched* the rest | The page you visit is captured too — otherwise every landed page was invisible |
| A coverage metric read `0` and stopped a run early | An end-of-results signal never depends on a count that can fail |

CI runs the suite on Node 20 and 22, and fails the build if any captured data (`*.har`, backups, exports) is ever tracked by git.

## License

MIT — see [LICENSE](LICENSE). The licence covers this code only, never the listing data. See [NOTICE.md](NOTICE.md).
