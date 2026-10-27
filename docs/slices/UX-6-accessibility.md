# UX-6: an accessibility gate in CI, and the contrast fixes it found

Status: implemented. The mocked suite passes (120 tests, including the new gate) and the demo suite passes (27); the type check
is clean.

## The gate

`tests/app.spec.ts` › "accessibility gate" runs axe-core (`@axe-core/playwright` 4.10.2, a dev dependency) over the same 16
live-mode pages as the mobile gate, in the light and the dark theme:

- **Rules:** WCAG 2.0 and 2.1, levels A and AA.
- **Result:** any violation fails the test, which names the rule, its impact and the first elements.
- **Motion:** the pages are measured at rest, with reduced motion. Otherwise the 240 ms page fade-in is caught half transparent,
  and every heading reads as low contrast (the first run reported `h1` and body text on all 32 views for that reason).

## What it found, and the fixes

| Finding | Where | Fix |
|---|---|---|
| Group captions in the side menu below 4.5:1 | every page, both themes | the captions were dimmed with `opacity: .8` on an already muted colour; they now use the muted colour alone |
| Blue "open" stage chip text below 4.5:1 on its tint | leads, accounts, opportunities registers | the text colour mixes the sales blue with the text colour |
| Amber "held" and "partial" labels below 4.5:1 on their tint | system map | same approach with the warning colour, in every theme |
| `aria-label` on a plain `div` (prohibited) | system map meter | the meter is decorative (`aria-hidden`); the same counts are written next to it as text |

After the fixes: no violations on any of the 32 views.

## Not here

Pixel-diff screenshots: baselines depend on the fonts and renderer of the machine, and CI and local runs differ. The real-browser
audit script (desktop and phone, light and dark, timing, overflow and console errors) stays the visual check before each UI PR.
The mobile gate (no horizontal scroll at 390 px) and this accessibility gate are the automated ones.
