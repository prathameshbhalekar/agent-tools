# site/ notes

The layout, spacing and tokens are measured from a Framer template, https://saasyio.framer.ai/. All copy, icons and visuals here are original. None of the template's text, images or logos were copied.

## Measured values (from the template's emitted CSS)
| What | Value |
|---|---|
| Breakpoints | Desktop ≥1200 · Tablet 810–1199 · Phone ≤809 |
| Containers | 1400 page · 809 text · 319 card |
| Section padding | `120px 80px`, 64px head→content gap, 40px hatched band between sections |
| Gaps | 8 / 10 / 12 / 16 / 24 / 40 |
| Type | display 48/500 −3px · title 32/400 −2.2px · h3 24/500 −1.6px · h4 18/500 −1.1px · body 14/400 −0.8px · label 14/600 −0.9px. Inter only |
| Buttons | 40px tall, radius 12, accent-light bg; icon variant padding 4 16 4 4 |
| Badges | pill, #E0E2FF, padding 6px 12px |
| Line height | 110% headings · 130% body |
| Radii | 999 pill · 20 card · 16 panel/FAQ · 14 toggle · 12 button |
| Shadows | `inset 0 0 0 1px rgba(0,0,0,.06)`; `0 36px 56px -36px rgba(30,45,28,.4)` |
| Motion | transform 1.1s `cubic-bezier(.2,.8,.2,1)` reveal; .4s `(.34,1.3,.5,1)` spring hover; .5s `(.32,.72,0,1)` meter width |

## Known gaps
- All content is neutral placeholder text; wordmarks, icons and halftone art are original CSS/SVG.
- Values marked as measured came from computed styles at 1440px; the rest (flow diagram, comparison band, blog rows) are matched from screenshots.

Run it with `python3 -m http.server -d site 4321` and open http://localhost:4321/system.html.
