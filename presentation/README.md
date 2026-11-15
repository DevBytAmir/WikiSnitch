# WikiSnitch deck

Eleven slides in the app's own look (tokens, fonts, badges and the seal-and-moon hero from `web/`),
plus a small page to present them or download the PDF. Plain HTML, CSS and JavaScript: no build step,
no network, and it works when opened straight from disk.

| File | What |
|---|---|
| `index.html` | The page: live preview, **Present full screen**, **Download PDF**, every slide as a card |
| `slides.html` | The deck itself, 1920 × 1080, scaled to any window |
| `WikiSnitch-deck.pdf` | One page per slide, light theme |
| `build.mjs` | Rebuilds the PDF and `thumbs/` with headless Chrome or Edge |
| `assets/` | Hero art and logo (copied from `web/`) |
| `js/deck.js` | Navigation, and the demos that play when a slide opens (slides 4 to 9) |

## Present

Open `index.html` and press **Present full screen**, or open `slides.html` and press `F`.

| Key | Does |
|---|---|
| `→` `Space` `PageDown` | next slide (a click on the right two thirds too) |
| `←` `Shift+Space` `PageUp` | previous slide (a click on the left third too) |
| `Home` `End` | first, last slide |
| `F` | full screen |
| `D` | light or dark theme |

`slides.html#7` opens on slide 7; `slides.html?print` opens the print dialog. Slides 4 to 9 play a short
demo each time they open; the PDF, and a system set to reduce motion, show the finished state.

## After changing a slide

```bash
node presentation/build.mjs          # PDF and thumbnails, about 40 s
node presentation/build.mjs --pdf    # PDF only
```

It looks for Chrome or Edge in the usual places; set `CHROME=/path/to/browser` otherwise.

## Credits

Slides quote and show Wikipedia text (Finnish, Swedish and English Wikipedia), CC BY-SA 4.0; each
slide that does names and links the article. The app views on slides 6 to 9 (chart, comparisons,
answers, citations and SQL) are rebuilt from real API responses on the project's data, 15 Nov 2026,
with the answer model on; other numbers come from `README.md`.
