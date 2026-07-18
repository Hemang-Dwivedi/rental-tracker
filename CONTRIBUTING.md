# Contributing

The most useful contributions are **parser fixes**. Portals change their APIs
without warning; when they do, capture for that portal quietly stops and the
coverage readout drops.

## Reporting a broken portal

Do **not** attach a HAR file to a public issue — it contains your session
cookies. Instead include:

- which portal, and what the runner log said (coverage %, "no new data", etc.)
- the shape of the response, with values redacted: key names only
- the URL pattern of the failing request, minus query values

## Guidelines

- **Every parser fix needs a test.** `node test.js` — the suite mocks portal
  payloads directly; add a fixture rather than a live fetch.
- **No coords beats wrong coords.** If a heuristic can't prove a coordinate is
  right, the record should end up with no coordinate and a flag — never a
  plausible guess. Two attempts at "recovering" transposed coordinates were
  reverted for exactly this reason.
- **The extension stays dumb.** Capture mechanics only. Parsing, trust grading
  and classification belong in the tracker so users don't have to reinstall.
- **Never break user overrides.** A verified pin outranks any portal data,
  through recalibration and re-import.
