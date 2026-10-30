# DPP Studio

The internal design room for Don't Postpone Passion. Use it to prototype tees, fleece and the Teranga wood watch in 3D, build print artwork, turn reference photos into blanks, and output manufacturer tech packs.

**Preview:** GitHub Pages URL in the repo sidebar. First visit on each device asks you to set a PIN.

## Where your work lives
Designs save **in your browser on that device** (IndexedDB). They don't sync between people or machines yet.
To hand work to someone: open the design, go to **Tech Pack → Export JSON**, and send the file. They load it with **Settings → Import**. Use **Settings → Export full backup** often.

## Tabs
| | |
|---|---|
| 01 Library | All designs, status pipeline, search and filters. Duplicate and delete work from the card hover menu. |
| 02 3D Studio | Silhouette, fit, fabric and colors for garments. For the watch: case, bezel, dial, edition N°, strap woods, movement. Print placement is in inches from HPS. Exports PNG and GLB. Use "Save renders" to send views to the tech pack. |
| 03 Artwork | Layered front/back print art on a 14 × 14 in zone. Supports image, text, DPP mark and shapes. Undo with Ctrl+Z; paste images with Ctrl+V. |
| 04 Capture | Drop or paste a photo. It cuts the background and pulls the palette. From there: build a 3D blank, crop and lift a graphic onto the artwork, or let Claude draft the spec (needs an API key in Settings). |
| 05 Tech Pack | 5–6 editable pages: overview, BOM, graded POM, artwork placement, construction, costing and revision log. Print to PDF or export CSV. |

## Bugs
Open a GitHub issue. Include the tab, what you clicked, and a screenshot. If the browser console (F12) shows red errors, include those too.

## What you can design
- **Tops:** tee, long sleeve, crewneck, hoodie
- **Bottoms:** pants (with a double-waistband option), shorts, boxers
- **Socks**
- **Watches:** 5 case shapes, 11 materials, 12 dial styles and 8 strap types, plus 14 one-click style presets

Fabric patterns (plaid, gingham, pinstripe), washes and distressing work on any garment.

## 3D models
The garment models live in `assets/models/` and are free Sketchfab models under CC BY 4.0. See [CREDITS.md](CREDITS.md); keep that file with the models.
To use your own (CLO, Marvelous, marketplace), go to 3D Studio → Piece → **Upload GLB**, or replace the file in `assets/models/` with one of the same name.

## Files
`index.html` · `style.css` · `script.js` · `assets/` (logo, favicon, models). No build step. Three.js loads from jsDelivr.
`dpp-studio-demo.html` is a single-file version of the app. 3D garments only load when it sits next to the `assets/` folder.
