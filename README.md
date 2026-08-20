# mwa-site-assets

Stylesheet and script for the Meta Wealth Advisory website.

These two files are served to every visitor's browser by the live site, so
nothing here is private. They are hosted separately from Squarespace only so
that the pages can share one cached copy instead of embedding a duplicate in
every page.

Generated from source by `build_bundle.py`. Do not edit these files directly.

| File | Purpose |
|---|---|
| `mwa.css` | design system, layout, and section styling |
| `mwa.js`  | scroll reveals, parallax, FAQ accordion, header, footer |

Referenced from each page as a versioned jsDelivr URL, so a change here only
reaches the live site when a new tag is published.

## inter-var-latin.woff2

Inter, subset to Latin (SIL Open Font License — redistribution permitted).

Shipped here rather than uploaded to Squarespace because Squarespace's Asset
Library does not accept `.woff2`, and a font uploaded through the Link Editor
has no reliable way to read its URL back. A wrong font URL does not break the
site — it silently falls back to a near-identical face, which is worse.
