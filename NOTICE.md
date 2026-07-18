# Notice on data, privacy and third-party terms

## This repository contains code, never data

No listing data, HAR capture, backup or export is committed here, and none should
be. `.gitignore` blocks them by default. Two reasons:

1. **HAR files contain your session cookies.** A HAR records request headers.
   If you were logged into a portal, that file contains credentials that
   identify you. Publishing one publishes your session.
2. **Listing data is other people's personal data.** Owner names, contact
   fragments, photographs and addresses belong to real people who never agreed
   to appear in a public repository. In India, the DPDP Act applies to you as
   the person publishing it — not to the portal.

If you fork this, keep it that way. If you ever commit such a file by mistake,
deleting it in a later commit is **not enough** — it remains in git history.
Rewrite history (e.g. `git filter-repo`) and rotate anything exposed.

## Third-party terms

This tool reads responses your browser already receives while you view a
portal's search results as a normal visitor. It bypasses no authentication,
defeats no protection, and stops rather than solving CAPTCHAs.

That said: automated retrieval is restricted by most portals' terms of service,
regardless of how modest it is. This project is published as a **personal
research tool for a personal flat hunt**. Running it at scale, redistributing
what it retrieves, or building a commercial product on it would breach those
terms, and possibly the law. Don't.

Pace your captures. A run every day or two across a handful of saved searches
is the intended use.

## Ownership

- Listing content, descriptions and photographs: the respective portals and
  their users.
- Map data and routing: [OSRM](https://project-osrm.org/) / OpenStreetMap
  contributors (ODbL), optionally TomTom under their own terms.
- Portal names are trademarks of their owners. This project is not affiliated
  with, endorsed by, or connected to any of them.

## Privacy

This tool has no server. There is no telemetry, no analytics and no upload
path. Everything — listings, your destination, any API key you choose to add —
stays in your own browser's storage. Deleting the site data deletes all of it.
