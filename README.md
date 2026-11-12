# DPP Studio

The internal design room for Don't Postpone Passion. Use it to prototype tees, fleece and the Teranga wood watch in 3D, build print artwork, turn reference photos into blanks, and output manufacturer tech packs.

**Preview:** GitHub Pages URL in the repo sidebar. With the team cloud on, everyone signs in with Google (or email). Without it, each device asks for its own PIN.

## Where your work lives
**Team cloud on** (a `cloud-config.json` file sits next to `index.html`): designs, artwork images, renders, notes and reviews sync live between everyone on the studio list. Each device also keeps a copy, so the studio still opens and saves offline and catches up when it reconnects. The first time a device signs in, it uploads any designs it had stored locally.
**Team cloud off:** designs save in this browser only. To hand work over, use **Tech Pack → Export JSON** and **Settings → Import**.
Either way, run **Settings → Export full backup** now and then.

## Working together
- **Who's here:** a monogram in the header (and on Library cards) shows a teammate who has the same design open.
- **Review:** use **Send for review** in the header. The reviewer gets a count on the Library tab and a **Needs review** filter. **Approve** moves the status one stage on (Concept → Sampling → Approved → Production; Revision → Approved). **Changes** sends it back with a note: Sampling and later stages drop to Revision, and the note goes into the thread. Every action is written to the tech pack revision log.
- **Notes on the model:** in 3D Studio, press **N** (or the **Note** button) and click the piece to pin a note there. Numbered pins stay on the model. Clicking a pin or a note flies the camera back to the view it was written from. Notes support replies and **Resolve**. Use the field under the list for a general note with no pin. Library cards show the open-note count.
- **Two people editing the same design:** if a teammate saves while you have it open, a bar asks whether to **Load theirs** or **Keep mine**. Review decisions and status changes always come through live.

## Logos, text & patches anywhere
In 3D Studio, under **P · Logos, text & patches**, add a logo, any text, an image or a patch, then click the garment where it goes. There's no limit on how many you add.
- **Each item:** set its width in inches, rotation, color and font. Use **Move** to click a new spot, or **Duplicate** to drop a copy.
- **Wrap around curves:** turn this on so the art bends round the side seam, a sleeve or the hood instead of stretching.
- **Made as:** screen print, puff, embroidery, and so on. A patch can be woven, chenille, embroidered, leather or PVC, in a rectangle, rounded, circle, shield or die-cut to the art. Backing and edge colors are both editable.
- **Tech pack:** every placement is listed on the Artwork page with its location, inches from HPS and CF, size and colors.

## Fonts
Text in the Artwork tab and 3D text placements share one font list: 17 built-in fonts, including Bebas Neue, Oswald, Bungee, Pirata One (gothic), Permanent Marker and Rock Salt. Choose **+ Upload a font file…** (TTF, OTF, WOFF or WOFF2) to add your own. It's saved with the design and syncs to the team.

## Fit is true to size
Switching Boxy / Regular / Oversized rewrites the POM: chest, body length, shoulder, sleeve and armhole. The 3D model then reshapes to those numbers at the **View size** you pick. The chest is measured on the mesh and matched in inches; sleeves lengthen and widen; oversized drops the shoulder. The stage label shows the live numbers. Left and right sleeves can be different colors.

