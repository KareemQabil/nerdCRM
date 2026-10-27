# UX-5: the lead outcome chart on home and reports

Status: implemented. The mocked suite passes (119 tests) and the demo suite passes (27); the type check is clean. Checked in a
real browser on the live backend, light and dark.

## What it shows

One total split into what happened to it: the leads still **open**, **converted** and **lost**. The bar is a single stacked bar
sized by the server's counts.

- **Home:** under the open pipeline, captioned "العملاء المحتملون".
- **Reports:** at the top of "Leads by source", above the existing figures and table.

Every number comes from the existing sales report API. Nothing is estimated, and a section the person may not read stays
hidden, as before.

## Reading it without colour

- Every segment is named in the legend with its count and share.
- Hovering a segment repeats the same words.
- The bar is an image whose accessible name lists all three outcomes, for screen readers.
- The figures and the per-source table stay under it as the table view.

## Colours

Open is blue, converted green and lost red, always in that order. The palette was checked with the dataviz validator
(lightness band, chroma, colour-blind separation of neighbours, normal-vision separation, contrast):

| Surface | Open | Converted | Lost | Result |
|---|---|---|---|---|
| Light | `#2563eb` | `#047857` | `#b91c1c` | all checks pass |
| Dark and luxury | `#3b82f6` | `#059669` | `#ef4444` | all checks pass |

The first dark candidate (`#60a5fa`, `#34d399`, `#f87171`) failed the lightness band and was replaced.

## Also

The home panels keep their own height; a short pipeline panel no longer stretches into empty space.

## Tests

The reports test now also checks:
- the bar's accessible summary from the mocked counts (2 open, 1 converted, 1 lost);
- one segment per outcome;
- the legend's counts and shares.
