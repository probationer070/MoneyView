# Landing · 랜딩 — design reference

This is a design mockup created in a visual design tool, exported as a
standalone page. Treat it as a REFERENCE MOCKUP, not production code:
the markup and inline styles carry the design's precise values — colors,
font sizes, spacing, radii, shadows, layout — which an implementation
should replicate faithfully in its own components and styling system
rather than copy wholesale.

## Contents

- `Main.dc.html` — the artboard (a Design Component: an `<x-dc>`
  template + a small logic class). The values to replicate live in its
  inline `style="…"` attributes and the `<helmet><style>` block.
- `ds/moneyview/components/bundle.css` — referenced resource
- `ds/moneyview/components/bundle.js` — referenced resource
- `ds/moneyview/tokens.css` — referenced resource
- `ds/moneyview/tokens.json` — referenced resource
- `support.js`, `vendor/react*.js` — the runtime that renders the
  component in a browser; not part of the design.

## Viewing

Serve the folder (e.g. `python3 -m http.server`) and open `Main.dc.html`;
some browsers block the scripts over file://.

## MoneyView notes (2026-10-13)

- Copied from the untracked export `Landing · 랜딩-html/`. Not copied: `MoneyView.html` (5.4 MB
  bundle of the same content), `support.js` and `vendor/` (viewer runtime). Without them
  `Main.dc.html` does not render from this folder; it is kept for its inline values.
- MoneyView ships only the `paper` theme. The `void` values here are reference only and are not
  carried into `apps/web/tokens/moneyview.tokens.json`.
- The landing page (`Main.dc.html`) is out of scope of the 2026-10 design-system plan.
- Provenance: `tokens.json` `meta.source` says the palette and type scale were "Derived from a
  Heron AI brand extraction (heronaiapp.com)". Get a brand review before any public release.
- The font files referenced as `fonts/...` were not in the export; `apps/web/app/fonts/` holds the
  vendored copies (Task 4 of the plan).