## Team cloud setup (one time, about 15 minutes, free plan)
1. Go to [console.firebase.google.com](https://console.firebase.google.com) and click **Add project**. Name it `dpp-studio`; Analytics is optional. The free Spark plan is enough: no Cloud Storage is used, because files are stored in Firestore.
2. **Build → Firestore Database → Create database**, production mode, region `us-east1`.
3. **Firestore → Rules:** paste in the contents of `firestore.rules`, then **Publish**.
4. **Build → Authentication → Get started.** Enable **Google**. Enable **Email/Password** too if anyone needs a non-Google login; create that person's account under **Users**.
5. **Authentication → Settings → Authorized domains:** add `kc2flycodes.github.io`.
6. **Firestore → Data → Start collection** named `members`. Add one document per person. The **document ID** is their sign-in email, lowercase. Give each document a string field `name` (e.g. `Karim`, `Kendrick`). Only those emails get in.
7. **Project settings → Your apps → Web (</>)**: register the app and copy the `firebaseConfig` object. Save it as `cloud-config.json` in the repo root, as JSON with quoted keys:
   `{"apiKey":"…","authDomain":"…","projectId":"…","storageBucket":"…","messagingSenderId":"…","appId":"…"}`
   This config is public by design. Access is enforced by the rules and the `members` list, not by hiding the key. Also restrict the key to `kc2flycodes.github.io` under Google Cloud → APIs & Services → Credentials.
8. Upload `cloud-config.json` to the repo. Reload the studio and sign in.

Free-tier headroom: saves are batched (one write per design every few seconds of activity), so two people working all day stay far below the 20K writes/day limit.
## Tabs
| | |
|---|---|
| 01 Library | All designs, status pipeline, search and filters. Duplicate and delete work from the card hover menu. |
| 02 3D Studio | Silhouette, fit, fabric and colors for garments. For the watch: case, bezel, dial, edition N°, strap woods, movement. Print placement is in inches from HPS. Exports PNG and GLB. Use "Save renders" to send views to the tech pack. |
| 03 Artwork | Layered front/back print art on a 14 × 14 in zone. Supports image, text, DPP mark and shapes. Undo with Ctrl+Z; paste images with Ctrl+V. |
| 04 Capture | Drop or paste a photo. It cuts the background and pulls the palette. From there: build a 3D blank, crop and lift a graphic onto the artwork, or let Claude draft the spec (needs an API key in Settings). |
| 05 Tech Pack | 5–6 editable pages: overview, BOM, graded POM, artwork placement, construction, costing and revision log. Print to PDF or export CSV. The Overview carries a **Style description** written from the 3D spec (silhouette, fabric, construction, double waist, contrast, finish, branding, size run); it rewrites itself as the design changes. The shell-fabric BOM row follows the fabric picked in 3D Studio. Table cells wrap, so long specs print in full. |

## Bugs
Open a GitHub issue. Include the tab, what you clicked, and a screenshot. If the browser console (F12) shows red errors, include those too.

## What you can design
- **Tops:** tee, long sleeve, crewneck, hoodie
  - **Sleeves:** separate sleeve color. Sleeve logo is either the DPP mark (set its width and distance below the shoulder seam) or the DON'T POSTPONE PASSION wordmark running shoulder to cuff. It can go on the left, right or both sleeves, screen printed or embroidered.
- **Labels and tags** (every category, under **T · Labels & tags**): tops and bottoms carry the woven DPP label inside the back neck or waistband (or a printed tagless label, or none). Scarves and balaclavas carry a woven tab at the hem. Every piece, including socks, bags and the watch, can carry the DPP hang tag; it is on by default for accessories, bags, socks and the watch. **Tag text** is editable (leave it empty for the logo alone), **DPP logo** switches between logo + text and text only, and ground and ink colors are editable. The hang tag shows style number, size (or the edition number on a watch), price and a barcode. The panel previews both, and the tech pack lists them on the Materials page.
- **Bottoms:** pants in straight or slim cut, shorts, boxer briefs.
  - **Double waist** (pants and shorts, under **B · Color**): two builds.
    - **Built-in boxer** (default): a woven yoke caught in the main waistband, gathered into a jacquard elastic that carries the wordmark and the DPP mark, with a one-button fly. Set how much shows above the waist, the elastic height, the yoke fabric (plaid, gingham, pinstripe or solid), the elastic color, the knit-in text and its color.
    - **Second band:** a flat second waistband in the contrast fabric, edge-stitched top and bottom, with its own button.
  - The tech pack follows it: POM rows WB2–WB6, BOM rows for the yoke fabric, elastic, button and fusible, and construction rows are added and updated as you change the 3D. Supplier and unit cost typed into those rows are kept; the rest of those rows is rewritten from the spec. Turn the double waist off and the rows go.
- **Accessories:** hooded wrap scarf, balaclava (merino rib by default; polar fleece and chunky knit also available)
- **Bags:** barrel duffle in Mini 16", Weekender 22" or Large 26". Pebble, smooth or suede leather, waxed canvas or ballistic nylon. Gunmetal, steel, brass or matte-black hardware, and a separate trim color for the handles, straps and piping. The duffle body is grained leather with smooth straps, thread rows along the straps, zip and end panels (thread color = **Stitch**; left at the default it runs tonal), and a toothed metal zip.
- **Mini satchel:** 11¾ × 8 × 4⅛ in crossbody (`assets/models/satchel.glb`). Every part keeps its own role:
  - shell color and fabric
  - webbing trim for the strap, gussets and pocket
  - hardware finish (brass by default)
  - flap stitch color

  The strap is rebuilt as one smooth webbing band. The shell and webbing show their weave, the flap and pocket are edged with real stitch rows in the stitch color, and the front pocket has a toothed zip. The DPP mark sits in gold on the flap, and logos, text and patches can go anywhere on it.
- **Stamped logos:** Deboss (pressed), Emboss (raised) and Foil stamp are print techniques. They use the artwork's shape only and press it into the material. New duffles start with the DPP mark debossed on the front.
- **Socks:** crew and no-show 3D models, with contrast heel and toe, a contrast cuff and 1–4 athletic cuff stripes. Logos sit on the outer side of the leg.
- **Watches:** 5 case shapes, 11 materials, 12 dial styles and 8 strap types, plus 16 one-click style presets.
  - **Hour markers:** applied by default. Batons and dots are raised, polished metal, with lume on dark dials. Numerals and the DPP mark at 12 are raised too. Switch to Printed for a flat dial.
  - **Skeleton and open-heart** dials show a full 3D movement: a gear train that turns, a beating balance wheel, Geneva-striped bridges, jewels and blued screws. Dark cases get a black movement.
  - **Case build** has three options:
    - Parametric: any shape.
    - "Sport · modelled": a real modeled round sport case.
    - "Shock · resin": a chunky shock-resistant resin watch with a live LCD that shows the real time, in digital or ana-digi and positive or negative display. You can set the resin color and accent print.

Fabrics per category. Tops: jersey, heavyweight jersey, fleece, waffle. Bottoms: rigid denim, khaki chino twill, corduroy, duck canvas, ripstop, nylon shell, linen, fleece. Each woven fabric has its own surface texture. Fabric patterns (plaid, gingham, pinstripe, woodland camo) work on any garment.

**Washes and distressing** are drawn at real scale across the whole garment, with no seams:
- **Washes:** acid, mineral, stone, vintage fade and bleach splatter. Denim fades on the thighs and knees and gets whiskers either side of the fly.
- **Light distressing:** abrasion where wear really happens, plus frayed raw edges at hems, cuffs and openings.
- **Heavy distressing:** adds rips. On woven fabrics the white weft threads stay across the hole. On pants the rips sit at the knees and thighs.

## 3D models
The garment models live in `assets/models/` and are free Sketchfab models under CC BY 4.0. See [CREDITS.md](CREDITS.md); keep that file with the models.
To use your own (CLO, Marvelous, marketplace), go to 3D Studio → Piece → **Upload GLB**, or replace the file in `assets/models/` with one of the same name.

## Files
`index.html` · `style.css` · `script.js` · `assets/` (logo, favicon, models). No build step. Three.js loads from jsDelivr.
`firestore.rules` holds the team cloud security rules. `experimental/team-harness.html` is the two-user sync test (needs the local servers on :8787 and :8788).
`dpp-studio-demo.html` is a single-file version of the app (device-only mode). 3D garments only load when it sits next to the `assets/` folder.
