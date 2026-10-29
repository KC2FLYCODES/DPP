// DPP Studio — internal design, 3D prototyping and tech pack tool.
// Storage: IndexedDB on this device (designs + image assets). Backup/restore via JSON.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ParametricGeometry } from 'three/addons/geometries/ParametricGeometry.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

/* =========================================================================
   0. Utilities
   ========================================================================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = (p = '') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const today = () => new Date().toISOString().slice(0, 10);
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const money = v => '$' + num(v).toFixed(2);
const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v; };
const ago = t => { const s = (Date.now() - t) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago'; };
const frac = v => { // inches → nearest 1/8 fraction, factory style
  const sign = v < 0 ? '-' : ''; v = Math.abs(v);
  let w = Math.floor(v), e = Math.round((v - w) * 8);
  if (e === 8) { w++; e = 0; }
  if (!e) return sign + w;
  const g = e % 2 ? 1 : e % 4 ? 2 : 4;
  return sign + (w ? w + ' ' : '') + (e / g) + '/' + (8 / g);
};
function hexToRgb(h) { h = h.replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join(''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
const rgbToHex = (r, g, b) => '#' + [r, g, b].map(x => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0')).join('');
function shade(hex, amt) { const [r, g, b] = hexToRgb(hex); const t = amt < 0 ? 0 : 255, p = Math.abs(amt); return rgbToHex(r + (t - r) * p, g + (t - g) * p, b + (t - b) * p); }
const lum = hex => { const [r, g, b] = hexToRgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
function download(name, data, type = 'application/octet-stream') {
  const url = typeof data === 'string' && data.startsWith('data:') ? data : URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  if (!url.startsWith('data:')) setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const fileToDataURL = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

function toast(msg, err = false) {
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 2600);
}
function modal(html, onMount) {
  const m = $('#modal'); m.innerHTML = `<div class="mbox">${html}</div>`; m.classList.add('on');
  const close = () => { m.classList.remove('on'); m.innerHTML = ''; };
  m.onclick = e => { if (e.target === m) close(); };
  onMount?.(m, close);
  return close;
}
function confirmBox(title, body, okLabel = 'Delete') {
  return new Promise(res => {
    modal(`<h2>${esc(title)}</h2><p class="sub">${esc(body)}</p><div class="acts"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>${esc(okLabel)}</button></div>`,
      (m, close) => { $('[data-x]', m).onclick = () => { close(); res(false); }; $('[data-ok]', m).onclick = () => { close(); res(true); }; });
  });
}

/* =========================================================================
   1. Brand mark — official DPP lettermark (assets/logo.png, black-on-transparent mask).
   Tinted per surface. Wordmark text is the fallback if the asset can't load.
   ========================================================================= */
const MARK_DEFAULT = `<svg viewBox="0 0 120 60" xmlns="http://www.w3.org/2000/svg"><text x="60" y="44" text-anchor="middle" font-family="Archivo Black,Arial Black,sans-serif" font-size="40" fill="currentColor">DPP</text></svg>`;
const Mark = {
  svg: MARK_DEFAULT, custom: null, img: null, aspect: 2,
  async init() {
    const sources = window.DPP_LOGO ? [window.DPP_LOGO] : ['assets/logo.png', 'assets/logo.svg'];
    for (const f of sources) {
      try { const i = await loadImg(f); this.custom = f; this.img = i; this.aspect = i.naturalWidth / i.naturalHeight || 2; break; } catch { /* not present */ }
    }
    if (!this.img) {
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(MARK_DEFAULT.replace(/currentColor/g, '#000'));
      this.img = await loadImg(url);
    }
    this.paint();
  },
  html() {
    if (!this.custom) return this.svg;
    return `<span style="display:block;width:100%;aspect-ratio:${this.aspect};background:currentColor;-webkit-mask:url('${this.custom}') center/contain no-repeat;mask:url('${this.custom}') center/contain no-repeat"></span>`;
  },
  paint(root = document) { $$('[data-mark]', root).forEach(el => el.innerHTML = this.html()); },
  // Draw tinted into a 2D context, fitted inside w×h centered on (cx, cy).
  draw(ctx, cx, cy, w, h, color) {
    if (!this.img) return;
    let dw = w, dh = w / this.aspect; if (dh > h) { dh = h; dw = h * this.aspect; }
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(dw)); c.height = Math.max(1, Math.ceil(dh));
    const x = c.getContext('2d'); x.drawImage(this.img, 0, 0, c.width, c.height);
    x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(c, cx - dw / 2, cy - dh / 2, dw, dh);
  }
};

/* =========================================================================
   2. Catalog constants
   ========================================================================= */
const CATS = {
  tee: { label: 'Tee', code: 'TE', msrp: 60 },
  longsleeve: { label: 'Long Sleeve', code: 'LS', msrp: null },
  crewneck: { label: 'Crewneck', code: 'CR', msrp: null },
  hoodie: { label: 'Hoodie', code: 'HD', msrp: null },
  watch: { label: 'Wood Watch', code: 'WT', msrp: 221 }, // The Teranga, Drop 001 — price per draft site
};
const STATUSES = ['Concept', 'Sampling', 'Revision', 'Approved', 'Production'];
const TECHNIQUES = ['Screen print', 'Puff print', 'Discharge', 'DTG', 'Flat embroidery', '3D puff embroidery', 'Tonal embroidery', 'Chenille patch', 'Woven patch', 'Heat transfer'];
const isStitch = t => /embroider|chenille|patch/i.test(t || '');
const FINISHES = {
  none: { label: 'Clean · no wash', phrase: '' },
  acid: { label: 'Acid wash', phrase: 'heavy acid wash with marbled bleached clouds' },
  mineral: { label: 'Mineral wash', phrase: 'soft mineral wash with subtle cloudy fading' },
  stone: { label: 'Stone wash', phrase: 'stone-washed, softened surface with fine speckled fading' },
  vintage: { label: 'Vintage fade · garment dye', phrase: 'garment-dyed vintage fade, sun-faded and slightly uneven' },
  bleach: { label: 'Bleach splatter', phrase: 'hand-thrown bleach splatter' },
};
const DISTRESS = {
  none: { label: 'None', phrase: '' },
  light: { label: 'Light · scuffs + frayed hems', phrase: 'lightly distressed with scuffing and frayed raw hems' },
  heavy: { label: 'Heavy · holes + shredding', phrase: 'heavily distressed with ripped holes, shredded panels and frayed raw edges' },
};
const PLACE_PRESETS = {
  front: [['Center chest', { top: 3, dx: 0, s: 1 }], ['Left chest logo', { top: 6, dx: 4, s: .32 }], ['Full front', { top: 2.5, dx: 0, s: 1.3 }]],
  back: [['Nape', { top: .75, dx: 0, s: .25 }], ['Upper back', { top: 2.5, dx: 0, s: .8 }], ['Full back', { top: 4, dx: 0, s: 1.3 }]],
};
const COLOR_NAMES = [['off-white', '#EEF1F9'], ['white', '#FFFFFF'], ['cream', '#F3EEDF'], ['bone', '#E9E3D6'], ['heather grey', '#9D9B96'], ['charcoal', '#3A3A3C'], ['black', '#111111'], ['navy', '#14172B'], ['royal blue', '#2B4BA8'], ['sky blue', '#8FB8DE'], ['forest green', '#2B3A2F'], ['olive', '#59583A'], ['sage', '#9AA58A'], ['sand', '#C8B48A'], ['tan', '#B98A4A'], ['brown', '#5C3B26'], ['rust', '#9C4A2A'], ['clay', '#9C5A3C'], ['oxblood', '#5B1F20'], ['red', '#B3262B'], ['pink', '#E2A6B4'], ['orange', '#D9772B'], ['yellow', '#E3C24A'], ['purple', '#5B3E7A']];
const colorName = hex => { const [r, g, b] = hexToRgb(hex); let best = COLOR_NAMES[0][0], bd = Infinity; COLOR_NAMES.forEach(([n, h]) => { const [R, G, B] = hexToRgb(h); const d = (r - R) ** 2 * .3 + (g - G) ** 2 * .59 + (b - B) ** 2 * .11; if (d < bd) { bd = d; best = n; } }); return best; };
const SWATCHES = [['DPP Pale', '#EEF1F9'], ['DPP Ink', '#14172B'], ['DPP Deep', '#0A0B15'], ['DPP Gold', '#B98A4A'], ['White', '#FFFFFF'], ['Bone', '#E9E3D6'], ['Heather', '#9D9B96'], ['Clay', '#9C5A3C'], ['Olive', '#59583A'], ['Oxblood', '#5B1F20']];
const FABRICS = {
  jersey: { label: 'Jersey · 220 gsm', gsm: 220, comp: '100% combed ring-spun cotton', rough: .88, sheen: .45, bump: .55 },
  heavy: { label: 'Heavyweight jersey · 300 gsm', gsm: 300, comp: '100% cotton, open-end, garment-dyed', rough: .93, sheen: .55, bump: .8 },
  fleece: { label: 'Loopback fleece · 420 gsm', gsm: 420, comp: '100% cotton French terry, loopback', rough: .97, sheen: .85, bump: .45 },
  waffle: { label: 'Waffle knit · 260 gsm', gsm: 260, comp: '100% cotton thermal waffle', rough: .95, sheen: .3, bump: 1.6 },
};
const FITS = { boxy: { label: 'Boxy', w: 1.14, h: 2.5, drop: .14 }, regular: { label: 'Regular', w: 1.0, h: 2.72, drop: 0 }, oversized: { label: 'Oversized', w: 1.24, h: 2.82, drop: .26 } };
const WOODS = {
  walnut: { label: 'Black walnut', a: '#6a4329', b: '#2f1b10' },
  maple: { label: 'Hard maple', a: '#dcbd8e', b: '#a9824f' },
  ebony: { label: 'Ebony', a: '#33281f', b: '#0f0a07' },
  zebrawood: { label: 'Zebrawood', a: '#d0ae78', b: '#3c2717' },
  sandalwood: { label: 'Red sandalwood', a: '#93503a', b: '#4f2416' },
  koa: { label: 'Koa', a: '#a5652f', b: '#5a3015' },
  bamboo: { label: 'Bamboo', a: '#d2b47c', b: '#9b7a45' },
};
const BEZELS = { steel: { label: 'Brushed steel', c: '#bdbbb6', m: 1, r: .32 }, black: { label: 'Black IP steel', c: '#1d1c1b', m: 1, r: .3 }, gold: { label: 'Gold IP steel', c: '#c9a45c', m: 1, r: .25 }, wood: { label: 'Matching wood' } };
const MOVEMENTS = ['Miyota 2035 · quartz', 'Miyota 8215 · automatic', 'Seiko NH35A · automatic', 'Seiko VK63 · meca-quartz chrono'];

/* =========================================================================
   3. Presets — starter specs. Values are industry starting points; confirm on fit sample.
   ========================================================================= */
const row = o => ({ id: uid('r'), ...o });
function presetPOM(cat) {
  if (cat === 'watch') return {
    unit: 'mm', sizes: ['SPEC'], base: 'SPEC', rows: [
      row({ code: 'W1', desc: 'Case diameter (excl. crown)', tol: .2, base: 42, grade: 0 }),
      row({ code: 'W2', desc: 'Case thickness incl. crystal', tol: .2, base: 11, grade: 0 }),
      row({ code: 'W3', desc: 'Lug width', tol: .1, base: 22, grade: 0 }),
      row({ code: 'W4', desc: 'Lug to lug', tol: .3, base: 50, grade: 0 }),
      row({ code: 'W5', desc: 'Strap width at clasp', tol: .2, base: 18, grade: 0 }),
      row({ code: 'W6', desc: 'Strap length, fits wrist (min–max 150–210)', tol: 2, base: 210, grade: 0 }),
      row({ code: 'W7', desc: 'Crown diameter', tol: .1, base: 5, grade: 0 }),
    ]
  };
  const S = ['XS', 'S', 'M', 'L', 'XL', '2XL'];
  const top = [
    row({ code: 'A', desc: 'Body length from HPS', tol: .5, base: 28, grade: 1 }),
    row({ code: 'B', desc: 'Chest ½ — 1" below armhole', tol: .5, base: 22.5, grade: 1 }),
    row({ code: 'C', desc: 'Sweep ½ — at hem', tol: .5, base: 22.5, grade: 1 }),
    row({ code: 'D', desc: 'Shoulder width, seam to seam', tol: .375, base: 20.5, grade: .75 }),
    row({ code: 'E', desc: 'Armhole straight', tol: .25, base: 10.25, grade: .5 }),
    row({ code: 'F', desc: 'Bicep ½ — 1" below armhole', tol: .25, base: 9.5, grade: .375 }),
  ];
  const neck = [
    row({ code: 'H', desc: 'Neck width, seam to seam', tol: .25, base: 7.5, grade: .25 }),
    row({ code: 'J', desc: 'Front neck drop from HPS', tol: .125, base: 3.5, grade: .125 }),
    row({ code: 'K', desc: 'Back neck drop from HPS', tol: .125, base: .75, grade: 0 }),
  ];
  if (cat === 'tee') return {
    unit: 'in', sizes: S, base: 'M', rows: [...top,
      row({ code: 'G1', desc: 'Sleeve length from shoulder seam', tol: .25, base: 9, grade: .25 }),
      row({ code: 'G2', desc: 'Sleeve opening ½', tol: .25, base: 8, grade: .25 }),
      ...neck, row({ code: 'L', desc: 'Neck rib height', tol: .0625, base: 1, grade: 0 }),
      row({ code: 'M', desc: 'Hem height (twin needle)', tol: .0625, base: 1, grade: 0 })]
  };
  const sleeveLong = [
    row({ code: 'G1', desc: 'Sleeve length from shoulder seam (incl. cuff)', tol: .5, base: 25, grade: .5 }),
    row({ code: 'G2', desc: 'Cuff opening ½ (relaxed)', tol: .25, base: 4, grade: .125 }),
  ];
  if (cat === 'longsleeve') return {
    unit: 'in', sizes: S, base: 'M', rows: [...top, ...sleeveLong, ...neck,
      row({ code: 'L', desc: 'Neck rib height', tol: .0625, base: 1, grade: 0 }),
      row({ code: 'N', desc: 'Cuff height (rib)', tol: .125, base: 2.5, grade: 0 })]
  };
  const fleece = [
    row({ code: 'N', desc: 'Cuff height (rib)', tol: .125, base: 3, grade: 0 }),
    row({ code: 'P', desc: 'Waistband height (rib)', tol: .125, base: 3, grade: 0 }),
    row({ code: 'Q', desc: 'Waistband ½ (relaxed)', tol: .5, base: 19, grade: 1 }),
  ];
  if (cat === 'crewneck') return {
    unit: 'in', sizes: S, base: 'M', rows: [...top.map(r => ({ ...r, id: uid('r'), base: r.code === 'B' ? 23.5 : r.code === 'A' ? 27.5 : r.base })), ...sleeveLong, ...neck,
      row({ code: 'L', desc: 'Neck rib height', tol: .0625, base: 1.25, grade: 0 }), ...fleece]
  };
  return {
    unit: 'in', sizes: S, base: 'M', rows: [...top.map(r => ({ ...r, id: uid('r'), base: r.code === 'B' ? 24 : r.code === 'A' ? 27.5 : r.base })), ...sleeveLong,
      ...fleece,
      row({ code: 'R', desc: 'Hood height, HPS to crown', tol: .375, base: 14, grade: .25 }),
      row({ code: 'S', desc: 'Hood width ½', tol: .25, base: 11, grade: .25 }),
      row({ code: 'T', desc: 'Kangaroo pocket width at top', tol: .25, base: 12, grade: .25 }),
      row({ code: 'U', desc: 'Kangaroo pocket height', tol: .25, base: 7.5, grade: 0 }),
      row({ code: 'V', desc: 'Drawcord exposed length', tol: .5, base: 16, grade: 0 })]
  };
}
function presetBOM(cat) {
  if (cat === 'watch') return [
    row({ component: 'Case', material: 'Solid hardwood, CNC turned, lacquer sealed', supplier: '', spec: 'Species per colorway', qty: 1, uom: 'pc', cost: 0 }),
    row({ component: 'Movement', material: 'Per spec sheet', supplier: '', spec: 'See movement field', qty: 1, uom: 'pc', cost: 0 }),
    row({ component: 'Crystal', material: 'Sapphire, AR coated inside', supplier: '', spec: 'Flat, 1.5 mm', qty: 1, uom: 'pc', cost: 0 }),
    row({ component: 'Dial', material: 'Brass, printed', supplier: '', spec: 'Edition number pad-printed', qty: 1, uom: 'pc', cost: 0 }),
    row({ component: 'Hands', material: 'Steel, painted', supplier: '', spec: 'H/M/S set', qty: 1, uom: 'set', cost: 0 }),
    row({ component: 'Bezel ring', material: '316L stainless', supplier: '', spec: 'Finish per spec', qty: 1, uom: 'pc', cost: 0 }),
    row({ component: 'Crown', material: '316L stainless, push-pull', supplier: '', spec: 'Hourglass engraved end', qty: 1, uom: 'pc', cost: 0 }),
    row({ component: 'Caseback', material: '316L stainless, laser engraved', supplier: '', spec: 'Baobab engraving + edition N°/150', qty: 1, uom: 'pc', cost: 0 }),
    row({ component: 'Strap links', material: 'Hardwood, two-tone 3-piece', supplier: '', spec: 'Removable pins', qty: 1, uom: 'set', cost: 0 }),
    row({ component: 'Clasp', material: '316L butterfly deployant', supplier: '', spec: 'Logo stamp', qty: 1, uom: 'pc', cost: 0 }),
    row({ component: 'Presentation box', material: 'Wood box, foam insert', supplier: '', spec: 'Numbered certificate card', qty: 1, uom: 'pc', cost: 0 }),
  ];
  const fleece = cat === 'hoodie' || cat === 'crewneck';
  const b = [
    row({ component: 'Shell fabric', material: fleece ? FABRICS.fleece.comp : FABRICS.heavy.comp, supplier: '', spec: (fleece ? 420 : 300) + ' gsm, pre-shrunk', qty: fleece ? 1.6 : 0.9, uom: 'yd', cost: 0 }),
    row({ component: 'Rib trim', material: '1×1 rib, 95% cotton 5% spandex', supplier: '', spec: 'Collar' + (cat !== 'tee' ? ', cuffs' : '') + (fleece ? ', waistband' : ''), qty: fleece ? .25 : .05, uom: 'yd', cost: 0 }),
    row({ component: 'Thread', material: 'Tex 27 core-spun poly', supplier: '', spec: 'Tonal to body', qty: 1, uom: 'cone', cost: 0 }),
    row({ component: 'Back neck tape', material: 'Cotton twill tape 3/8"', supplier: '', spec: 'Shoulder to shoulder', qty: .3, uom: 'yd', cost: 0 }),
    row({ component: 'Main label', material: 'Woven damask', supplier: '', spec: 'DPP mark, center back neck', qty: 1, uom: 'pc', cost: 0 }),
    row({ component: 'Care / content label', material: 'Printed satin', supplier: '', spec: 'Left side seam, 4" above hem', qty: 1, uom: 'pc', cost: 0 }),
    row({ component: 'Hang tag', material: 'Uncoated 400 gsm board', supplier: '', spec: 'Drop + unit number', qty: 1, uom: 'pc', cost: 0 }),
    row({ component: 'Polybag', material: 'Recycled LDPE, suffocation warning', supplier: '', spec: 'Size sticker', qty: 1, uom: 'pc', cost: 0 }),
  ];
  if (cat === 'hoodie') b.splice(3, 0,
    row({ component: 'Drawcord', material: 'Flat cotton cord 3/8"', supplier: '', spec: 'Tonal', qty: 1.4, uom: 'yd', cost: 0 }),
    row({ component: 'Aglets', material: 'Metal tipping', supplier: '', spec: 'Finish to match', qty: 2, uom: 'pc', cost: 0 }),
    row({ component: 'Eyelets', material: 'Metal grommet 8 mm', supplier: '', spec: 'Hood front', qty: 2, uom: 'pc', cost: 0 }));
  return b;
}
function presetConstruction(cat) {
  if (cat === 'watch') return [
    row({ area: 'Case', method: 'CNC turned solid wood, steel inner container press-fit', spi: '', notes: 'Grain runs 12–6. No visible knots or filler.' }),
    row({ area: 'Finish', method: 'Natural oil + matte lacquer, 3 coats', spi: '', notes: 'Splash resistant only — 3 ATM max.' }),
    row({ area: 'Caseback', method: 'Screw-down, 4 screws, rubber gasket', spi: '', notes: 'Laser engrave edition N° and engraving text.' }),
    row({ area: 'Strap', method: 'Pin-linked 3-piece wood links', spi: '', notes: 'Include 2 spare links + link removal tool.' }),
    row({ area: 'QC', method: 'Timekeeping 48h, crown action, crystal seat', spi: '', notes: 'Reject any finish crazing or link gap > 0.3 mm.' }),
  ];
  const r = [
    row({ area: 'Shoulder seam', method: '4-thread overlock w/ twill tape', spi: '12', notes: 'Tape back neck shoulder to shoulder.' }),
    row({ area: 'Side seams', method: '4-thread overlock', spi: '12', notes: 'Care label left side seam.' }),
    row({ area: 'Neck', method: 'Rib attached 4-thread overlock, coverstitch topstitch 1/4"', spi: '12', notes: 'No neck stretch-out; rib cut 85% of opening.' }),
    row({ area: 'Armhole', method: 'Set-in, 4-thread overlock', spi: '12', notes: '' }),
  ];
  if (cat === 'tee') r.push(row({ area: 'Sleeve & body hem', method: 'Twin-needle coverstitch, 1" turn', spi: '12', notes: '' }));
  else r.push(row({ area: 'Cuffs' + (cat !== 'longsleeve' ? ' & waistband' : ''), method: 'Rib attached 4-thread overlock', spi: '12', notes: 'Rib cut 75% of opening.' }));
  if (cat === 'hoodie') r.push(row({ area: 'Hood', method: '2-ply self-lined, center seam flatlock', spi: '12', notes: 'Eyelets 1.5" from CF edge.' }), row({ area: 'Pocket', method: 'Kangaroo, coverstitch edge, bartack corners', spi: '12', notes: '' }));
  r.push(row({ area: 'Wash', method: 'Garment wash / enzyme, tumble dry', spi: '', notes: 'Target shrinkage < 3% L / < 2% W.' }));
  return r;
}

function newDesign(cat, name) {
  const isW = cat === 'watch', st = Settings.get();
  const seq = S.designs.filter(d => d.category === cat).length + 1;
  return {
    id: uid('d_'), name: name || (isW ? 'Untitled watch' : 'Untitled ' + CATS[cat].label.toLowerCase()),
    styleNo: `DPP-${CATS[cat].code}-${String(seq).padStart(3, '0')}`,
    category: cat, status: 'Concept', drop: '', season: '', factory: '', designer: st.designer,
    msrp: CATS[cat].msrp, edition: isW ? 150 : '', notes: '', printNotes: '',
    created: Date.now(), updated: Date.now(), thumb: null, renders: {},
    garment: { color: '#EEF1F9', trim: '#EEF1F9', stitch: '#EEF1F9', fabric: cat === 'hoodie' || cat === 'crewneck' ? 'fleece' : 'heavy', fit: 'boxy', finish: 'none', distress: 'none' },
    watch: { dia: 42, caseWood: 'walnut', bezel: 'steel', dial: '#EEF1F9', index: '#14172B', accent: '#B98A4A', strapWood: 'walnut', strapAccent: 'maple', movement: MOVEMENTS[0], crystal: 'Sapphire', editionNo: 1, engraving: "TERANGA · DON'T POSTPONE PASSION", wr: '3 ATM' },
    place: { front: { dx: 0, top: 3, s: 1, r: 0, tech: 'Screen print' }, back: { dx: 0, top: 4, s: 1, r: 0, tech: 'Screen print' } },
    artwork: { front: [], back: [] },
    colorways: [row({ name: 'Main', hex: isW ? WOODS.walnut.a : '#EEF1F9', pantone: '', notes: '' })],
    bom: presetBOM(cat), pom: presetPOM(cat), construction: presetConstruction(cat),
    labels: isW ? 'Dial: DPP mark at 12, edition N° at 6.\nCaseback: N° ___ / 150 and engraving text.\nCertificate card numbered to match caseback.'
      : 'Main label: woven DPP mark, centered back neck, 1/2" below seam.\nCare label: left side seam, 4" above hem.\nHang tag: drop name + unit number, attached via safety pin through main label.',
    packaging: isW ? 'Wood presentation box, foam insert, numbered certificate, 2 spare links, link tool. Outer mailer carton.'
      : 'Fold to 9" × 12", tissue wrap, recycled polybag with size sticker. 24 units per master carton, sorted by size.',
    costing: { labor: 0, freight: 0, dutyPct: 0, overhead: 0 },
    revisions: [row({ date: today(), author: st.designer, note: 'Created' })],
    refs: [],
  };
}

/* =========================================================================
   4. Storage — IndexedDB (designs + image assets), localStorage (settings)
   ========================================================================= */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('dpp-studio', 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('designs', { keyPath: 'id' }); d.createObjectStore('assets', { keyPath: 'id' }); };
      r.onsuccess = () => { this.db = r.result; res(); }; r.onerror = () => rej(r.error);
    });
  },
  req(store, mode, fn) {
    return new Promise((res, rej) => { const t = this.db.transaction(store, mode); const q = fn(t.objectStore(store)); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); });
  },
  all: s => DB.req(s, 'readonly', o => o.getAll()),
  get: (s, id) => DB.req(s, 'readonly', o => o.get(id)),
  put: (s, v) => DB.req(s, 'readwrite', o => o.put(v)),
  del: (s, id) => DB.req(s, 'readwrite', o => o.delete(id)),
};
const Assets = {
  cache: new Map(), imgs: new Map(),
  async put(dataUrl, name = 'image') { const id = uid('a_'); await DB.put('assets', { id, name, data: dataUrl, created: Date.now() }); this.cache.set(id, dataUrl); return id; },
  async get(id) { if (this.cache.has(id)) return this.cache.get(id); const a = await DB.get('assets', id); if (a) this.cache.set(id, a.data); return a?.data; },
  img(id, onload) { // sync accessor for canvas drawing; triggers async load
    const hit = this.imgs.get(id); if (hit?.complete && hit.naturalWidth) return hit;
    if (!hit) { const i = new Image(); this.imgs.set(id, i); this.get(id).then(src => { if (src) { i.onload = () => onload?.(); i.src = src; } }); }
    return null;
  },
  async ready(ids) { await Promise.all(ids.map(async id => { const src = await this.get(id); if (!src) return; let i = this.imgs.get(id); if (!i) { i = new Image(); this.imgs.set(id, i); } if (!i.complete || !i.naturalWidth) { i.src = src; await i.decode().catch(() => { }); } })); },
};
const Settings = {
  key: 'dpp.settings',
  get() { return { designer: 'Kendrick', apiKey: '', ...JSON.parse(localStorage.getItem(this.key) || '{}') }; },
  set(p) { localStorage.setItem(this.key, JSON.stringify({ ...this.get(), ...p })); },
};

/* =========================================================================
   5. App state
   ========================================================================= */
const S = { designs: [], current: null, view: 'library', filter: 'all' };
const saveNow = async () => { if (!S.current) return; S.current.updated = Date.now(); await DB.put('designs', S.current); setSaved(true); };
const saveSoon = debounce(saveNow, 600);
function touch() { setSaved(false); saveSoon(); }
function setSaved(ok) { const el = $('#saveInd'); if (el) { el.textContent = ok ? 'Saved' : 'Saving…'; el.classList.toggle('dirty', !ok); } }

function renderCtx() {
  const d = S.current, el = $('#ctx');
  if (!d) { el.innerHTML = `<span class="cap">No design open</span>`; return; }
  el.innerHTML = `<span class="style">${esc(d.styleNo)}</span>
    <input class="name" id="ctxName" value="${esc(d.name)}" aria-label="Design name">
    <select class="in" id="ctxStatus" style="width:118px;padding:5px 22px 5px 8px">${STATUSES.map(s => `<option ${s === d.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <span class="save-ind" id="saveInd">Saved</span>`;
  $('#ctxName').oninput = e => { d.name = e.target.value; touch(); };
  $('#ctxStatus').onchange = e => { d.status = e.target.value; touch(); };
}
async function openDesign(id, view = 'studio') {
  await saveNow();
  S.current = S.designs.find(d => d.id === id) || null;
  Art.reset(); renderCtx(); go(view);
}
function go(view) {
  if (view !== 'library' && view !== 'capture' && !S.current) view = 'library';
  S.view = view;
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + view));
  if (view === 'library') { saveNow(); Library.render(); }
  if (view === 'studio') Studio.show();
  if (view === 'artwork') Art.show();
  if (view === 'capture') Capture.show();
  if (view === 'techpack') TechPack.render();
}

/* =========================================================================
   6. Flat sketches (SVG) — used for library thumbs, cat picker, tech pack
   ========================================================================= */
const FLAT = {
  tee: { body: 'M158 40 L98 58 L40 150 L78 173 L112 133 L112 420 L288 420 L288 133 L322 173 L360 150 L302 58 L242 40', stitch: ['M112 410 L288 410', 'M47 141 L85 163', 'M353 141 L315 163'] },
  longsleeve: { body: 'M158 40 L98 58 L66 200 L40 412 L80 416 L98 236 L112 150 L112 420 L288 420 L288 150 L302 236 L320 416 L360 412 L334 200 L302 58 L242 40', stitch: ['M112 410 L288 410'], cuffs: ['M43 384 L83 388', 'M357 384 L317 388'] },
  crewneck: { body: 'M158 40 L96 58 L62 200 L38 412 L80 416 L98 236 L110 150 L110 420 L290 420 L290 150 L302 236 L320 416 L362 412 L338 200 L304 58 L242 40', stitch: [], cuffs: ['M41 380 L83 384', 'M359 380 L317 384'], band: 'M110 386 L290 386' },
};
FLAT.hoodie = FLAT.crewneck;
function flatSVG(d, side = 'front', { art = true, stroke = '#14172B', bg = null } = {}) {
  if (d.category === 'watch') return watchFlat(d, side, stroke);
  const g = d.garment, F = FLAT[d.category], fill = g.color, dark = shade(fill, -.18), sw = 1.6;
  const front = side === 'front';
  stroke = lum(fill) < .3 && stroke === '#14172B' ? shade(fill, .5) : stroke; // keep detail lines visible on dark bodies
  const fleece = d.category === 'hoodie' || d.category === 'crewneck';
  const neckScoop = front ? 'Q200 100 158 40' : 'Q200 54 158 40';
  const rib = front ? 'M150 43 Q200 118 250 43' : 'M150 43 Q200 66 250 43';
  let s = `<svg viewBox="0 -40 400 480" xmlns="http://www.w3.org/2000/svg" fill="none" stroke-linejoin="round" stroke-linecap="round">`;
  s += `<defs><pattern id="rib${side}" width="5" height="10" patternUnits="userSpaceOnUse"><path d="M2.5 0V10" stroke="${stroke}" stroke-opacity=".25" stroke-width=".8"/></pattern></defs>`;
  if (bg) s += `<rect x="0" y="-40" width="400" height="480" fill="${bg}"/>`;
  if (d.category === 'hoodie') {
    s += front
      ? `<path d="M150 46 C132 6 160 -26 200 -28 C240 -26 268 6 250 46 Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/><path d="M166 54 C164 14 236 14 234 54 Q200 104 166 54Z" fill="${dark}" stroke="${stroke}" stroke-width="${sw}"/>`
      : '';
  }
  s += `<path d="${F.body} ${neckScoop}Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
  s += `<path d="M158 40 Q200 ${front ? 54 : 46} 242 40 ${front ? 'Q200 100 158 40' : 'Q200 54 158 40'}Z" fill="${dark}" stroke="${stroke}" stroke-width="${sw * .8}"/>`;
  if (d.category !== 'hoodie' || !front) s += `<path d="${rib}" stroke="${stroke}" stroke-width="${sw * .8}"/><path d="M158 40 ${neckScoop.replace('Q', 'Q')}" stroke="${stroke}" stroke-width="${sw * .8}"/>`;
  if (d.category === 'hoodie' && !front) s += `<path d="M146 64 C128 -4 272 -4 254 64 C246 116 154 116 146 64Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/><path d="M200 -2 L200 108" stroke="${stroke}" stroke-width="${sw * .7}" stroke-dasharray="3 3"/>`;
  (F.stitch || []).forEach(p => s += `<path d="${p}" stroke="${stroke}" stroke-width=".9" stroke-dasharray="3 2.5"/>`);
  (F.cuffs || []).forEach(p => s += `<path d="${p}" stroke="${stroke}" stroke-width="${sw * .8}"/>`);
  if (F.band) s += `<rect x="111" y="386" width="178" height="33" fill="url(#rib${side})"/><path d="${F.band}" stroke="${stroke}" stroke-width="${sw * .8}"/>`;
  if (d.category === 'hoodie' && front) {
    s += `<path d="M138 296 L262 296 L284 376 L116 376Z" fill="${shade(fill, .04)}" stroke="${stroke}" stroke-width="${sw * .9}"/><path d="M142 300 L258 300 M138 296 L116 376 M262 296 L284 376" stroke="${stroke}" stroke-width=".9" stroke-dasharray="3 2.5"/>`;
    s += `<path d="M188 80 C186 120 190 150 184 186 M212 80 C214 120 210 150 216 186" stroke="${shade(g.trim, -.25)}" stroke-width="3"/><circle cx="188" cy="80" r="3" stroke="${stroke}"/><circle cx="212" cy="80" r="3" stroke="${stroke}"/>`;
  }
  if (fleece && front) s += `<path d="M150 43 Q200 124 250 43" stroke="${stroke}" stroke-width=".9" stroke-dasharray="3 2.5"/>`;
  if (art) {
    const url = Art.thumbURL(d, side);
    if (url) { const R = artRectFlat(d, side); s += `<image href="${url}" x="${R.x}" y="${R.y}" width="${R.w}" height="${R.w}" transform="rotate(${front ? d.place[side].r : -d.place[side].r} ${R.x + R.w / 2} ${R.y + R.w / 2})"/>`; }
  }
  return s + '</svg>';
}
function artRectFlat(d, side) {
  const fit = FITS[d.garment.fit] || FITS.boxy, P = d.place[side];
  const ppi = 178 / (2 * fit.w * 10); // flat px per inch
  const w = 14 * P.s * ppi, cx = 200 + (side === 'front' ? 1 : -1) * P.dx * ppi * -(-1);
  return { x: cx - w / 2, y: 40 + P.top * ppi, w };
}
function watchFlat(d, side, stroke) {
  const W = d.watch, wa = WOODS[W.caseWood] || WOODS.walnut, st = WOODS[W.strapWood] || WOODS.walnut, ac = WOODS[W.strapAccent] || WOODS.maple;
  let s = `<svg viewBox="0 -40 400 480" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="${stroke}" stroke-width="1.4">`;
  for (let i = 0; i < 4; i++) { // strap links top + bottom
    const y1 = 70 - i * 30, y2 = 330 + i * 30, w = 96 - i * 4;
    [y1, y2].forEach(y => { s += `<rect x="${200 - w / 2}" y="${y - 13}" width="${w * .26}" height="26" rx="3" fill="${ac.a}"/><rect x="${200 - w / 2 + w * .27}" y="${y - 13}" width="${w * .46}" height="26" rx="3" fill="${st.a}"/><rect x="${200 + w / 2 - w * .26}" y="${y - 13}" width="${w * .26}" height="26" rx="3" fill="${ac.a}"/>`; });
  }
  s += `<rect x="150" y="84" width="22" height="40" rx="4" fill="${wa.a}"/><rect x="228" y="84" width="22" height="40" rx="4" fill="${wa.a}"/><rect x="150" y="276" width="22" height="40" rx="4" fill="${wa.a}"/><rect x="228" y="276" width="22" height="40" rx="4" fill="${wa.a}"/>`;
  s += `<rect x="292" y="190" width="16" height="20" rx="3" fill="#bdbbb6"/><circle cx="200" cy="200" r="98" fill="${wa.a}"/>`;
  if (side === 'front') {
    const bz = BEZELS[W.bezel]; s += `<circle cx="200" cy="200" r="88" fill="${bz?.c || wa.b}"/><circle cx="200" cy="200" r="80" fill="${W.dial}"/>`;
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, r1 = i === 0 ? 62 : 66, r2 = 76; s += `<line x1="${200 + Math.sin(a) * r1}" y1="${200 - Math.cos(a) * r1}" x2="${200 + Math.sin(a) * r2}" y2="${200 - Math.cos(a) * r2}" stroke="${W.index}" stroke-width="${i % 3 ? 2 : 3.4}"/>`; }
    s += `<line x1="200" y1="200" x2="200" y2="148" stroke="${W.index}" stroke-width="4"/><line x1="200" y1="200" x2="242" y2="214" stroke="${W.index}" stroke-width="3"/><line x1="200" y1="214" x2="200" y2="134" stroke="${W.accent}" stroke-width="1.2"/><circle cx="200" cy="200" r="4" fill="${W.index}" stroke="none"/>`;
    s += `<text x="200" y="250" text-anchor="middle" font-family="JetBrains Mono" font-size="9" fill="${W.index}" stroke="none">N° ${String(W.editionNo).padStart(3, '0')}/${d.edition || 150}</text>`;
  } else {
    s += `<circle cx="200" cy="200" r="80" fill="#cfcdc8"/><circle cx="200" cy="200" r="72" stroke-dasharray="2 3"/>`;
    [[150, 150], [250, 150], [150, 250], [250, 250]].forEach(([x, y]) => s += `<circle cx="${x}" cy="${y}" r="4" fill="#9a9893"/>`);
    s += `<text x="200" y="196" text-anchor="middle" font-family="JetBrains Mono" font-size="10" fill="#141310" stroke="none">N° ${String(W.editionNo).padStart(3, '0')} / ${d.edition || 150}</text><text x="200" y="214" text-anchor="middle" font-family="Archivo" font-size="7.5" letter-spacing="1.5" fill="#141310" stroke="none">${esc(W.engraving)}</text>`;
  }
  return s + '</svg>';
}

/* =========================================================================
   7. Library
   ========================================================================= */
const Library = {
  render() {
    const q = $('#libSearch').value.trim().toLowerCase(), st = $('#libStatus').value;
    const list = S.designs.filter(d => (S.filter === 'all' || d.category === S.filter) && (!st || d.status === st)
      && (!q || [d.name, d.styleNo, d.drop, d.season, d.factory].join(' ').toLowerCase().includes(q))).sort((a, b) => b.updated - a.updated);
    $('#libCount').textContent = S.designs.length;
    const c = s => S.designs.filter(d => d.status === s).length;
    $('#libStats').innerHTML = [['In concept', c('Concept')], ['Sampling', c('Sampling') + c('Revision')], ['Approved', c('Approved')], ['Production', c('Production')]]
      .map(([l, n]) => `<div><b>${String(n).padStart(2, '0')}</b><span class="cap">${l}</span></div>`).join('');
    $('#cards').innerHTML = `<button class="card new" id="cardNew"><div><div class="plus">+</div><b>New design</b><span class="cap">Tee · fleece · watch</span></div></button>` +
      list.map(d => `<div class="card" data-id="${d.id}" tabindex="0">
        <div class="th">${d.thumb ? `<img src="${d.thumb}" alt="">` : flatSVG(d, 'front')}<span class="no">${esc(d.styleNo)}</span>
          <div class="acts"><button data-act="dup">Duplicate</button><button data-act="del">Delete</button></div></div>
        <div class="meta"><div class="t">${esc(d.name)}</div>
          <div class="l"><span class="pill" data-s="${d.status}">${d.status}</span><span class="mono" style="color:var(--muted)">${CATS[d.category].label} · ${ago(d.updated)}</span></div></div></div>`).join('');
    $('#cardNew').onclick = () => Library.newModal();
  },
  newModal(prefill) {
    let cat = prefill?.category || 'tee';
    const ico = c => flatSVG({ ...newDesignShell(c) }, 'front', { art: false, stroke: '#EEF1F9' });
    modal(`<h2>New design</h2><p class="sub">Pick the base. Specs, BOM and grading prefill from the DPP starter templates.</p>
      <div class="cat-pick">${Object.keys(CATS).map(c => `<button data-c="${c}" class="${c === cat ? 'on' : ''}">${ico(c)}${CATS[c].label}</button>`).join('')}</div>
      <div class="fld" style="margin-top:16px"><label>Name</label><input class="in" id="nName" placeholder="e.g. Blueprint 01 — Sand" value="${esc(prefill?.name || '')}"></div>
      <div class="acts"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Create</button></div>`, (m, close) => {
      $$('.cat-pick button', m).forEach(b => b.onclick = () => { cat = b.dataset.c; $$('.cat-pick button', m).forEach(x => x.classList.toggle('on', x === b)); });
      $('[data-x]', m).onclick = close;
      $('[data-ok]', m).onclick = async () => { const d = newDesign(cat, $('#nName').value.trim()); if (prefill?.apply) prefill.apply(d); S.designs.push(d); await DB.put('designs', d); close(); openDesign(d.id, prefill?.view || 'studio'); };
      $('#nName').focus();
    });
  },
  async dup(id) {
    const src = S.designs.find(d => d.id === id); const d = structuredClone(src);
    d.id = uid('d_'); d.name = src.name + ' (copy)'; d.created = d.updated = Date.now(); d.status = 'Concept';
    d.styleNo = `DPP-${CATS[d.category].code}-${String(S.designs.filter(x => x.category === d.category).length + 1).padStart(3, '0')}`;
    d.revisions = [row({ date: today(), author: Settings.get().designer, note: 'Duplicated from ' + src.styleNo })];
    S.designs.push(d); await DB.put('designs', d); this.render(); toast('Duplicated ' + src.styleNo);
  },
  async del(id) {
    const d = S.designs.find(x => x.id === id);
    if (!await confirmBox('Delete ' + d.styleNo + '?', `“${d.name}” and its specs will be removed from this device. Export a backup first if unsure.`)) return;
    S.designs = S.designs.filter(x => x.id !== id); await DB.del('designs', id);
    if (S.current?.id === id) { S.current = null; renderCtx(); }
    this.render(); toast('Deleted ' + d.styleNo);
  },
};
function newDesignShell(cat) { return { category: cat, edition: 150, garment: { color: '#1e2236', trim: '#1e2236', fit: 'boxy' }, watch: { dia: 42, caseWood: 'walnut', bezel: 'steel', dial: '#1e2236', index: '#EEF1F9', accent: '#B98A4A', strapWood: 'walnut', strapAccent: 'walnut', editionNo: 1, engraving: '' }, place: { front: {}, back: {} } }; }

/* =========================================================================
   8. Procedural textures
   ========================================================================= */
const TEX = {
  _c: {},
  canvas(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; },
  repeat(t, x, y) { const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(x, y); c.needsUpdate = true; return c; },
  knit(kind) {
    const k = 'knit' + kind; if (this._c[k]) return this._c[k];
    const c = this.canvas(256, 256, (x, w, h) => {
      x.fillStyle = '#808080'; x.fillRect(0, 0, w, h);
      const im = x.getImageData(0, 0, w, h), p = im.data;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        let v = 128 + (Math.random() - .5) * 26;
        if (kind === 'waffle') v += ((i % 32 < 4) || (j % 32 < 4)) ? 60 : -10;
        else if (kind !== 'fleece') v += Math.sin((i % 8) / 8 * Math.PI * 2) * 22 + ((j + (i % 8 < 4 ? 0 : 3)) % 6 < 3 ? 10 : -10);
        const o = (j * w + i) * 4; p[o] = p[o + 1] = p[o + 2] = v;
      }
      x.putImageData(im, 0, 0);
    });
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return (this._c[k] = t);
  },
  rib() {
    if (this._c.rib) return this._c.rib;
    const c = this.canvas(64, 64, (x, w, h) => { for (let i = 0; i < w; i++) { const v = 128 + Math.sin(i / 8 * Math.PI * 2) * 90; x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(i, 0, 1, h); } });
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return (this._c.rib = t);
  },
  wood(sp) {
    const k = 'wood' + sp; if (this._c[k]) return this._c[k];
    const W = WOODS[sp] || WOODS.walnut, zebra = sp === 'zebrawood';
    const c = this.canvas(1024, 512, (x, w, h) => {
      x.fillStyle = W.a; x.fillRect(0, 0, w, h);
      const [br, bg, bb] = hexToRgb(W.b);
      for (let n = 0; n < (zebra ? 46 : 150); n++) {
        const y0 = Math.random() * h, amp = 4 + Math.random() * 14, f = .004 + Math.random() * .01, ph = Math.random() * 7;
        x.strokeStyle = `rgba(${br},${bg},${bb},${zebra ? .55 + Math.random() * .35 : .08 + Math.random() * .3})`;
        x.lineWidth = zebra ? 3 + Math.random() * 6 : .6 + Math.random() * 2.4;
        x.beginPath(); for (let i = 0; i <= w; i += 8) { const y = y0 + Math.sin(i * f + ph) * amp + Math.sin(i * f * 3.1 + ph) * amp * .3; i ? x.lineTo(i, y) : x.moveTo(i, y); } x.stroke();
      }
      const im = x.getImageData(0, 0, w, h), p = im.data;
      for (let i = 0; i < p.length; i += 4) { const v = (Math.random() - .5) * 14; p[i] += v; p[i + 1] += v; p[i + 2] += v; }
      x.putImageData(im, 0, 0);
    });
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return (this._c[k] = t);
  },
  // cloud field 0..1 — layered upscaled random grids (cheap fbm)
  clouds(w, h, octaves = [6, 12, 24, 48, 96]) {
    const c = this.canvas(w, h, (x) => {
      x.fillStyle = '#808080'; x.fillRect(0, 0, w, h); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      octaves.forEach((n, i) => { const g = this.canvas(n * 2, n, (y, gw, gh) => { const im = y.createImageData(gw, gh); for (let p = 0; p < im.data.length; p += 4) { const v = Math.random() * 255; im.data[p] = im.data[p + 1] = im.data[p + 2] = v; im.data[p + 3] = 255; } y.putImageData(im, 0, 0); }); x.globalAlpha = .62 / (i + 1); x.drawImage(g, 0, 0, w, h); });
    });
    const d = c.getContext('2d').getImageData(0, 0, w, h).data, f = new Float32Array(w * h);
    let lo = 1, hi = 0; for (let i = 0; i < f.length; i++) { f[i] = d[i * 4] / 255; lo = Math.min(lo, f[i]); hi = Math.max(hi, f[i]); }
    for (let i = 0; i < f.length; i++) f[i] = (f[i] - lo) / (hi - lo || 1);
    return f;
  },
  // Color map (wash/finish baked into the body color) + alpha map (distress holes, frayed hem)
  surface(hex, finish = 'none', distress = 'none', withAlpha = true) {
    const ck = ['surf', hex, finish, distress, withAlpha].join(':'); if (this._c[ck]) return this._c[ck];
    const W = 1024, H = 512, [r, g, b] = hexToRgb(hex), L = lum(hex);
    const bleach = finish === 'bleach' && L < .35 ? [196, 126, 86] : finish === 'acid' || finish === 'stone' ? [206, 208, 212] : [238, 236, 230];
    const sm = (a, z, x) => { const t = clamp((x - a) / (z - a), 0, 1); return t * t * (3 - 2 * t); };
    const map = this.canvas(W, H, (x) => {
      const im = x.createImageData(W, H), p = im.data;
      const f = finish === 'none' ? null : this.clouds(W, H, finish === 'acid' ? [5, 10, 22, 44, 90] : [4, 8, 16, 40]);
      for (let i = 0; i < W * H; i++) {
        let k = 0, n = (Math.random() - .5) * 8;
        if (finish === 'acid') { const v = f[i]; k = sm(.5, .7, v) * .62 + (Math.abs(v - .56) < .014 ? .22 : 0); }
        else if (finish === 'mineral') k = sm(.3, .85, f[i]) * .38;
        else if (finish === 'stone') k = sm(.35, .9, f[i]) * .22 + (Math.random() < .08 ? .12 : 0);
        else if (finish === 'vintage') k = .14 + (f[i] - .5) * .14;
        const o = i * 4;
        p[o] = lerp(r, bleach[0], k) + n; p[o + 1] = lerp(g, bleach[1], k) + n; p[o + 2] = lerp(b, bleach[2], k) + n; p[o + 3] = 255;
        if (finish === 'vintage') { const m = (p[o] + p[o + 1] + p[o + 2]) / 3; p[o] = lerp(p[o], m, .18); p[o + 1] = lerp(p[o + 1], m, .18); p[o + 2] = lerp(p[o + 2], m, .18); }
      }
      x.putImageData(im, 0, 0);
      if (finish === 'bleach') {
        const [br, bg, bb] = bleach;
        for (let s = 0; s < 70; s++) {
          const cx = Math.random() * W, cy = Math.random() * H, rad = 2 + Math.random() ** 3 * 26;
          const gr = x.createRadialGradient(cx, cy, 0, cx, cy, rad); gr.addColorStop(0, `rgba(${br},${bg},${bb},.95)`); gr.addColorStop(.6, `rgba(${br},${bg},${bb},.55)`); gr.addColorStop(1, `rgba(${br},${bg},${bb},0)`);
          x.fillStyle = gr; x.beginPath(); x.ellipse(cx, cy, rad, rad * (.6 + Math.random() * .6), Math.random() * 3, 0, 7); x.fill();
          for (let d = 0; d < 6; d++) { x.beginPath(); x.arc(cx + (Math.random() - .5) * rad * 5, cy + (Math.random() - .5) * rad * 5, Math.random() * 2.5 + .5, 0, 7); x.fill(); }
        }
      }
    });
    let alpha = null;
    if (distress !== 'none') {
      const mx = map.getContext('2d'), heavy = distress === 'heavy', rim = L < .4 ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.18)';
      // scuffs
      for (let s = 0; s < (heavy ? 40 : 22); s++) { mx.fillStyle = rim; mx.globalAlpha = .35; mx.beginPath(); mx.ellipse(Math.random() * W, Math.random() * H, 6 + Math.random() * 30, 2 + Math.random() * 6, Math.random() * 3, 0, 7); mx.fill(); }
      mx.globalAlpha = 1;
      alpha = this.canvas(W, H, (x) => {
        x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.fillStyle = '#000';
        // frayed hem — canvas bottom = garment hem (flipY)
        x.beginPath(); x.moveTo(0, H); for (let i = 0; i <= W; i += 3) x.lineTo(i, H - (heavy ? 4 : 2) - Math.random() * (heavy ? 10 : 4)); x.lineTo(W, H); x.fill();
        const holes = heavy ? 14 : 0;
        for (let hI = 0; hI < holes; hI++) {
          const cx = Math.random() * W, cy = H * (.12 + Math.random() * .7), rw = 6 + Math.random() * 22, rh = 3 + Math.random() * 9;
          x.fillStyle = '#000'; x.beginPath(); for (let a = 0; a < 6.28; a += .5) { const rr = 1 - Math.random() * .35; x.lineTo(cx + Math.cos(a) * rw * rr, cy + Math.sin(a) * rh * rr); } x.fill();
          // weft threads left across the hole
          x.strokeStyle = '#fff'; x.lineWidth = 1; for (let tY = cy - rh; tY < cy + rh; tY += 2.5) if (Math.random() < .55) { x.beginPath(); x.moveTo(cx - rw, tY); x.lineTo(cx + rw, tY + (Math.random() - .5)); x.stroke(); }
          mx.globalAlpha = .5; mx.strokeStyle = rim; mx.lineWidth = 1.5; mx.beginPath(); mx.ellipse(cx, cy, rw + 2, rh + 2, 0, 0, 7); mx.stroke(); mx.globalAlpha = 1;
        }
      });
    }
    const tm = new THREE.CanvasTexture(map); tm.colorSpace = THREE.SRGBColorSpace; tm.anisotropy = 8;
    let ta = null; if (alpha && withAlpha) ta = new THREE.CanvasTexture(alpha);
    return (this._c[ck] = { map: tm, alpha: ta, canvas: map });
  },
};
// satin-stitch look for embroidery / chenille / patches, drawn over composited art
function stitchify(src, tech, garmentHex) {
  const S = src.width, c = TEX.canvas(S, S, () => { }), x = c.getContext('2d');
  if (/patch/i.test(tech)) { // backing patch around the art bounds with merrow edge
    const bb = alphaBounds(src);
    if (bb) { const pad = S * .03, rr = S * .04; x.fillStyle = /Chenille/.test(tech) ? '#EEF1F9' : '#14172B'; x.strokeStyle = /Chenille/.test(tech) ? '#14172B' : '#B98A4A'; x.lineWidth = S * .012; x.beginPath(); x.roundRect(bb.x - pad, bb.y - pad, bb.w + pad * 2, bb.h + pad * 2, rr); x.fill(); x.stroke(); }
  }
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-atop';
  if (/Tonal/.test(tech)) { x.fillStyle = shade(garmentHex, lum(garmentHex) > .5 ? -.12 : .14); x.fillRect(0, 0, S, S); }
  const step = Math.max(3, S / 170);
  if (/Chenille/.test(tech)) { for (let i = 0; i < S * S / 60; i++) { x.fillStyle = Math.random() < .5 ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.16)'; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, step * .45, 0, 7); x.fill(); } }
  else for (let i = -S; i < S * 2; i += step) { x.strokeStyle = 'rgba(0,0,0,.26)'; x.lineWidth = step * .38; x.beginPath(); x.moveTo(i, 0); x.lineTo(i - S * .55, S); x.stroke(); x.strokeStyle = 'rgba(255,255,255,.2)'; x.lineWidth = step * .22; x.beginPath(); x.moveTo(i + step * .45, 0); x.lineTo(i + step * .45 - S * .55, S); x.stroke(); }
  x.globalCompositeOperation = 'source-over';
  return c;
}
function alphaBounds(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y += 2) for (let i = 0; i < c.width; i += 2) if (d[(y * c.width + i) * 4 + 3] > 20) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function artCoverage(d, side) { // fraction of print zone covered by ink — drives the stitch estimate
  const c = Art.composite(d, side, 256), p = c.getContext('2d').getImageData(0, 0, 256, 256).data; let n = 0;
  for (let i = 3; i < p.length; i += 4) if (p[i] > 60) n++; return n / (256 * 256);
}

/* =========================================================================
   9. 3D Studio — procedural garments + wood watch
   ========================================================================= */
function torsoFn(P) {
  const split = .86;
  return (u, v, t) => {
    const a = u * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    let rx, rz, y;
    if (v <= split) {
      const k = v / split, prof = 1 + P.flare * (1 - k) - .03 * Math.sin(k * Math.PI);
      rx = P.w * prof; rz = P.d * prof * (1 + .1 * Math.max(0, s) * Math.sin(k * Math.PI * .9));
      y = -P.h / 2 + k * P.h;
    } else {
      const k = (v - split) / (1 - split), ex = Math.sin(k * Math.PI / 2), ez = Math.pow(k, 1.8), e = k * k * (3 - 2 * k);
      rx = lerp(P.w, P.neckR, ex); rz = lerp(P.d, P.neckR * .8, ez);
      y = P.h / 2 + P.rise * ex - P.neckDrop * Math.pow(Math.max(0, s), 1.5) * e * e;
    }
    t.set(rx * c, y, rz * s);
  };
}
const bandFn = (rx, rz, y0, h, taper = .94) => (u, v, t) => { const a = u * Math.PI * 2, k = lerp(1, taper, v); t.set(rx * k * Math.cos(a), y0 - v * h, rz * k * Math.sin(a)); };

const Studio = {
  ok: false, spin: false, root: null, decals: [], dial: null, hands: null,
  init() {
    const host = $('#stage');
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = .82;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    host.prepend(r.domElement);
    const sc = this.scene = new THREE.Scene(); sc.background = new THREE.Color('#121527');
    const pm = new THREE.PMREMGenerator(r); sc.environment = pm.fromScene(new RoomEnvironment(), .04).texture; sc.environmentIntensity = .55;
    const cam = this.camera = new THREE.PerspectiveCamera(30, 1, .1, 100); cam.position.set(0, .5, 10);
    const ctl = this.controls = new OrbitControls(cam, r.domElement); ctl.enableDamping = true; ctl.dampingFactor = .08; ctl.minDistance = 2.5; ctl.maxDistance = 18; ctl.autoRotateSpeed = 2.2;
    const key = new THREE.DirectionalLight(0xfff6ec, 1.7); key.position.set(4, 7, 6); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: .5, far: 30 }); key.shadow.bias = -.0005; key.shadow.radius = 6;
    const rim = new THREE.DirectionalLight(0xe2c792, 1.2); rim.position.set(-6, 3, -5);
    const fill = new THREE.HemisphereLight(0xffffff, 0x2a241c, .55);
    sc.add(key, rim, fill);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: .32 })); this.ground.rotation.x = -Math.PI / 2; this.ground.receiveShadow = true; sc.add(this.ground);
    this.root = new THREE.Group(); sc.add(this.root);
    new ResizeObserver(() => this.resize()).observe(host); this.resize();
    const loop = () => {
      requestAnimationFrame(loop);
      if (S.view !== 'studio') return;
      ctl.autoRotate = this.spin; ctl.update(); this.tickHands(); r.render(sc, cam);
    };
    loop();
    $('#stageLoading').remove(); this.ok = true;
    $$('#viewPresets button').forEach(b => b.onclick = () => this.view(b.dataset.v));
    $('#btnSpin').onclick = e => { this.spin = !this.spin; e.target.classList.toggle('on', this.spin); };
    $$('#bgPresets button').forEach(b => b.onclick = () => { sc.background.set(b.dataset.bg); $$('#bgPresets button').forEach(x => x.classList.toggle('on', x === b)); });
  },
  resize() { const h = $('#stage'); const w = h.clientWidth, ht = h.clientHeight; if (!w || !ht) return; this.renderer.setSize(w, ht, false); this.camera.aspect = w / ht; this.camera.updateProjectionMatrix(); },
  show() {
    if (!this.ok) this.init();
    this.resize(); this.build(); Panels.studio();
  },
  clear() {
    this.root.traverse(o => { if (o.isMesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map && m.map.userData.own) m.map.dispose(); m.dispose(); }); } });
    this.root.clear(); this.decals = []; this.dial = null; this.hands = null; this.torso = null;
  },
  build() {
    const d = S.current; if (!d || !this.ok) return;
    this.clear();
    if (d.category === 'watch') this.buildWatch(d); else this.buildGarment(d);
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.root); this.ground.position.y = box.min.y - .01;
    this.frame(box);
    $('#stageLabel').innerHTML = `${esc(d.name)}<span>${esc(d.styleNo)} · ${CATS[d.category].label}${d.category === 'watch' ? ' · ' + d.watch.dia + ' mm' : ' · ' + FITS[d.garment.fit].label}</span>`;
  },
  frame(box) {
    const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    this.center = c; this.radius = Math.max(sz.x, sz.y, sz.z) * .5;
    this.controls.target.copy(c); this.view(this.lastView || 'three', true);
  },
  view(v, instant) {
    this.lastView = v;
    const dist = this.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.22;
    const dir = { front: [0, .08, 1], back: [0, .08, -1], side: [1, .08, 0], three: [.62, .2, .78] }[v];
    const p = new THREE.Vector3(...dir).normalize().multiplyScalar(dist).add(this.center);
    this.camera.position.copy(p); this.controls.target.copy(this.center); this.controls.update();
    $$('#viewPresets button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  },
  fabricMat(hex, fabric, rib, rx = 30, ry = 18, surf = null) {
    const f = FABRICS[fabric] || FABRICS.jersey;
    const bump = TEX.repeat(rib ? TEX.rib() : TEX.knit(fabric === 'waffle' ? 'waffle' : fabric === 'fleece' ? 'fleece' : 'jersey'), rib ? rx * 3 : rx, rib ? 1 : ry);
    bump.userData.own = true;
    return new THREE.MeshPhysicalMaterial({ color: hex, roughness: f.rough, sheen: f.sheen, sheenRoughness: .75, sheenColor: new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), .3), side: THREE.DoubleSide, bumpMap: bump, bumpScale: (rib ? 1.4 : f.bump),
      ...(surf ? { color: '#ffffff', sheenColor: new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), .3), map: surf.map, ...(surf.alpha ? { alphaMap: surf.alpha, alphaTest: .5 } : {}) } : {}) });
  },
  add(geo, mat, cast = true) { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; this.root.add(m); return m; },
  buildGarment(d) {
    const g = d.garment, cat = d.category, fit = FITS[g.fit] || FITS.boxy;
    const fleece = cat === 'hoodie' || cat === 'crewneck', long = cat !== 'tee';
    const P = this.P = { w: fit.w, d: fit.w * .42, h: fit.h, flare: .02, neckR: cat === 'hoodie' ? .36 : .34, neckDrop: fleece ? .08 : .17, rise: .3 };
    const fin = g.finish || 'none', dis = g.distress || 'none', washed = fin !== 'none' || dis !== 'none';
    const surf = washed ? TEX.surface(g.color, fin, dis) : null, trimSurf = fin !== 'none' ? TEX.surface(g.trim, fin, 'none', false) : null;
    const body = this.fabricMat(g.color, g.fabric, false, 30, 18, surf), trim = this.fabricMat(g.trim, g.fabric, true, 30, 18, trimSurf);
    const tg = new ParametricGeometry(torsoFn(P), 160, 90); tg.computeVertexNormals();
    this.torso = this.add(tg, body);
    const fn = torsoFn(P), pt = new THREE.Vector3();
    const ring = v => { const a = []; for (let i = 0; i < 96; i++) { fn(i / 96, v, pt); a.push(pt.clone()); } return new THREE.CatmullRomCurve3(a, true); };
    this.add(new THREE.TubeGeometry(ring(1), 160, fleece ? .075 : .05, 12, true), trim);
    if (fleece) {
      const bw = P.w * (1 + P.flare) * .985, bd = P.d * (1 + P.flare) * .985;
      const bg = new ParametricGeometry(bandFn(bw, bd, -P.h / 2 + .02, .3), 96, 6); bg.computeVertexNormals(); this.add(bg, trim);
    } else this.add(new THREE.TubeGeometry(ring(0), 160, .022, 8, true), body);
    // sleeves
    const armR = (long ? .38 : .42) * fit.w, len = long ? 2.3 : 1.0, openR = long ? .2 : .34, ang = long ? .28 : .8;
    [1, -1].forEach(side => {
      const piv = new THREE.Group();
      piv.position.set(side * (P.w * .74 + fit.drop * .35), P.h / 2 - armR * (long ? .8 : .45) - fit.drop * .4, 0); piv.rotation.z = side * ang;
      const sg = new THREE.CylinderGeometry(armR, openR, len, 56, 12, true); sg.translate(0, -len / 2, 0); sg.scale(1, 1, .78);
      const sm = new THREE.Mesh(sg, this.fabricMat(g.color, g.fabric, false, 14, 10, surf)); sm.castShadow = sm.receiveShadow = true; piv.add(sm);
      if (long) {
        const cg = new THREE.CylinderGeometry(openR * 1.02, openR * .95, fleece ? .32 : .26, 40, 1, true); cg.translate(0, -len - (fleece ? .14 : .11), 0); cg.scale(1, 1, .82);
        const cm = new THREE.Mesh(cg, trim); cm.castShadow = true; piv.add(cm);
      } else {
        const tor = new THREE.TorusGeometry(openR, .02, 8, 56); tor.rotateX(Math.PI / 2); tor.scale(1, 1, .82); tor.translate(0, -len, 0);
        piv.add(new THREE.Mesh(tor, body));
      }
      this.root.add(piv);
    });
    if (cat === 'hoodie') {
      const hood = new THREE.SphereGeometry(1, 48, 32, 0, Math.PI * 2, 0, Math.PI * .62);
      const hm = this.add(hood, this.fabricMat(g.color, g.fabric, false, 10, 8, surf ? TEX.surface(g.color, fin, 'none', false) : null));
      hm.scale.set(.64, .5, .5); hm.position.set(0, P.h / 2 + P.rise - .02, -P.d * .62); hm.rotation.x = -1.05;
      const yN = P.h / 2 + P.rise - P.neckDrop, zN = P.neckR * .8;
      [-1, 1].forEach(s => {
        const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(s * .12, yN + .02, zN + .02), new THREE.Vector3(s * .13, yN - .3, P.d * .9 + .04), new THREE.Vector3(s * .15, yN - .95, P.d * 1.06 + .03)]);
        this.add(new THREE.TubeGeometry(curve, 30, .018, 8), new THREE.MeshStandardMaterial({ color: shade(g.trim, -.08), roughness: .9 }));
        const ag = new THREE.CylinderGeometry(.024, .02, .1, 12); const am = this.add(ag, new THREE.MeshStandardMaterial({ color: '#b9b6ae', metalness: 1, roughness: .35 }));
        am.position.copy(curve.getPoint(1)).add(new THREE.Vector3(0, -.04, 0));
      });
      this.pocket = this.detailDecal(new THREE.Vector3(0, -P.h / 2 + .62, P.d), new THREE.Vector3(1.32, .8, .9), this.pocketTex(g));
    }
    this.updateDecals();
  },
  pocketTex(g) {
    const c = TEX.canvas(512, 320, (x, w, h) => {
      x.clearRect(0, 0, w, h);
      x.beginPath(); x.moveTo(90, 18); x.lineTo(422, 18); x.lineTo(500, 302); x.lineTo(12, 302); x.closePath();
      x.fillStyle = shade(g.color, .03); x.fill();
      x.strokeStyle = 'rgba(0,0,0,.28)'; x.lineWidth = 3; x.stroke();
      x.setLineDash([9, 7]); x.strokeStyle = lum(g.stitch) > .5 ? 'rgba(255,255,255,.45)' : 'rgba(0,0,0,.45)'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(98, 30); x.lineTo(414, 30); x.stroke();
      x.beginPath(); x.moveTo(90, 18); x.lineTo(14, 300); x.moveTo(422, 18); x.lineTo(498, 300); x.stroke();
      const gr = x.createLinearGradient(0, 18, 0, 48); gr.addColorStop(0, 'rgba(0,0,0,.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.setLineDash([]); x.fillStyle = gr; x.fillRect(90, 18, 332, 30);
    });
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.userData.own = true; return t;
  },
  detailDecal(pos, size, tex, rotZ = 0, back = false, bump = false) {
    this.torso.updateMatrixWorld(true);
    const geo = new DecalGeometry(this.torso, pos, new THREE.Euler(0, back ? Math.PI : 0, rotZ), size);
    const mat = new THREE.MeshPhysicalMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: .85, sheen: .3, side: THREE.DoubleSide, ...(bump ? { bumpMap: tex, bumpScale: bump === true ? 3 : bump } : {}) });
    const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.renderOrder = 2; this.root.add(m); return m;
  },
  updateDecals() {
    const d = S.current; if (!d || d.category === 'watch' || !this.torso) return;
    this.decals.forEach(m => { this.root.remove(m); m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose(); }); this.decals = [];
    ['front', 'back'].forEach(side => {
      if (!d.artwork[side].some(l => !l.hidden)) return;
      const P = d.place[side], size = 1.4 * P.s, hps = this.P.h / 2 + this.P.rise;
      const cy = hps - (P.top + 7 * P.s) / 10, x = (side === 'front' ? 1 : -1) * P.dx / 10;
      let art = Art.composite(d, side, 1024); if (isStitch(P.tech)) art = stitchify(art, P.tech, d.garment.color);
      const tex = new THREE.CanvasTexture(art); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      const puff = /Puff|embroider|Chenille|patch/i.test(P.tech);
      const m = this.detailDecal(new THREE.Vector3(x, cy, side === 'front' ? this.P.d : -this.P.d), new THREE.Vector3(size, size, .95), tex, THREE.MathUtils.degToRad(side === 'front' ? -P.r : P.r), side === 'back', puff && (/3D puff|Chenille/i.test(P.tech) ? 6 : /Puff print/.test(P.tech) ? 4 : 2.2));
      if (P.tech === 'Discharge') m.material.opacity = .82;
      this.decals.push(m);
    });
  },
  /* ---------- watch ---------- */
  buildWatch(d) {
    const W = d.watch, sc = W.dia / 42, grp = new THREE.Group(); this.root.add(grp);
    const wood = sp => new THREE.MeshPhysicalMaterial({ map: TEX.wood(sp), roughness: .5, clearcoat: .55, clearcoatRoughness: .35 });
    const bz = BEZELS[W.bezel], metal = bz.m ? new THREE.MeshStandardMaterial({ color: bz.c, metalness: 1, roughness: bz.r }) : wood(W.caseWood);
    const steel = new THREE.MeshStandardMaterial({ color: '#c4c2bd', metalness: 1, roughness: .3 });
    const mk = (geo, mat, parent = grp) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
    const prof = [[0, -.42], [.9, -.42], [.98, -.39], [1.03, -.3], [1.06, -.12], [1.06, .16], [1.02, .28], [.96, .34], [.9, .35]].map(([x, y]) => new THREE.Vector2(x, y));
    mk(new THREE.LatheGeometry(prof, 120), wood(W.caseWood));
    const bez = mk(new THREE.TorusGeometry(.925, .05, 20, 120), metal); bez.rotation.x = Math.PI / 2; bez.position.y = .36;
    const dialTex = new THREE.CanvasTexture(this.dialCanvas(d)); dialTex.colorSpace = THREE.SRGBColorSpace; dialTex.anisotropy = 8; dialTex.userData.own = true;
    const dial = mk(new THREE.CircleGeometry(.89, 120), new THREE.MeshStandardMaterial({ map: dialTex, roughness: .55, metalness: .1 })); dial.rotation.x = -Math.PI / 2; dial.position.y = .31;
    // hands — pivot at center, pointing to 12 (-z)
    const hand = (len, w, col, y) => { const g = new THREE.BoxGeometry(w, .012, len); g.translate(0, 0, -len / 2 + .06); const m = mk(g, new THREE.MeshStandardMaterial({ color: col, metalness: .4, roughness: .4 })); m.position.y = y; return m; };
    this.hands = { h: hand(.5, .055, W.index, .325), m: hand(.74, .04, W.index, .34), s: hand(.82, .012, W.accent, .355) };
    mk(new THREE.CylinderGeometry(.04, .04, .06, 24), new THREE.MeshStandardMaterial({ color: W.index, metalness: .6, roughness: .3 })).position.y = .34;
    const cry = mk(new THREE.CircleGeometry(.9, 96), new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: .12, roughness: 0, metalness: 0, clearcoat: 1, envMapIntensity: 2 }), grp);
    cry.rotation.x = -Math.PI / 2; cry.position.y = .4; cry.castShadow = false;
    const crown = mk(new THREE.CylinderGeometry(.1, .1, .16, 32), steel); crown.rotation.z = Math.PI / 2; crown.position.set(1.13, 0, 0);
    mk(new THREE.CylinderGeometry(.06, .06, .08, 16), steel).rotation.z = Math.PI / 2;
    grp.children.at(-1).position.set(1.04, 0, 0);
    const lugMat = wood(W.caseWood);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => { const l = mk(new RoundedBoxGeometry(.2, .22, .44, 3, .06), lugMat); l.position.set(sx * .42, -.04, sz * 1.02); });
    // strap: 3-piece links following a wrist curve, butterfly clasp at the bottom
    const pts = [[0, .0, 1.2], [0, -.18, 1.55], [0, -.78, 1.86], [0, -1.6, 1.88], [0, -2.36, 1.48], [0, -2.78, .72], [0, -2.9, 0], [0, -2.78, -.72], [0, -2.36, -1.48], [0, -1.6, -1.88], [0, -.78, -1.86], [0, -.18, -1.55], [0, 0, -1.2]].map(p => new THREE.Vector3(...p));
    const curve = new THREE.CatmullRomCurve3(pts), L = curve.getLength(), pitch = .34, n = Math.floor(L / pitch);
    const mA = wood(W.strapWood), mB = wood(W.strapAccent), lw = .62;
    const gC = new RoundedBoxGeometry(lw * .5, .16, pitch * .9, 3, .045), gS = new RoundedBoxGeometry(lw * .24, .15, pitch * .9, 3, .045);
    for (let i = 0; i < n; i++) {
      const u = (i + .5) / n, p = curve.getPointAt(u), tg = curve.getTangentAt(u);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tg);
      const taper = lerp(1, .8, 1 - Math.abs(u - .5) * 2);
      if (Math.abs(u - .5) < .55 / n) { const c = mk(new RoundedBoxGeometry(lw * taper, .12, pitch * 1.6, 3, .03), steel); c.position.copy(p); c.quaternion.copy(q); continue; }
      const link = new THREE.Group(); link.position.copy(p); link.quaternion.copy(q); link.scale.set(taper, 1, 1); grp.add(link);
      mk(gC, mA, link);
      [-1, 1].forEach(s => { const sm = mk(gS, mB, link); sm.position.x = s * lw * .38; });
    }
    grp.scale.setScalar(sc); grp.rotation.x = .62;
  },
  dialCanvas(d) {
    const W = d.watch;
    return TEX.canvas(1024, 1024, (x, w) => {
      const c = w / 2;
      x.fillStyle = W.dial; x.beginPath(); x.arc(c, c, c, 0, Math.PI * 2); x.fill();
      const g = x.createRadialGradient(c, c * .7, 40, c, c, c); g.addColorStop(0, 'rgba(255,255,255,.08)'); g.addColorStop(1, 'rgba(0,0,0,.18)'); x.fillStyle = g; x.fill();
      x.strokeStyle = W.index; x.fillStyle = W.index;
      for (let i = 0; i < 60; i++) {
        const a = i / 60 * Math.PI * 2, hr = i % 5 === 0, r1 = hr ? 380 : 452, r2 = 478;
        x.lineWidth = hr ? 14 : 3; x.beginPath(); x.moveTo(c + Math.sin(a) * r1, c - Math.cos(a) * r1); x.lineTo(c + Math.sin(a) * r2, c - Math.cos(a) * r2); x.stroke();
        if (i === 0) { x.lineWidth = 9; [-14, 14].forEach(o => { x.beginPath(); x.moveTo(c + o, c - 372); x.lineTo(c + o, c - 478); x.stroke(); }); x.strokeStyle = W.dial; x.lineWidth = 16; x.beginPath(); x.moveTo(c, c - 372); x.lineTo(c, c - 478); x.stroke(); x.strokeStyle = W.index; }
      }
      Mark.draw(x, c, c - 228, 176, 150, W.index);
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = '500 26px "JetBrains Mono"'; x.letterSpacing = '6px';
      x.fillText(String(W.movement).toUpperCase().includes('AUTO') ? 'AUTOMATIC' : 'QUARTZ', c, c + 150);
      x.font = '600 34px "JetBrains Mono"'; x.letterSpacing = '4px';
      x.fillText(`N° ${String(W.editionNo).padStart(3, '0')}/${d.edition || 150}`, c, c + 215);
      x.font = '700 22px Archivo'; x.letterSpacing = '7px'; x.globalAlpha = .7;
      x.fillText("DON'T POSTPONE PASSION", c, c + 300); x.globalAlpha = 1;
    });
  },
  tickHands() {
    if (!this.hands) return;
    const t = new Date(), s = t.getSeconds() + t.getMilliseconds() / 1000, m = t.getMinutes() + s / 60, h = (t.getHours() % 12) + m / 60;
    this.hands.s.rotation.y = -s / 60 * Math.PI * 2; this.hands.m.rotation.y = -m / 60 * Math.PI * 2; this.hands.h.rotation.y = -h / 12 * Math.PI * 2;
  },
  /* ---------- output ---------- */
  snap(view, size = 1200) {
    const r = this.renderer, cam = this.camera, prev = { v: this.lastView, p: cam.position.clone(), a: cam.aspect, w: r.domElement.width / r.getPixelRatio(), h: r.domElement.height / r.getPixelRatio(), pr: r.getPixelRatio() };
    r.setPixelRatio(1); r.setSize(size, size, false); cam.aspect = 1; cam.updateProjectionMatrix();
    if (view) this.view(view);
    r.render(this.scene, cam); const url = r.domElement.toDataURL('image/jpeg', .9);
    r.setPixelRatio(prev.pr); r.setSize(prev.w, prev.h, false); cam.aspect = prev.a; cam.updateProjectionMatrix();
    if (view) { this.view(prev.v); cam.position.copy(prev.p); this.controls.update(); }
    return url;
  },
  async captureRenders(silent) {
    const d = S.current; if (!d) return;
    if (!this.ok) this.init(); if (!this.root.children.length) this.build();
    const bg = this.scene.background.clone(); this.scene.background.set('#efebe3');
    this.tickHands();
    const isW = d.category === 'watch';
    d.renders = { front: this.snap('front', 900), back: this.snap(isW ? 'three' : 'back', 900), three: this.snap('three', 900) };
    this.scene.background.copy(bg); d.thumb = this.snap('three', 480);
    touch(); if (!silent) toast('Renders saved to tech pack');
  },
  exportPNG() { const d = S.current; download(`${d.styleNo}_${this.lastView}.png`, this.snapPNG()); },
  snapPNG() { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/png'); },
  exportGLB() {
    const d = S.current;
    new GLTFExporter().parse(this.root, buf => download(`${d.styleNo}.glb`, new Blob([buf], { type: 'model/gltf-binary' })), err => toast('GLB export failed: ' + err.message, true), { binary: true });
  },
};

/* =========================================================================
   10. Side panels for the studio
   ========================================================================= */
const Panels = {
  colorField(path, label, val) {
    return `<div class="fld"><label>${label}<b data-out="${path}">${val.toUpperCase()}</b></label>
      <div class="row"><input type="color" data-bind="${path}" value="${val}"><input class="in mono" data-bind="${path}" data-hex value="${val.toUpperCase()}" maxlength="7"></div>
      <div class="swatches">${SWATCHES.map(([n, h]) => `<button title="${n}" data-sw="${path}" data-hexv="${h}" style="background:${h}" class="${h.toLowerCase() === val.toLowerCase() ? 'on' : ''}"></button>`).join('')}</div></div>`;
  },
  range(path, label, val, min, max, step, fmt = v => v) { return `<div class="fld"><label>${label}<b data-out="${path}" data-fmt="${fmt === frac ? 'frac' : ''}">${fmt(val)}</b></label><input type="range" data-bind="${path}" data-num min="${min}" max="${max}" step="${step}" value="${val}"></div>`; },
  select(path, label, val, opts) { return `<div class="fld"><label>${label}</label><select class="in" data-bind="${path}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`; },
  studio() {
    const d = S.current, L = $('#studioLeft'), R = $('#studioRight');
    if (d.category === 'watch') {
      const W = d.watch, woods = Object.entries(WOODS).map(([k, v]) => [k, v.label]);
      L.innerHTML = `<div class="sec"><h4><em>A</em>Case</h4>
        ${this.range('watch.dia', 'Case diameter', W.dia, 36, 46, 1, v => v + ' mm')}
        <div class="row">${this.select('watch.caseWood', 'Case wood', W.caseWood, woods)}</div>
        <div class="row">${this.select('watch.bezel', 'Bezel', W.bezel, Object.entries(BEZELS).map(([k, v]) => [k, v.label]))}</div>
        <div class="grid2" style="margin-top:10px">${this.select('watch.crystal', 'Crystal', W.crystal, [['Sapphire', 'Sapphire'], ['Mineral', 'Hardened mineral']])}${this.select('watch.wr', 'Water resist.', W.wr, [['3 ATM', '3 ATM'], ['5 ATM', '5 ATM']])}</div></div>
        <div class="sec"><h4><em>B</em>Dial</h4>${this.colorField('watch.dial', 'Dial', W.dial)}<div class="grid2" style="margin-top:12px">
          <div class="fld"><label>Indices / hands</label><div class="row"><input type="color" data-bind="watch.index" value="${W.index}"><span class="mono">${W.index}</span></div></div>
          <div class="fld"><label>Seconds accent</label><div class="row"><input type="color" data-bind="watch.accent" value="${W.accent}"><span class="mono">${W.accent}</span></div></div></div>
          <div class="grid2" style="margin-top:10px"><div class="fld"><label>Edition N°</label><input class="in mono" type="number" min="1" max="${d.edition || 150}" data-bind="watch.editionNo" data-num value="${W.editionNo}"></div>
          <div class="fld"><label>Edition cap</label><input class="in mono" type="number" min="1" data-bind="edition" data-num value="${d.edition || 150}"></div></div></div>
        <div class="sec"><h4><em>C</em>Strap</h4>${this.select('watch.strapWood', 'Center links', W.strapWood, woods)}<div style="margin-top:10px">${this.select('watch.strapAccent', 'Side links', W.strapAccent, woods)}</div></div>
        <div class="sec"><h4><em>D</em>Movement & caseback</h4>${this.select('watch.movement', 'Movement', W.movement, MOVEMENTS.map(m => [m, m]))}
          <div class="fld" style="margin-top:10px"><label>Caseback engraving</label><input class="in" data-bind="watch.engraving" value="${esc(W.engraving)}"></div></div>`;
    } else {
      const g = d.garment;
      L.innerHTML = `<div class="sec"><h4><em>A</em>Piece</h4>
        <div class="fld"><label>Silhouette</label><div class="seg" data-segbind="category">${['tee', 'longsleeve', 'crewneck', 'hoodie'].map(c => `<button data-v="${c}" class="${c === d.category ? 'on' : ''}">${CATS[c].label.replace('Long Sleeve', 'L/S')}</button>`).join('')}</div></div>
        <div class="fld" style="margin-top:10px"><label>Fit</label><div class="seg" data-segbind="garment.fit">${Object.entries(FITS).map(([k, v]) => `<button data-v="${k}" class="${k === g.fit ? 'on' : ''}">${v.label}</button>`).join('')}</div></div>
        <div style="margin-top:10px">${this.select('garment.fabric', 'Fabric', g.fabric, Object.entries(FABRICS).map(([k, v]) => [k, v.label]))}</div>
        <div class="grid2" style="margin-top:10px">${this.select('garment.finish', 'Wash / finish', g.finish || 'none', Object.entries(FINISHES).map(([k, v]) => [k, v.label]))}${this.select('garment.distress', 'Distressing', g.distress || 'none', Object.entries(DISTRESS).map(([k, v]) => [k, v.label]))}</div></div>
        <div class="sec"><h4><em>B</em>Color</h4>${this.colorField('garment.color', 'Body', g.color)}
          <div class="grid2" style="margin-top:12px"><div class="fld"><label>Rib / trim</label><div class="row"><input type="color" data-bind="garment.trim" value="${g.trim}"><button class="btn sm" data-copy="garment.trim">= Body</button></div></div>
          <div class="fld"><label>Stitch</label><div class="row"><input type="color" data-bind="garment.stitch" value="${g.stitch}"><button class="btn sm" data-copy="garment.stitch">= Body</button></div></div></div></div>
        ${['front', 'back'].map((s, i) => { const P = d.place[s]; return `<div class="sec"><h4><em>${'CD'[i]}</em>${s} print<span class="r cap">${d.artwork[s].length} layer${d.artwork[s].length === 1 ? '' : 's'}</span></h4>
          ${this.select(`place.${s}.tech`, 'Technique', P.tech, TECHNIQUES.map(t => [t, t]))}
          <div class="swatches" style="gap:4px">${PLACE_PRESETS[s].map(([n], i) => `<button class="btn sm" style="width:auto;height:auto;border-radius:3px" data-preset="${s}:${i}">${n}</button>`).join('')}</div>
          <div style="margin-top:10px">${this.range(`place.${s}.top`, 'Zone top below HPS', P.top, .5, 14, .125, v => frac(v) + '"')}</div>
          <div style="margin-top:10px">${this.range(`place.${s}.dx`, 'Offset from CF', P.dx, -6, 6, .125, v => frac(v) + '"')}</div>
          <div class="grid2" style="margin-top:10px">${this.range(`place.${s}.s`, 'Scale', P.s, .2, 1.6, .01, v => Math.round(v * 100) + '%')}${this.range(`place.${s}.r`, 'Rotate', P.r, -45, 45, 1, v => v + '°')}</div>
          <button class="btn sm block" style="margin-top:12px" data-goart="${s}">Edit ${s} artwork</button></div>`; }).join('')}`;
    }
    R.innerHTML = `<div class="sec"><h4><em>E</em>Output</h4>
        <button class="btn primary block" id="sRenders">Save renders to tech pack</button>
        <div class="grid2" style="margin-top:8px"><button class="btn" id="sPng">Export PNG</button><button class="btn" id="sGlb">Export GLB</button></div>
        <p class="hint" style="margin-top:10px">GLB opens in Blender, CLO, Keyshot and most factory 3D viewers. Renders feed the tech pack cover.</p></div>
      <div class="sec"><h4><em>F</em>Image prompt</h4><button class="btn block" id="sPrompt">Build ChatGPT image prompt</button><p class="hint" style="margin-top:8px">Turns this spec into a photo-real draft prompt. Paste the result back into Capture to build the next blank.</p></div>
      <div class="sec"><h4><em>G</em>Colorways<span class="r"><button class="btn sm" id="cwAdd">+ Save current</button></span></h4>
        <div class="layers">${d.colorways.map(c => `<div class="layer" data-cw="${c.id}"><span style="width:16px;height:16px;border-radius:50%;background:${c.hex};border:1px solid rgba(255,255,255,.2)"></span><span class="nm">${esc(c.name)}</span><span class="mono" style="color:var(--muted)">${esc(c.hex)}</span></div>`).join('')}</div>
        <p class="hint" style="margin-top:8px">Click to apply. Edit names and Pantone refs in the tech pack.</p></div>
      <div class="sec"><h4><em>H</em>Reference</h4>${d.refs.length ? `<div class="grid2" id="refGrid"></div>` : `<p class="hint">No reference photos. Attach from Capture.</p>`}</div>
      <div class="sec"><h4><em>I</em>Design notes</h4><textarea class="in" data-bind="notes" rows="5" placeholder="Intent, references, what the sample needs to prove">${esc(d.notes)}</textarea></div>`;
    if (d.refs.length) Promise.all(d.refs.map(id => Assets.get(id))).then(srcs => { const g = $('#refGrid'); if (g) g.innerHTML = srcs.filter(Boolean).map(s => `<img src="${s}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:3px;border:1px solid var(--line)">`).join(''); });
    $('#sRenders').onclick = () => Studio.captureRenders();
    $('#sPrompt').onclick = () => promptModal(d);
    $$('[data-preset]', L).forEach(b => b.onclick = () => { const [s, i] = b.dataset.preset.split(':'); Object.assign(d.place[s], PLACE_PRESETS[s][i][1]); touch(); Studio.updateDecals(); this.studio(); });
    $('#sPng').onclick = () => Studio.exportPNG();
    $('#sGlb').onclick = () => Studio.exportGLB();
    $('#cwAdd').onclick = () => { const hex = d.category === 'watch' ? WOODS[d.watch.caseWood].a : d.garment.color; d.colorways.push(row({ name: 'Colorway ' + (d.colorways.length + 1), hex, pantone: '', notes: d.category === 'watch' ? `${WOODS[d.watch.caseWood].label} / ${WOODS[d.watch.strapAccent].label}` : '' })); touch(); this.studio(); };
    $$('[data-cw]', R).forEach(el => el.onclick = () => { const c = d.colorways.find(x => x.id === el.dataset.cw); if (d.category === 'watch') return; d.garment.color = c.hex; touch(); Studio.build(); this.studio(); });
    $$('[data-goart]', L).forEach(b => b.onclick = () => { Art.side = b.dataset.goart; go('artwork'); });
    $$('[data-copy]', L).forEach(b => b.onclick = () => { setPath(d, b.dataset.copy, d.garment.color); touch(); Studio.build(); this.studio(); });
  },
};
// one delegated binder for every data-bind control in the side panels
function onBind(e) {
  const el = e.target; const d = S.current; if (!d) return;
  if (el.dataset.bind) {
    let v = el.value;
    if (el.dataset.hex !== undefined) { if (!/^#[0-9a-f]{6}$/i.test(v)) return; }
    if (el.dataset.num !== undefined) v = num(v);
    followBody(d, el.dataset.bind, v); setPath(d, el.dataset.bind, v); touch();
    const root = el.closest('.side');
    $$(`[data-out="${el.dataset.bind}"]`, root).forEach(o => { const f = o.dataset.fmt; o.textContent = f === 'frac' ? frac(v) + '"' : el.type === 'range' ? o.textContent.replace(/^-?[\d.]+(?: \d\/\d)?|^-?\d\/\d/, '') && formatOut(el.dataset.bind, v) : String(v).toUpperCase(); });
    $$(`[data-bind="${el.dataset.bind}"]`, root).forEach(o => { if (o !== el) o.value = o.dataset.hex !== undefined ? String(v).toUpperCase() : v; });
    if (root?.id?.startsWith('studio')) studioChanged(el.dataset.bind, e.type);
  }
}
// trim + stitch track the body color until someone sets them on purpose
function followBody(d, path, v) {
  if (path !== 'garment.color' || !/^#[0-9a-f]{6}$/i.test(v)) return;
  const g = d.garment, old = g.color.toLowerCase();
  if (g.trim.toLowerCase() === old) g.trim = v; if (g.stitch.toLowerCase() === old) g.stitch = v;
}
function formatOut(path, v) {
  if (path.endsWith('.s')) return Math.round(v * 100) + '%';
  if (path.endsWith('.r')) return v + '°';
  if (path === 'watch.dia') return v + ' mm';
  return v;
}
const rebuildSoon = debounce(() => Studio.build(), 120);
function studioChanged(path, type) {
  if (path.startsWith('place.')) { Studio.updateDecals(); if (path.endsWith('.tech')) Panels.studio(); return; }
  if (path === 'notes' || path === 'watch.engraving' && type === 'input') return;
  if (path === 'garment.fabric' || path === 'watch.movement') { Studio.build(); return; }
  rebuildSoon();
}
document.addEventListener('input', e => { if (e.target.closest('.side') && e.target.dataset.bind) onBind(e); });
document.addEventListener('change', e => { if (e.target.closest('.side') && e.target.dataset.bind && e.target.tagName === 'SELECT') { /* handled by input */ } });
document.addEventListener('click', e => {
  const sw = e.target.closest('[data-sw]');
  if (sw && S.current) { followBody(S.current, sw.dataset.sw, sw.dataset.hexv); setPath(S.current, sw.dataset.sw, sw.dataset.hexv); touch(); const side = sw.closest('.side'); if (side?.id.startsWith('studio')) { Studio.build(); Panels.studio(); } return; }
  const seg = e.target.closest('[data-segbind] button');
  if (seg && S.current) {
    const p = seg.parentElement.dataset.segbind; setPath(S.current, p, seg.dataset.v); touch();
    if (p === 'category') { S.current.place.front.s = clamp(S.current.place.front.s, .2, 1.6); }
    Studio.build(); Panels.studio();
  }
});

/* =========================================================================
   11. Artwork editor — layered print art per side (front/back)
   ========================================================================= */
const FONTS = [['Archivo Black', 'Archivo Black'], ['Archivo', 'Archivo (variable)'], ['Inter', 'Inter'], ['Anton', 'Anton'], ['UnifrakturMaguntia', 'Blackletter'], ['Instrument Serif', 'Instrument Serif'], ['JetBrains Mono', 'JetBrains Mono']];
const Art = {
  side: 'front', sel: null, drag: null, hist: { front: [], back: [] }, fut: { front: [], back: [] }, ppi: 1024 / 14,
  reset() { this.sel = null; this.hist = { front: [], back: [] }; this.fut = { front: [], back: [] }; },
  get L() { return S.current.artwork[this.side]; },
  init() {
    if (this.inited) return; this.inited = true;
    const cv = this.cv = $('#artCanvas'); this.ctx = cv.getContext('2d');
    cv.addEventListener('pointerdown', e => this.down(e)); cv.addEventListener('pointermove', e => this.move(e));
    cv.addEventListener('pointerup', e => this.up(e)); cv.addEventListener('pointercancel', e => this.up(e));
    $$('#artSide button').forEach(b => b.onclick = () => { this.side = b.dataset.side; this.sel = null; this.show(); });
    $('#artUndo').onclick = () => this.undo(); $('#artRedo').onclick = () => this.redo();
    $('#artPng').onclick = () => download(`${S.current.styleNo}_${this.side}_art.png`, this.composite(S.current, this.side, 4096).toDataURL('image/png'));
    $('#artTo3d').onclick = () => go('studio');
  },
  show() {
    this.init();
    $$('#artSide button').forEach(b => b.classList.toggle('on', b.dataset.side === this.side));
    const d = S.current;
    if (d.category === 'watch') { $('#artZone').textContent = 'Watch — artwork is engraved/printed via dial + caseback fields in 3D Studio'; }
    else $('#artZone').textContent = `${this.side} print zone 14 × 14 in · 1 in grid · ${d.place[this.side].tech}`;
    this.panels(); Assets.ready(this.L.filter(l => l.type === 'image').map(l => l.asset)).then(() => this.render()); this.render();
  },
  snapshot() { const h = this.hist[this.side]; h.push(JSON.stringify(this.L)); if (h.length > 60) h.shift(); this.fut[this.side] = []; },
  undo() { const h = this.hist[this.side]; if (!h.length) return; this.fut[this.side].push(JSON.stringify(this.L)); S.current.artwork[this.side] = JSON.parse(h.pop()); this.sel = null; this.changed(true); },
  redo() { const f = this.fut[this.side]; if (!f.length) return; this.hist[this.side].push(JSON.stringify(this.L)); S.current.artwork[this.side] = JSON.parse(f.pop()); this.sel = null; this.changed(true); },
  changed(full) { touch(); this.thumbCache.delete(S.current.id + this.side); this.render(); if (full) this.panels(); else this.props(); },
  thumbCache: new Map(),
  thumbURL(d, side) {
    if (!d.artwork?.[side]?.some(l => !l.hidden)) return null;
    const k = d.id + side; if (!this.thumbCache.has(k)) this.thumbCache.set(k, this.composite(d, side, 512).toDataURL('image/png'));
    return this.thumbCache.get(k);
  },
  /* ---------- drawing ---------- */
  drawLayer(x, l, k = 1) {
    if (l.hidden) return;
    x.save(); x.translate(l.x * k, l.y * k); x.rotate(l.rot * Math.PI / 180); x.globalAlpha = l.opacity ?? 1;
    const w = l.w * k, h = l.h * k;
    if (l.type === 'image') { const img = Assets.img(l.asset, () => this.render()); if (img) x.drawImage(img, -w / 2, -h / 2, w, h); }
    else if (l.type === 'mark') Mark.draw(x, 0, 0, w, h, l.color);
    else if (l.type === 'shape') {
      x.beginPath(); if (l.shape === 'ellipse') x.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); else x.rect(-w / 2, -h / 2, w, h);
      if (l.fill !== 'none') { x.fillStyle = l.fill; x.fill(); } if (l.sw > 0) { x.strokeStyle = l.stroke; x.lineWidth = l.sw * k; x.stroke(); }
    } else if (l.type === 'text') {
      const lines = String(l.text).split('\n');
      x.font = `${l.italic ? 'italic ' : ''}${l.weight} ${l.size * k}px "${l.font}"`; x.fontStretch = l.stretch || 'normal'; x.letterSpacing = (l.track * k) + 'px';
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = l.color;
      const lh = l.size * k * (l.lh || 1.05), widest = Math.max(...lines.map(t => x.measureText(t).width));
      if (k === 1) { l.w = Math.max(20, widest); l.h = Math.max(20, lh * lines.length); }
      const sx = l.w * k / Math.max(1, widest);
      x.scale(k === 1 ? 1 : sx, 1);
      lines.forEach((t, i) => { const y = (i - (lines.length - 1) / 2) * lh; if (l.outline > 0) { x.lineWidth = l.outline * k; x.strokeStyle = l.outlineColor; x.lineJoin = 'round'; x.strokeText(t, 0, y); } x.fillText(t, 0, y); });
    }
    x.restore();
  },
  composite(d, side, size = 1024) {
    const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d'); const k = size / 1024;
    d.artwork[side].forEach(l => this.drawLayer(x, l, k)); return c;
  },
  render() {
    if (!this.cv || !S.current || S.view !== 'artwork') return;
    const x = this.ctx, d = S.current, W = 1024, p = this.ppi;
    x.clearRect(0, 0, W, W);
    x.fillStyle = d.category === 'watch' ? '#1e2236' : d.garment.color; x.fillRect(0, 0, W, W);
    const dark = lum(x.fillStyle) > .5; x.strokeStyle = dark ? 'rgba(0,0,0,.09)' : 'rgba(255,255,255,.07)'; x.lineWidth = 1;
    for (let i = 1; i < 14; i++) { x.beginPath(); x.moveTo(i * p, 0); x.lineTo(i * p, W); x.moveTo(0, i * p); x.lineTo(W, i * p); x.stroke(); }
    x.strokeStyle = dark ? 'rgba(0,0,0,.22)' : 'rgba(255,255,255,.18)'; x.setLineDash([6, 6]); x.beginPath(); x.moveTo(W / 2, 0); x.lineTo(W / 2, W); x.stroke(); x.setLineDash([]);
    x.font = '500 13px "JetBrains Mono"'; x.fillStyle = dark ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.3)'; x.letterSpacing = '1px'; x.textAlign = 'left'; x.fillText('CF', W / 2 + 6, 18);
    this.L.forEach(l => this.drawLayer(x, l));
    const s = this.L.find(l => l.id === this.sel);
    if (s) {
      x.save(); x.translate(s.x, s.y); x.rotate(s.rot * Math.PI / 180);
      x.strokeStyle = '#B98A4A'; x.lineWidth = 2; x.setLineDash([8, 5]); x.strokeRect(-s.w / 2, -s.h / 2, s.w, s.h); x.setLineDash([]);
      x.fillStyle = '#B98A4A'; x.fillRect(s.w / 2 - 9, s.h / 2 - 9, 18, 18);
      x.beginPath(); x.moveTo(0, -s.h / 2); x.lineTo(0, -s.h / 2 - 38); x.stroke(); x.beginPath(); x.arc(0, -s.h / 2 - 46, 10, 0, Math.PI * 2); x.fill();
      x.restore();
      x.font = '500 14px "JetBrains Mono"'; x.fillStyle = '#B98A4A'; x.textAlign = 'left';
      x.fillText(`${frac(s.w / this.ppi * d.place[this.side].s)}" × ${frac(s.h / this.ppi * d.place[this.side].s)}"`, 12, W - 14);
    }
  },
  /* ---------- interaction ---------- */
  pt(e) { const r = this.cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * 1024 / r.width, y: (e.clientY - r.top) * 1024 / r.height }; },
  local(l, p) { const a = -l.rot * Math.PI / 180, dx = p.x - l.x, dy = p.y - l.y; return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) }; },
  down(e) {
    const p = this.pt(e), s = this.L.find(l => l.id === this.sel);
    this.cv.setPointerCapture(e.pointerId);
    if (s) {
      const q = this.local(s, p);
      if (Math.hypot(q.x - s.w / 2, q.y - s.h / 2) < 22) { this.snapshot(); this.drag = { mode: 'scale', l: s, d0: Math.hypot(q.x, q.y), w0: s.w, h0: s.h, size0: s.size }; return; }
      if (Math.hypot(q.x, q.y + s.h / 2 + 46) < 20) { this.snapshot(); this.drag = { mode: 'rot', l: s }; return; }
    }
    const hit = [...this.L].reverse().find(l => { if (l.hidden || l.locked) return false; const q = this.local(l, p); return Math.abs(q.x) <= l.w / 2 && Math.abs(q.y) <= l.h / 2; });
    this.sel = hit?.id || null;
    if (hit) { this.snapshot(); this.drag = { mode: 'move', l: hit, ox: p.x - hit.x, oy: p.y - hit.y }; }
    this.render(); this.panels();
  },
  move(e) {
    const p = this.pt(e), D = this.drag;
    if (!D) { const s = this.L.find(l => l.id === this.sel); let cur = 'default'; if (s) { const q = this.local(s, p); if (Math.hypot(q.x - s.w / 2, q.y - s.h / 2) < 22) cur = 'nwse-resize'; else if (Math.hypot(q.x, q.y + s.h / 2 + 46) < 20) cur = 'grab'; else if (Math.abs(q.x) <= s.w / 2 && Math.abs(q.y) <= s.h / 2) cur = 'move'; } this.cv.style.cursor = cur; return; }
    const l = D.l;
    if (D.mode === 'move') { let nx = p.x - D.ox; if (Math.abs(nx - 512) < 8) nx = 512; l.x = Math.round(nx); l.y = Math.round(p.y - D.oy); }
    if (D.mode === 'scale') { const q = this.local(l, p), f = Math.max(.05, Math.hypot(q.x, q.y) / D.d0); if (l.type === 'text') l.size = Math.max(6, Math.round(D.size0 * f)); else { l.w = D.w0 * f; l.h = D.h0 * f; } }
    if (D.mode === 'rot') { let a = Math.atan2(p.y - l.y, p.x - l.x) * 180 / Math.PI + 90; if (e.shiftKey) a = Math.round(a / 15) * 15; l.rot = Math.round(((a + 540) % 360) - 180); }
    this.render(); this.propsLive();
  },
  up() { if (this.drag) { this.drag = null; this.changed(); } },
  add(l) {
    this.snapshot(); const base = { id: uid('l'), x: 512, y: 380, rot: 0, opacity: 1, hidden: false, locked: false };
    const L = { ...base, ...l }; this.L.push(L); this.sel = L.id; this.changed(true);
  },
  async addImage(dataUrl, name = 'Image') {
    const id = await Assets.put(dataUrl, name); const img = await loadImg(dataUrl); Assets.imgs.set(id, img);
    const f = Math.min(620 / img.naturalWidth, 620 / img.naturalHeight, 1.6);
    this.add({ type: 'image', name, asset: id, w: img.naturalWidth * f, h: img.naturalHeight * f });
  },
  del() { if (!this.sel) return; this.snapshot(); S.current.artwork[this.side] = this.L.filter(l => l.id !== this.sel); this.sel = null; this.changed(true); },
  /* ---------- panels ---------- */
  panels() {
    const d = S.current;
    $('#artLeft').innerHTML = `<div class="sec"><h4><em>A</em>Add to ${this.side}</h4>
      <div class="grid2"><button class="btn" data-add="image">Image</button><button class="btn" data-add="text">Text</button><button class="btn" data-add="mark">DPP mark</button><button class="btn" data-add="rect">Block</button></div>
      <button class="btn block" style="margin-top:8px" data-add="ellipse">Circle / badge</button>
      <p class="hint" style="margin-top:10px">Paste an image with Ctrl+V to drop it on the canvas. Lift graphics from photos in Capture.</p></div>
      <div class="sec"><h4><em>B</em>Quick lockups</h4>
        <button class="btn block" data-lock="stack">DON'T / POSTPONE / PASSION stack</button>
        <button class="btn block" style="margin-top:6px" data-lock="badge">Numbered drop badge</button>
        <button class="btn block" style="margin-top:6px" data-lock="blueprint">Blueprint back hit</button></div>
      <div class="sec"><h4><em>C</em>Library images</h4><div class="grid3" id="artAssets"><span class="hint">Loading…</span></div></div>`;
    DB.all('assets').then(all => { const el = $('#artAssets'); if (!el) return; const list = all.sort((a, b) => b.created - a.created).slice(0, 18); el.innerHTML = list.length ? list.map(a => `<button data-asset="${a.id}" title="${esc(a.name)}" style="aspect-ratio:1;border:1px solid var(--line);border-radius:3px;background:#1e2236 url('${a.data}') center/contain no-repeat"></button>`).join('') : '<span class="hint">Nothing yet.</span>'; });
    this.props();
  },
  props() {
    const R = $('#artRight'), s = this.L.find(l => l.id === this.sel);
    let h = `<div class="sec"><h4><em>D</em>Properties</h4>`;
    if (!s) h += `<p class="hint">Select a layer. Drag to move, corner to scale, top handle to rotate (Shift snaps 15°). Arrows nudge, Delete removes.</p>`;
    else {
      const P = S.current.place[this.side].s;
      h += `<div class="grid2"><div class="fld"><label>X (in from CF)</label><input class="in mono" data-lp="x" type="number" step=".125" value="${((s.x - 512) / this.ppi * P).toFixed(3)}"></div><div class="fld"><label>Y (in from zone top)</label><input class="in mono" data-lp="y" type="number" step=".125" value="${(s.y / this.ppi * P).toFixed(3)}"></div></div>
      <div class="grid2" style="margin-top:10px"><div class="fld"><label>Rotate °</label><input class="in mono" data-lp="rot" type="number" value="${s.rot}"></div><div class="fld"><label>Opacity</label><input class="in mono" data-lp="opacity" type="number" step=".05" min="0" max="1" value="${s.opacity}"></div></div>`;
      if (s.type !== 'text') h += `<div class="grid2" style="margin-top:10px"><div class="fld"><label>W (in)</label><input class="in mono" data-lp="w" type="number" step=".125" value="${(s.w / this.ppi * P).toFixed(3)}"></div><div class="fld"><label>H (in)</label><input class="in mono" data-lp="h" type="number" step=".125" value="${(s.h / this.ppi * P).toFixed(3)}"></div></div>`;
      if (s.type === 'text') h += `<div class="fld" style="margin-top:10px"><label>Text</label><textarea class="in" data-lp="text" rows="3">${esc(s.text)}</textarea></div>
        <div class="grid2" style="margin-top:10px"><div class="fld"><label>Font</label><select class="in" data-lp="font">${FONTS.map(([f, n]) => `<option value="${f}" ${f === s.font ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="fld"><label>Weight</label><select class="in" data-lp="weight">${[300, 400, 500, 600, 700, 800, 900].map(w => `<option ${w == s.weight ? 'selected' : ''}>${w}</option>`).join('')}</select></div></div>
        <div class="grid3" style="margin-top:10px"><div class="fld"><label>Size</label><input class="in mono" data-lp="size" type="number" value="${s.size}"></div><div class="fld"><label>Track</label><input class="in mono" data-lp="track" type="number" value="${s.track}"></div><div class="fld"><label>Leading</label><input class="in mono" data-lp="lh" type="number" step=".05" value="${s.lh || 1.05}"></div></div>
        <div class="fld" style="margin-top:10px"><label>Width</label><div class="seg" data-lpseg="stretch">${[['condensed', 'Cond.'], ['normal', 'Normal'], ['expanded', 'Expanded']].map(([v, l]) => `<button data-v="${v}" class="${(s.stretch || 'normal') === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="grid2" style="margin-top:10px"><div class="fld"><label>Outline px</label><input class="in mono" data-lp="outline" type="number" min="0" value="${s.outline || 0}"></div><div class="fld"><label>Outline color</label><input type="color" data-lp="outlineColor" value="${s.outlineColor || '#000000'}"></div></div>`;
      if (s.type === 'text' || s.type === 'mark') h += `<div class="fld" style="margin-top:10px"><label>Ink color</label><div class="row"><input type="color" data-lp="color" value="${s.color}"><span class="mono">${s.color}</span></div><div class="swatches">${SWATCHES.map(([n, x]) => `<button title="${n}" data-lpsw="color" data-hexv="${x}" style="background:${x}"></button>`).join('')}</div></div>`;
      if (s.type === 'shape') h += `<div class="grid3" style="margin-top:10px"><div class="fld"><label>Fill</label><input type="color" data-lp="fill" value="${s.fill === 'none' ? '#000000' : s.fill}"></div><div class="fld"><label>Stroke</label><input type="color" data-lp="stroke" value="${s.stroke}"></div><div class="fld"><label>Stroke px</label><input class="in mono" data-lp="sw" type="number" min="0" value="${s.sw}"></div></div><button class="btn sm" style="margin-top:8px" data-nofill>${s.fill === 'none' ? 'Add fill' : 'No fill'}</button>`;
      h += `<div class="grid3" style="margin-top:14px"><button class="btn sm" data-la="center">Center</button><button class="btn sm" data-la="dup">Duplicate</button><button class="btn sm danger" data-la="del">Delete</button></div>`;
    }
    h += `</div><div class="sec"><h4><em>E</em>Layers<span class="r cap">top first</span></h4><div class="layers">${[...this.L].reverse().map(l => `<div class="layer ${l.id === this.sel ? 'on' : ''} ${l.hidden ? 'off' : ''}" data-lid="${l.id}"><span class="ty">${l.type === 'shape' ? l.shape.slice(0, 4) : l.type}</span><span class="nm">${esc(l.type === 'text' ? l.text.replace(/\n/g, ' / ') : l.name || l.type)}</span><button data-lact="up" title="Bring forward">↑</button><button data-lact="down" title="Send back">↓</button><button data-lact="vis" title="Show / hide">${l.hidden ? 'show' : 'hide'}</button></div>`).join('') || '<p class="hint">Empty. Add a layer.</p>'}</div></div>`;
    R.innerHTML = h;
  },
  propsLive() {
    const s = this.L.find(l => l.id === this.sel); if (!s) return; const P = S.current.place[this.side].s, R = $('#artRight');
    const set = (k, v) => { const el = $(`[data-lp="${k}"]`, R); if (el && document.activeElement !== el) el.value = v; };
    set('x', ((s.x - 512) / this.ppi * P).toFixed(3)); set('y', (s.y / this.ppi * P).toFixed(3)); set('rot', s.rot); set('size', s.size);
    set('w', (s.w / this.ppi * P).toFixed(3)); set('h', (s.h / this.ppi * P).toFixed(3));
  },
  thumbsDirty() { this.thumbCache.clear(); },
};
// artwork panel events
document.addEventListener('click', async e => {
  if (!e.target.closest('#view-artwork')) return;
  const A = Art, t = e.target, d = S.current; if (!d) return;
  const add = t.closest('[data-add]')?.dataset.add;
  if (add === 'image') { pickImage(url => A.addImage(url, 'Upload')); return; }
  if (add === 'text') A.add({ type: 'text', text: "DON'T POSTPONE\nPASSION", font: 'Archivo', weight: 900, stretch: 'expanded', size: 74, track: 2, lh: 1, color: lum(d.garment.color) > .5 ? '#14172B' : '#EEF1F9', w: 400, h: 160, outline: 0, outlineColor: '#000000' });
  if (add === 'mark') A.add({ type: 'mark', name: 'DPP mark', w: 360, h: 360 / Mark.aspect, color: lum(d.garment.color) > .5 ? '#14172B' : '#EEF1F9' });
  if (add === 'rect' || add === 'ellipse') A.add({ type: 'shape', shape: add, name: add === 'rect' ? 'Block' : 'Circle', w: 300, h: add === 'rect' ? 120 : 300, fill: '#B98A4A', stroke: '#14172B', sw: 0 });
  const lock = t.closest('[data-lock]')?.dataset.lock;
  if (lock) {
    const ink = lum(d.garment.color) > .5 ? '#14172B' : '#EEF1F9';
    if (lock === 'stack') ["DON'T", 'POSTPONE', 'PASSION'].forEach((w, i) => A.add({ type: 'text', text: w, font: 'Archivo', weight: 900, stretch: 'expanded', size: 96, track: 0, lh: 1, color: i === 2 ? '#B98A4A' : ink, y: 260 + i * 100, w: 500, h: 100, outline: 0, outlineColor: '#000000' }));
    if (lock === 'badge') { A.add({ type: 'shape', shape: 'ellipse', name: 'Badge ring', w: 300, h: 300, fill: 'none', stroke: ink, sw: 6, y: 300 }); A.add({ type: 'mark', name: 'DPP mark', w: 140, h: 140 / Mark.aspect, color: ink, y: 268 }); A.add({ type: 'text', text: 'DROP 001 · N° 001/150', font: 'JetBrains Mono', weight: 600, size: 16, track: 3, lh: 1, color: ink, y: 352, w: 220, h: 30, outline: 0, outlineColor: '#000000' }); }
    if (lock === 'blueprint') { A.add({ type: 'mark', name: 'DPP mark', w: 560, h: 560 / Mark.aspect, color: ink, y: 360 }); A.add({ type: 'text', text: 'BLUEPRINT — FIG. 01', font: 'JetBrains Mono', weight: 500, size: 26, track: 8, lh: 1, color: ink, y: 600, w: 400, h: 40, outline: 0, outlineColor: '#000000' }); A.add({ type: 'text', text: "DON'T POSTPONE PASSION", font: 'Archivo', weight: 800, stretch: 'expanded', size: 46, track: 6, lh: 1, color: ink, y: 660, w: 600, h: 50, outline: 0, outlineColor: '#000000' }); }
  }
  const as = t.closest('[data-asset]')?.dataset.asset;
  if (as) { const src = await Assets.get(as); const img = await loadImg(src); Assets.imgs.set(as, img); const f = Math.min(620 / img.naturalWidth, 620 / img.naturalHeight, 1.6); A.add({ type: 'image', name: 'Library image', asset: as, w: img.naturalWidth * f, h: img.naturalHeight * f }); }
  const lr = t.closest('[data-lid]');
  if (lr) {
    const act = t.closest('[data-lact]')?.dataset.lact, L = A.L, i = L.findIndex(l => l.id === lr.dataset.lid);
    if (!act) { A.sel = lr.dataset.lid; A.render(); A.props(); return; }
    A.snapshot();
    if (act === 'vis') L[i].hidden = !L[i].hidden;
    if (act === 'up' && i < L.length - 1) [L[i], L[i + 1]] = [L[i + 1], L[i]];
    if (act === 'down' && i > 0) [L[i], L[i - 1]] = [L[i - 1], L[i]];
    A.changed(true); return;
  }
  const la = t.closest('[data-la]')?.dataset.la, s = A.L.find(l => l.id === A.sel);
  if (la && s) { if (la === 'del') return A.del(); A.snapshot(); if (la === 'center') s.x = 512; if (la === 'dup') { const c = { ...structuredClone(s), id: uid('l'), x: s.x + 30, y: s.y + 30 }; A.L.push(c); A.sel = c.id; } A.changed(true); }
  const sw = t.closest('[data-lpsw]'); if (sw && s) { A.snapshot(); s[sw.dataset.lpsw] = sw.dataset.hexv; A.changed(true); }
  const sg = t.closest('[data-lpseg] button'); if (sg && s) { A.snapshot(); s[sg.parentElement.dataset.lpseg] = sg.dataset.v; A.changed(true); }
  if (t.closest('[data-nofill]') && s) { A.snapshot(); s.fill = s.fill === 'none' ? '#B98A4A' : 'none'; A.changed(true); }
});
let lpSnap = false;
document.addEventListener('input', e => {
  const el = e.target.closest('[data-lp]'); if (!el || !S.current) return;
  const A = Art, s = A.L.find(l => l.id === A.sel); if (!s) return;
  if (!lpSnap) { A.snapshot(); lpSnap = true; setTimeout(() => lpSnap = false, 800); }
  const k = el.dataset.lp, P = S.current.place[A.side].s; let v = el.value;
  if (el.type === 'number') v = num(v);
  if (k === 'x') v = 512 + v / P * A.ppi; if (k === 'y') v = v / P * A.ppi;
  if (k === 'w' || k === 'h') v = Math.max(4, v / P * A.ppi);
  s[k] = v; if (k === 'font' || k === 'weight') document.fonts.load(`${s.weight} 40px "${s.font}"`).then(() => A.render());
  touch(); A.thumbCache.delete(S.current.id + A.side); A.render();
  if (el.type === 'color') { const sp = el.parentElement.querySelector('.mono'); if (sp) sp.textContent = v; }
});

/* =========================================================================
   12. Capture — photo/screenshot → cutout, palette, blank, AI read
   ========================================================================= */
const Capture = {
  src: null, W: 0, H: 0, mask: null, tol: 38, mode: 'erase', crop: null, palette: [], ai: null, srcURL: null,
  show() { this.panels(); if (this.src) this.render(); },
  async load(dataUrl) {
    const img = await loadImg(dataUrl), max = 1100, f = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    this.W = Math.round(img.naturalWidth * f); this.H = Math.round(img.naturalHeight * f);
    const c = document.createElement('canvas'); c.width = this.W; c.height = this.H; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, this.W, this.H);
    this.src = c; this.pix = x.getImageData(0, 0, this.W, this.H).data; this.srcURL = dataUrl;
    this.mask = new Uint8ClampedArray(this.W * this.H).fill(255); this.crop = null; this.ai = null;
    const cv = $('#capCanvas'); cv.width = this.W; cv.height = this.H;
    $('#capDrop').classList.add('hidden'); $('#capWrap').classList.remove('hidden');
    this.autoCut(); this.panels();
  },
  dist(i, r, g, b) { const p = this.pix; const dr = p[i] - r, dg = p[i + 1] - g, db = p[i + 2] - b; return Math.sqrt(dr * dr * .3 + dg * dg * .59 + db * db * .11) * 1.7; },
  autoCut() {
    // flood fill from the border through pixels close to any sampled border color
    const { W, H, pix } = this, seeds = [];
    for (let i = 0; i < W; i += 4) seeds.push(i, (H - 1) * W + i); for (let j = 0; j < H; j += 4) seeds.push(j * W, j * W + W - 1);
    const refs = kmeans(seeds.map(s => [pix[s * 4], pix[s * 4 + 1], pix[s * 4 + 2]]), 3, 6).map(c => c.c);
    this.mask.fill(255);
    const near = i => refs.some(([r, g, b]) => this.dist(i * 4, r, g, b) < this.tol);
    this.flood(seeds.filter(near), near); this.cleanup(); this.analyze(); this.render();
  },
  flood(starts, test) {
    const { W, H, mask } = this, st = [...starts], seen = new Uint8Array(W * H);
    while (st.length) { const i = st.pop(); if (seen[i]) continue; seen[i] = 1; if (!test(i)) continue; mask[i] = 0; const x = i % W, y = (i / W) | 0; if (x > 0) st.push(i - 1); if (x < W - 1) st.push(i + 1); if (y > 0) st.push(i - W); if (y < H - 1) st.push(i + W); }
  },
  cleanup() { // soften the edge one pixel
    const { W, H, mask } = this, out = new Uint8ClampedArray(mask);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; if (mask[i] && (!mask[i - 1] || !mask[i + 1] || !mask[i - W] || !mask[i + W])) out[i] = 150; }
    this.mask = out;
  },
  eraseAt(px, py) { const i = (py * this.W + px), r = this.pix[i * 4], g = this.pix[i * 4 + 1], b = this.pix[i * 4 + 2]; this.flood([i], j => this.mask[j] > 0 && this.dist(j * 4, r, g, b) < this.tol); this.cleanup(); this.analyze(); this.render(); },
  cutout(rect) {
    const r = rect || { x: 0, y: 0, w: this.W, h: this.H }, c = document.createElement('canvas'); c.width = r.w; c.height = r.h;
    const x = c.getContext('2d'), im = x.createImageData(r.w, r.h);
    for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) { const s = ((r.y + j) * this.W + r.x + i), o = (j * r.w + i) * 4; im.data[o] = this.pix[s * 4]; im.data[o + 1] = this.pix[s * 4 + 1]; im.data[o + 2] = this.pix[s * 4 + 2]; im.data[o + 3] = this.mask[s]; }
    x.putImageData(im, 0, 0); return trimCanvas(c);
  },
  analyze() {
    const px = []; const { W, H, mask, pix } = this, step = Math.max(1, Math.floor(Math.sqrt(W * H / 6000)));
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) { const i = y * W + x; if (mask[i] > 200) px.push([pix[i * 4], pix[i * 4 + 1], pix[i * 4 + 2]]); }
    const tot = px.length || 1; this.palette = px.length ? kmeans(px, 6, 10).filter(c => c.n / tot > .015).map(c => ({ hex: rgbToHex(...c.c), pct: c.n / tot })) : [];
  },
  render() {
    const cv = $('#capCanvas'), x = cv.getContext('2d'); x.clearRect(0, 0, this.W, this.H);
    const im = x.createImageData(this.W, this.H); for (let i = 0; i < this.W * this.H; i++) { im.data[i * 4] = this.pix[i * 4]; im.data[i * 4 + 1] = this.pix[i * 4 + 1]; im.data[i * 4 + 2] = this.pix[i * 4 + 2]; im.data[i * 4 + 3] = this.showOrig ? 255 : this.mask[i]; }
    x.putImageData(im, 0, 0);
    if (this.crop) { const c = this.crop; x.strokeStyle = '#B98A4A'; x.lineWidth = Math.max(2, this.W / 400); x.setLineDash([10, 6]); x.strokeRect(c.x, c.y, c.w, c.h); x.setLineDash([]); x.fillStyle = 'rgba(13,12,10,.45)'; x.fillRect(0, 0, this.W, c.y); x.fillRect(0, c.y + c.h, this.W, this.H - c.y - c.h); x.fillRect(0, c.y, c.x, c.h); x.fillRect(c.x + c.w, c.y, this.W - c.x - c.w, c.h); }
  },
  pt(e) { const r = $('#capCanvas').getBoundingClientRect(); return { x: clamp(Math.floor((e.clientX - r.left) * this.W / r.width), 0, this.W - 1), y: clamp(Math.floor((e.clientY - r.top) * this.H / r.height), 0, this.H - 1) }; },
  panels() {
    const L = $('#capLeft'), R = $('#capRight');
    L.innerHTML = `<div class="sec"><h4><em>A</em>Source</h4><button class="btn block" id="cPick">${this.src ? 'Replace image' : 'Choose image'}</button><p class="hint" style="margin-top:8px">Ctrl+V pastes a screenshot from anywhere in the studio.</p></div>
      ${this.src ? `<div class="sec"><h4><em>B</em>Cutout</h4>
        ${Panels.range('_tol', 'Background tolerance', this.tol, 6, 120, 1).replace('data-bind="_tol"', 'id="cTol"')}
        <button class="btn block" style="margin-top:10px" id="cAuto">Re-run auto cutout</button>
        <div class="fld" style="margin-top:12px"><label>Click mode</label><div class="seg" id="cMode"><button data-m="erase" class="${this.mode === 'erase' ? 'on' : ''}">Erase region</button><button data-m="crop" class="${this.mode === 'crop' ? 'on' : ''}">Crop graphic</button></div></div>
        <div class="grid2" style="margin-top:10px"><button class="btn sm" id="cReset">Restore all</button><button class="btn sm" id="cOrig">${this.showOrig ? 'Show cutout' : 'Show original'}</button></div>
        ${this.crop ? `<button class="btn sm block" style="margin-top:8px" id="cClearCrop">Clear crop (${this.crop.w}×${this.crop.h})</button>` : ''}
        <p class="hint" style="margin-top:10px">Erase: click any leftover background to remove it. Crop: drag a box around a chest graphic to lift just that.</p></div>` : ''}`;
    if (!this.src) { R.innerHTML = `<div class="sec"><h4><em>C</em>What this does</h4><p class="hint">1 — cuts the background.<br>2 — pulls the dominant colors.<br>3 — builds a 3D blank in the base color, or lifts the graphic onto the artwork canvas.<br>4 — optional: Claude reads the garment and drafts spec fields.</p></div>`; }
    else {
      const ai = this.ai, cur = S.current;
      R.innerHTML = `<div class="sec"><h4><em>C</em>Palette<span class="r cap">click = body color</span></h4>${this.palette.length ? `<div class="palette">${this.palette.map(p => `<button data-pal="${p.hex}"><i style="background:${p.hex}"></i><span>${p.hex.toUpperCase()} · ${Math.round(p.pct * 100)}%</span></button>`).join('')}</div>` : '<p class="hint">No foreground left — lower tolerance.</p>'}</div>
        <div class="sec"><h4><em>D</em>Build</h4>
          <div class="grid2">${Panels.select('_cat', 'Blank type', ai?.category && CATS[ai.category] ? ai.category : 'tee', Object.entries(CATS).filter(([k]) => k !== 'watch').map(([k, v]) => [k, v.label])).replace('data-bind="_cat"', 'id="cCat"')}
          ${Panels.select('_fit', 'Fit', FITS[ai?.fit] ? ai.fit : 'boxy', Object.entries(FITS).map(([k, v]) => [k, v.label])).replace('data-bind="_fit"', 'id="cFit"')}</div>
          <button class="btn primary block" style="margin-top:10px" id="cBlank">Create 3D blank from photo</button>
          <div class="grid2" style="margin-top:8px"><button class="btn" id="cArtF" ${cur && cur.category !== 'watch' ? '' : 'disabled'}>Graphic → front</button><button class="btn" id="cArtB" ${cur && cur.category !== 'watch' ? '' : 'disabled'}>Graphic → back</button></div>
          <div class="grid2" style="margin-top:8px"><button class="btn" id="cCw" ${cur ? '' : 'disabled'}>Palette → colorways</button><button class="btn" id="cRef" ${cur ? '' : 'disabled'}>Attach as reference</button></div>
          <p class="hint" style="margin-top:8px">${cur ? `Graphic, colorway and reference actions go to <b style="color:var(--bone)">${esc(cur.styleNo)}</b>.` : 'Open a design to send graphics, colorways or references to it.'}</p></div>
        <div class="sec"><h4><em>E</em>Claude read<span class="r cap">optional</span></h4>
          <button class="btn block" id="cAi">${this.aiBusy ? 'Reading…' : ai ? 'Re-analyze' : 'Analyze garment with Claude'}</button>
          ${ai ? this.aiHTML(ai) : `<p class="hint" style="margin-top:8px">Sends this image to the Claude API with your key from Settings. Returns silhouette, fit, colors, graphics and construction notes, then prefills the blank.</p>`}</div>`;
    }
    this.bind();
  },
  aiHTML(a) {
    const li = arr => `<ul>${(arr || []).map(x => `<li>${esc(typeof x === 'string' ? x : `${x.placement}: ${x.description} (${x.technique_guess})`)}</li>`).join('')}</ul>`;
    return `<dl class="ai-out" style="margin-top:10px"><dt>Read as</dt><dd>${esc(a.name_suggestion)} — ${esc(a.category)}, ${esc(a.fit)}</dd>
      <dt>Neckline / sleeve</dt><dd>${esc(a.neckline)} · ${esc(a.sleeve)}</dd><dt>Fabric guess</dt><dd>${esc(a.fabric_guess)}</dd>
      <dt>Colors</dt><dd>${[a.base_color_hex, ...(a.secondary_colors_hex || [])].map(h => `<span class="tp-sw" style="background:${esc(h)}"></span>`).join('')}</dd>
      <dt>Features</dt><dd>${li(a.features)}</dd><dt>Graphics</dt><dd>${li(a.graphics)}</dd><dt>Construction</dt><dd>${li(a.construction_notes)}</dd></dl>`;
  },
  bind() {
    const on = (id, fn) => { const el = $('#' + id); if (el) el.onclick = fn; };
    on('cPick', () => pickImage(u => this.load(u)));
    const tol = $('#cTol'); if (tol) tol.oninput = e => { this.tol = num(e.target.value); e.target.closest('.fld').querySelector('b').textContent = this.tol; };
    if (tol) tol.onchange = () => this.autoCut();
    on('cAuto', () => this.autoCut());
    $$('#cMode button').forEach(b => b.onclick = () => { this.mode = b.dataset.m; this.panels(); });
    on('cReset', () => { this.mask.fill(255); this.analyze(); this.render(); this.panels(); });
    on('cOrig', () => { this.showOrig = !this.showOrig; this.render(); this.panels(); });
    on('cClearCrop', () => { this.crop = null; this.render(); this.panels(); });
    $$('[data-pal]').forEach(b => b.onclick = () => { if (S.current && S.current.category !== 'watch') { S.current.garment.color = b.dataset.pal; touch(); toast('Body color set on ' + S.current.styleNo); } else toast('Open a garment design first', true); });
    on('cBlank', () => this.makeBlank());
    on('cArtF', () => this.toArt('front')); on('cArtB', () => this.toArt('back'));
    on('cCw', () => { const d = S.current; this.palette.slice(0, 4).forEach((p, i) => d.colorways.push(row({ name: 'Capture ' + (i + 1), hex: p.hex, pantone: '', notes: `${Math.round(p.pct * 100)}% of reference` }))); touch(); toast(`${Math.min(4, this.palette.length)} colorways added to ${d.styleNo}`); });
    on('cRef', async () => { const id = await Assets.put(this.srcURL, 'Reference'); S.current.refs.push(id); touch(); toast('Reference attached to ' + S.current.styleNo); });
    on('cAi', () => this.runAI());
  },
  async makeBlank() {
    const cat = $('#cCat').value, fit = $('#cFit').value, ai = this.ai, base = ai?.base_color_hex && /^#[0-9a-f]{6}$/i.test(ai.base_color_hex) ? ai.base_color_hex : this.palette[0]?.hex || '#E9E3D6';
    const ref = await Assets.put(this.srcURL, 'Reference');
    const d = newDesign(cat, ai?.name_suggestion || 'Capture — ' + CATS[cat].label);
    Object.assign(d.garment, { color: base, trim: base, stitch: base, fit });
    if (ai) { d.notes = [`Read from reference (Claude): ${ai.neckline}; ${ai.sleeve}; ${ai.fabric_guess}.`, 'Features: ' + (ai.features || []).join(', '), 'Graphics: ' + (ai.graphics || []).map(g => `${g.placement} — ${g.description} (${g.technique_guess})`).join('; ')].join('\n'); if (ai.construction_notes?.length) d.construction.push(...ai.construction_notes.map(n => row({ area: 'From reference', method: n, spi: '', notes: 'Verify on sample' }))); }
    d.colorways = this.palette.slice(0, 3).map((p, i) => row({ name: i ? 'Alt ' + i : 'Main', hex: p.hex, pantone: '', notes: '' }));
    if (!d.colorways.length) d.colorways = [row({ name: 'Main', hex: base, pantone: '', notes: '' })];
    d.refs = [ref]; S.designs.push(d); await DB.put('designs', d);
    toast('Blank built: ' + d.styleNo); openDesign(d.id, 'studio');
  },
  async toArt(side) {
    const c = this.cutout(this.crop); if (!c) return toast('Nothing left in the cutout', true);
    Art.side = side; await Art.addImage(c.toDataURL('image/png'), 'Lifted graphic'); go('artwork');
  },
  async runAI() {
    if (this.aiBusy) return;
    this.aiBusy = true; this.panels();
    try { this.ai = await analyzeWithClaude(downscaleURL(this.src, 1400)); toast('Claude read complete'); }
    catch (err) { toast(err.message || String(err), true); }
    this.aiBusy = false; this.panels();
  },
};
function kmeans(pts, k, iters) {
  if (!pts.length) return [];
  let cs = Array.from({ length: k }, (_, i) => pts[Math.floor(i * pts.length / k)].slice());
  let asg = new Array(pts.length).fill(0);
  for (let it = 0; it < iters; it++) {
    pts.forEach((p, i) => { let b = 0, bd = Infinity; cs.forEach((c, j) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; b = j; } }); asg[i] = b; });
    const sum = cs.map(() => [0, 0, 0, 0]); pts.forEach((p, i) => { const s = sum[asg[i]]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; });
    cs = cs.map((c, j) => sum[j][3] ? [sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3]] : c);
  }
  const n = cs.map((_, j) => asg.filter(a => a === j).length);
  return cs.map((c, j) => ({ c, n: n[j] })).filter(x => x.n).sort((a, b) => b.n - a.n);
}
function trimCanvas(c) {
  const x = c.getContext('2d'), d = x.getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let i = 0; i < c.width; i++) if (d[(y * c.width + i) * 4 + 3] > 20) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null; const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1; o.getContext('2d').drawImage(c, -x0, -y0); return o;
}
function downscaleURL(canvas, max) { const f = Math.min(1, max / Math.max(canvas.width, canvas.height)); const c = document.createElement('canvas'); c.width = Math.round(canvas.width * f); c.height = Math.round(canvas.height * f); c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', .88); }
// capture canvas pointer: erase-click or drag crop
(() => {
  let start = null;
  document.addEventListener('pointerdown', e => { if (e.target.id !== 'capCanvas' || !Capture.src) return; const p = Capture.pt(e); if (Capture.mode === 'erase') { Capture.eraseAt(p.x, p.y); Capture.panels(); } else { start = p; e.target.setPointerCapture(e.pointerId); } });
  document.addEventListener('pointermove', e => { if (!start) return; const p = Capture.pt(e); Capture.crop = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x) + 1, h: Math.abs(p.y - start.y) + 1 }; Capture.render(); });
  document.addEventListener('pointerup', () => { if (!start) return; start = null; if (Capture.crop && (Capture.crop.w < 8 || Capture.crop.h < 8)) Capture.crop = null; Capture.panels(); });
})();

/* ---------- Claude vision read (optional; key stays on this device) ---------- */
const AI_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['name_suggestion', 'category', 'base_color_hex', 'secondary_colors_hex', 'fit', 'neckline', 'sleeve', 'fabric_guess', 'features', 'graphics', 'construction_notes'],
  properties: {
    name_suggestion: { type: 'string' },
    category: { type: 'string', enum: ['tee', 'longsleeve', 'crewneck', 'hoodie', 'watch', 'other'] },
    base_color_hex: { type: 'string' }, secondary_colors_hex: { type: 'array', items: { type: 'string' } },
    fit: { type: 'string', enum: ['boxy', 'regular', 'oversized', 'n/a'] },
    neckline: { type: 'string' }, sleeve: { type: 'string' }, fabric_guess: { type: 'string' },
    features: { type: 'array', items: { type: 'string' } },
    graphics: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['placement', 'description', 'technique_guess'], properties: { placement: { type: 'string' }, description: { type: 'string' }, technique_guess: { type: 'string' } } } },
    construction_notes: { type: 'array', items: { type: 'string' } },
  },
};
async function analyzeWithClaude(dataUrl) {
  const key = Settings.get().apiKey;
  if (!key) throw new Error('Add an Anthropic API key in Settings to use the Claude read.');
  const { default: Anthropic } = await import('https://esm.sh/@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  const [meta, data] = dataUrl.split(','), media_type = meta.slice(5, meta.indexOf(';'));
  const res = await client.beta.messages.create({
    model: 'claude-opus-5-5', max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: AI_SCHEMA } },
    system: 'You are the technical designer for DPP (Don\'t Postpone Passion), a streetwear brand. You read reference photos of garments or watches and describe them the way a tech pack needs: silhouette, fit, neckline, sleeve, fabric, trims, graphics with placement and likely print technique, and construction a factory would need to replicate it. Hex colors must be #RRGGBB of the actual garment color, not the background. Be specific and short.',
    messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type, data } }, { type: 'text', text: 'Read this reference for a DPP prototype.' }] }],
  });
  if (res.stop_reason === 'refusal') throw new Error('Claude declined to read this image.');
  const txt = res.content.find(b => b.type === 'text')?.text;
  if (!txt) throw new Error('No analysis returned (stop reason: ' + res.stop_reason + ').');
  return JSON.parse(txt);
}

/* =========================================================================
   13. Tech pack — printable, fully editable
   ========================================================================= */
const TechPack = {
  render() {
    const d = S.current; if (!d) return;
    const isW = d.category === 'watch', pages = [this.cover(d), this.materials(d), this.measure(d), isW ? null : this.art(d), this.build(d), this.cost(d)].filter(Boolean);
    $('#tpScroll').innerHTML = pages.map((p, i) => `<div class="tp-page">${this.head(d, p.title, i + 1, pages.length)}${p.body}${this.foot(d)}</div>`).join('');
    Mark.paint($('#tpScroll')); this.calc();
  },
  head(d, title, n, of) {
    return `<div class="tp-head"><div data-mark></div><h2><small>Tech pack · ${esc(CATS[d.category].label)}</small>${esc(title)}</h2>
      <div class="pg">Style <b>${esc(d.styleNo)}</b> · Rev <b>${String(d.revisions.length).padStart(2, '0')}</b><br>${esc(d.name)}<br>Page <b>${n}</b> / ${of} · ${today()}</div></div>`;
  },
  foot(d) { return `<div class="tp-foot"><span>DPP — Don't Postpone Passion · Confidential</span><span>${esc(d.factory || 'Factory TBD')}</span><span>Status · ${esc(d.status)}</span></div>`; },
  inp(path, val, cls = '', type = 'text') { return `<input class="tp-in ${cls}" data-tp="${path}" type="${type}" value="${esc(val ?? '')}">`; },
  fig(img, cap, right = '') { return `<div class="tp-fig"><div class="im">${img || `<div class="missing">Not captured<br>3D Studio → Save renders</div>`}</div><div class="cp"><span>${cap}</span><span>${right}</span></div></div>`; },
  table(key, cols, rows, opts = {}) {
    return `<table class="tp-tbl"><thead><tr>${cols.map(c => `<th class="${c.num ? 'num' : ''}" style="${c.w ? 'width:' + c.w : ''}">${c.label}</th>`).join('')}<th class="x"></th></tr></thead>
      <tbody>${rows.map(r => `<tr>${cols.map(c => c.calc ? `<td class="calc ${c.cls?.(r) || ''}" data-calc="${key}:${r.id}:${c.key}"></td>` : `<td class="${c.num ? 'num' : ''}">${c.color ? `<span class="tp-sw" style="background:${esc(r[c.key])}"></span>` : ''}<input class="tp-in" data-tbl="${key}" data-id="${r.id}" data-f="${c.key}" ${c.num ? 'type="number" step="any"' : ''} value="${esc(r[c.key] ?? '')}" ${c.color ? 'style="width:72%"' : ''}></td>`).join('')}<td class="x"><button data-del="${key}:${r.id}" title="Remove row">×</button></td></tr>`).join('')}</tbody>${opts.foot || ''}</table>`;
  },
  cover(d) {
    const isW = d.category === 'watch';
    const meta = [['Style no', 'styleNo'], ['Name', 'name'], ['Drop', 'drop'], ['Season', 'season'], ['Designer', 'designer'], ['Factory', 'factory'], [isW ? 'Edition cap' : 'Retail (USD)', isW ? 'edition' : 'msrp'], ['Status', 'status']];
    const r = d.renders || {};
    return {
      title: 'Overview', body: `<div class="tp-meta">${meta.map(([l, k]) => `<div><label>${l}</label>${k === 'status' ? `<select class="tp-in" data-tp="status">${STATUSES.map(s => `<option ${s === d.status ? 'selected' : ''}>${s}</option>`).join('')}</select>` : this.inp(k, d[k])}</div>`).join('')}</div>
      <div class="tp-figs" style="margin-top:18px">${this.fig(r.front && `<img src="${r.front}">`, '3D · Front')}${this.fig(r.back && `<img src="${r.back}">`, isW ? '3D · 3/4' : '3D · Back')}${this.fig(flatSVG(d, 'front'), 'Flat · Front', 'NTS')}${this.fig(flatSVG(d, 'back'), 'Flat · Back', 'NTS')}</div>
      <div class="tp-grid" style="grid-template-columns:2fr 1fr;margin-top:18px"><div><h3>Design intent</h3><div class="tp-note" contenteditable data-tpnote="notes">${esc(d.notes)}</div></div>
      <div><h3>References</h3><div id="tpRefs" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">${d.refs.length ? '' : '<span class="tp-scale">None attached</span>'}</div></div></div>`
    };
  },
  materials(d) {
    const isW = d.category === 'watch', g = d.garment, W = d.watch, f = FABRICS[g.fabric];
    const spec = isW
      ? [['Case', `${W.dia} mm · ${WOODS[W.caseWood].label}`], ['Bezel', BEZELS[W.bezel].label], ['Dial / indices', `<span class="tp-sw" style="background:${W.dial}"></span>${W.dial.toUpperCase()} / <span class="tp-sw" style="background:${W.index}"></span>${W.index.toUpperCase()}`], ['Seconds accent', `<span class="tp-sw" style="background:${W.accent}"></span>${W.accent.toUpperCase()}`], ['Movement', W.movement], ['Crystal', W.crystal], ['Water resistance', W.wr], ['Strap', `${WOODS[W.strapWood].label} center · ${WOODS[W.strapAccent].label} sides`], ['Edition', `N° ${String(W.editionNo).padStart(3, '0')} of ${d.edition || 150}`], ['Caseback', esc(W.engraving)]]
      : [['Body fabric', `${f.label} · ${f.comp}`], ['Fit', FITS[g.fit].label], ['Wash / finish', FINISHES[g.finish || 'none'].label], ['Distressing', DISTRESS[g.distress || 'none'].label], ['Body color', `<span class="tp-sw" style="background:${g.color}"></span>${g.color.toUpperCase()}`], ['Rib / trim', `<span class="tp-sw" style="background:${g.trim}"></span>${g.trim.toUpperCase()}`], ['Thread', `<span class="tp-sw" style="background:${g.stitch}"></span>${g.stitch.toUpperCase()} · tonal`], ['Front print', `${d.place.front.tech}${d.artwork.front.length ? '' : ' — no art'}`], ['Back print', `${d.place.back.tech}${d.artwork.back.length ? '' : ' — no art'}`]];
    return {
      title: 'Materials & BOM', body: `<div class="tp-grid" style="grid-template-columns:1fr 2.2fr">
        <div><h3>Specification <em>from 3D Studio</em></h3><div class="tp-kv">${spec.map(([k, v]) => `<label>${k}</label><div>${v}</div>`).join('')}</div>
          <h3 style="margin-top:18px">Colorways <button class="tp-add add" data-add="colorways">+ Row</button></h3>
          ${this.table('colorways', [{ key: 'name', label: 'Name' }, { key: 'hex', label: 'Hex', color: 1 }, { key: 'pantone', label: 'Pantone TCX' }], d.colorways)}</div>
        <div><h3>Bill of materials <button class="tp-add add" data-add="bom">+ Row</button></h3>
          ${this.table('bom', [{ key: 'component', label: 'Component', w: '15%' }, { key: 'material', label: 'Material', w: '28%' }, { key: 'spec', label: 'Spec / placement' }, { key: 'supplier', label: 'Supplier' }, { key: 'qty', label: 'Qty', num: 1, w: '7%' }, { key: 'uom', label: 'UoM', w: '6%' }, { key: 'cost', label: 'Unit $', num: 1, w: '8%' }, { key: 'ext', label: 'Ext $', calc: 1, w: '8%' }], d.bom,
        { foot: `<tfoot><tr><td colspan="7">Materials total / unit</td><td class="calc" data-calc="bomTotal"></td><td></td></tr></tfoot>` })}</div></div>`
    };
  },
  measure(d) {
    const P = d.pom, unit = P.unit;
    const cols = [{ key: 'code', label: 'POM', w: '5%' }, { key: 'desc', label: 'Description', w: '30%' }, { key: 'tol', label: '± Tol', num: 1, w: '6%' },
    ...P.sizes.map(s => s === P.base ? { key: 'base', label: s + ' · base', num: 1, w: '8%' } : { key: '_' + s, label: s, calc: 1, cls: () => '' }), ...(P.sizes.length > 1 ? [{ key: 'grade', label: 'Grade', num: 1, w: '6%' }] : [])];
    return {
      title: 'Measurements & grading', body: `<h3>Points of measure <em>${unit === 'in' ? 'inches · garment laid flat · fractions to 1/8"' : 'millimetres'}</em>
        ${P.sizes.length > 1 ? `<span style="margin-left:14px" class="tp-scale">Base size</span><select class="tp-in" data-tp="pom.base" style="width:60px">${P.sizes.map(s => `<option ${s === P.base ? 'selected' : ''}>${s}</option>`).join('')}</select>` : ''}
        <button class="tp-add add" data-add="pom">+ POM</button></h3>
        ${this.table('pom', cols, P.rows)}
        <div class="tp-grid" style="grid-template-columns:1fr 1fr;margin-top:18px"><div><h3>Measuring notes</h3><div class="tp-note" contenteditable data-tpnote="measureNotes">${esc(d.measureNotes ?? (unit === 'in' ? 'Measure garment flat, relaxed, after wash. HPS = high point shoulder at neck seam. Chest & sweep are ½ measurements. Grades apply per size step from the base size; edit any grade to override.' : 'All dimensions in mm, measured with calipers on finished assembly. Strap length measured clasp closed, all links installed.'))}</div></div>
        <div><h3>Fit reference</h3><div style="height:190px;display:grid;place-items:center;border:1px solid #ddd7ca;background:#fff">${flatSVG(d, 'front', { art: false }).replace('<svg', '<svg style="height:180px"')}</div></div></div>`
    };
  },
  art(d) {
    const spec = ['front', 'back'].map(side => { const P = d.place[side], bb = artBBox(d, side); return { side, P, bb, url: Art.thumbURL(d, side) }; });
    const fmt = v => frac(v) + '"';
    return {
      title: 'Artwork & placement', body: `<div class="tp-grid" style="grid-template-columns:1fr 1fr">${spec.map(({ side, P, bb, url }) => `<div>
        <h3>${side} · ${esc(P.tech)} <em>${d.artwork[side].length} layer${d.artwork[side].length === 1 ? '' : 's'}</em></h3>
        <div class="tp-grid" style="grid-template-columns:1fr 1fr;gap:12px">
          <div class="tp-fig" style="aspect-ratio:1"><div class="im" style="background:${d.garment.color}">${url ? `<img src="${url}">` : '<div class="missing">No artwork</div>'}</div><div class="cp"><span>Art · actual colors</span></div></div>
          <div class="tp-fig" style="aspect-ratio:1"><div class="im">${flatSVG(d, side)}</div><div class="cp"><span>Placement</span><span>NTS</span></div></div></div>
        <div class="tp-kv" style="margin-top:10px">${bb ? `<label>Art size W × H</label><div>${fmt(bb.w)} × ${fmt(bb.h)}</div><label>Top of art</label><div>${fmt(bb.top)} below ${side === 'front' ? 'HPS' : 'CB neck seam'}</div><label>Horizontal</label><div>${Math.abs(bb.cx) < .07 ? 'Centered on ' + (side === 'front' ? 'CF' : 'CB') : fmt(Math.abs(bb.cx)) + (bb.cx > 0 ? ' right' : ' left') + ' of center (as worn: ' + (side === 'front' ? (bb.cx > 0 ? 'wearer\'s left' : 'wearer\'s right') : (bb.cx > 0 ? 'wearer\'s right' : 'wearer\'s left')) + ')'}</div><label>Rotation</label><div>${P.r}°</div><label>Ink colors</label><div>${artInks(d, side).map(h => `<span class="tp-sw" style="background:${h}"></span>${h.toUpperCase()}`).join(' &nbsp;') || 'From image — separate at print shop'}</div>${isStitch(P.tech) ? `<label>Stitch count (est.)</label><div>≈ ${(Math.round(artCoverage(d, side) * (14 * P.s) ** 2 * 1500 / 500) * 500).toLocaleString()} stitches · 1,500 / sq in fill · confirm with digitizer</div>` : ''}` : `<label>Artwork</label><div>None on ${side}</div>`}</div></div>`).join('')}</div>
      <h3 style="margin-top:16px">Print notes</h3><div class="tp-note" contenteditable data-tpnote="printNotes">${esc(d.printNotes || 'Supply vector or 300 dpi PNG at 100% from DPP Studio export. Match ink colors to approved lab dips. Strike-off required before bulk.')}</div>`
    };
  },
  build(d) {
    return {
      title: 'Construction & finishing', body: `<h3>Construction <button class="tp-add add" data-add="construction">+ Row</button></h3>
      ${this.table('construction', [{ key: 'area', label: 'Area', w: '16%' }, { key: 'method', label: 'Method / stitch', w: '40%' }, { key: 'spi', label: 'SPI', w: '6%' }, { key: 'notes', label: 'Notes' }], d.construction)}
      <div class="tp-grid" style="grid-template-columns:1fr 1fr;margin-top:18px"><div><h3>Labels & branding</h3><div class="tp-note" contenteditable data-tpnote="labels" style="min-height:130px">${esc(d.labels)}</div></div>
      <div><h3>Packaging & shipping</h3><div class="tp-note" contenteditable data-tpnote="packaging" style="min-height:130px">${esc(d.packaging)}</div></div></div>`
    };
  },
  cost(d) {
    const c = d.costing;
    return {
      title: 'Costing & approvals', body: `<h3>Unit cost build <em>USD · per unit</em></h3>
      <div class="tp-cost"><div><label>Materials (BOM)</label><b data-calc="bomTotal"></b></div><div><label>CMT / labor</label>${this.inp('costing.labor', c.labor, '', 'number')}</div><div><label>Freight / unit</label>${this.inp('costing.freight', c.freight, '', 'number')}</div><div><label>Duty %</label>${this.inp('costing.dutyPct', c.dutyPct, '', 'number')}</div><div><label>Overhead / unit</label>${this.inp('costing.overhead', c.overhead, '', 'number')}</div><div><label>Landed cost</label><b data-calc="landed"></b></div></div>
      <div class="tp-cost" style="grid-template-columns:repeat(4,1fr);margin-top:10px"><div><label>Retail (USD)</label>${this.inp('msrp', d.msrp, '', 'number')}</div><div><label>Gross margin $</label><b data-calc="marginD"></b></div><div><label>Gross margin %</label><b data-calc="marginP"></b></div><div><label>${d.category === 'watch' ? 'Edition revenue' : 'Markup'}</label><b data-calc="${d.category === 'watch' ? 'edRev' : 'markup'}"></b></div></div>
      <h3 style="margin-top:22px">Revision log <button class="tp-add add" data-add="revisions">+ Revision</button></h3>
      ${this.table('revisions', [{ key: 'date', label: 'Date', w: '12%' }, { key: 'author', label: 'By', w: '14%' }, { key: 'note', label: 'Change' }], d.revisions)}
      <div class="tp-grid" style="grid-template-columns:repeat(3,1fr);margin-top:28px">${['Creative director', 'Founder', 'Factory'].map(r => `<div style="border-top:1px solid #141310;padding-top:6px"><span class="tp-scale">${r} approval · signature / date</span></div>`).join('')}</div>`
    };
  },
  calc() {
    const d = S.current, root = $('#tpScroll'); if (!root || !d) return;
    const set = (k, v) => $$(`[data-calc="${k}"]`, root).forEach(e => e.textContent = v);
    let tot = 0; d.bom.forEach(r => { const x = num(r.qty) * num(r.cost); tot += x; set(`bom:${r.id}:ext`, x ? x.toFixed(2) : '—'); });
    set('bomTotal', money(tot));
    const c = d.costing, landed = (tot + num(c.labor)) * (1 + num(c.dutyPct) / 100) + num(c.freight) + num(c.overhead);
    set('landed', money(landed)); const m = num(d.msrp) - landed;
    set('marginD', d.msrp ? money(m) : '—'); set('marginP', d.msrp && landed ? (m / num(d.msrp) * 100).toFixed(1) + '%' : '—');
    set('markup', d.msrp && landed ? (num(d.msrp) / landed).toFixed(2) + '×' : '—');
    set('edRev', d.msrp ? money(num(d.msrp) * num(d.edition || 150)) : '—');
    const P = d.pom, bi = P.sizes.indexOf(P.base);
    P.rows.forEach(r => P.sizes.forEach((s, i) => { if (s === P.base) return; const v = num(r.base) + (i - bi) * num(r.grade); set(`pom:${r.id}:_${s}`, P.unit === 'in' ? frac(v) : v.toFixed(1)); }));
    const refs = $('#tpRefs'); if (refs && d.refs.length && !refs.children.length) Promise.all(d.refs.map(id => Assets.get(id))).then(a => refs.innerHTML = a.filter(Boolean).map(s => `<img src="${s}" style="width:100%;aspect-ratio:1;object-fit:cover;border:1px solid #ddd7ca">`).join(''));
  },
  csv() {
    const d = S.current, q = v => `"${String(v ?? '').replace(/"/g, '""')}"`, lines = [];
    lines.push(['DPP TECH PACK', d.styleNo, d.name, 'Rev ' + d.revisions.length, today()].map(q).join(','), '');
    lines.push('BILL OF MATERIALS'); lines.push(['Component', 'Material', 'Spec', 'Supplier', 'Qty', 'UoM', 'Unit $', 'Ext $'].map(q).join(','));
    d.bom.forEach(r => lines.push([r.component, r.material, r.spec, r.supplier, r.qty, r.uom, r.cost, (num(r.qty) * num(r.cost)).toFixed(2)].map(q).join(',')));
    lines.push('', 'POINTS OF MEASURE (' + d.pom.unit + ')'); const P = d.pom, bi = P.sizes.indexOf(P.base);
    lines.push(['POM', 'Description', 'Tol', ...P.sizes, 'Grade'].map(q).join(','));
    P.rows.forEach(r => lines.push([r.code, r.desc, r.tol, ...P.sizes.map((s, i) => (num(r.base) + (i - bi) * num(r.grade)).toFixed(3)), r.grade].map(q).join(',')));
    download(`${d.styleNo}_techpack.csv`, lines.join('\r\n'), 'text/csv');
  },
};
function artBBox(d, side) {
  const L = d.artwork[side].filter(l => !l.hidden); if (!L.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  L.forEach(l => { const a = l.rot * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a)), hw = (l.w * c + l.h * s) / 2, hh = (l.w * s + l.h * c) / 2; x0 = Math.min(x0, l.x - hw); x1 = Math.max(x1, l.x + hw); y0 = Math.min(y0, l.y - hh); y1 = Math.max(y1, l.y + hh); });
  const P = d.place[side], k = 14 / 1024 * P.s;
  return { w: (x1 - x0) * k, h: (y1 - y0) * k, top: P.top + y0 * k, cx: P.dx + ((x0 + x1) / 2 - 512) * k };
}
function artInks(d, side) { const s = new Set(); d.artwork[side].filter(l => !l.hidden).forEach(l => { if (l.color) s.add(l.color.toLowerCase()); if (l.type === 'shape') { if (l.fill !== 'none') s.add(l.fill.toLowerCase()); if (l.sw > 0) s.add(l.stroke.toLowerCase()); } if (l.outline > 0) s.add(l.outlineColor.toLowerCase()); }); return [...s]; }
// tech pack events
document.addEventListener('input', e => {
  const t = e.target; if (!t.closest('#tpScroll') || !S.current) return; const d = S.current;
  if (t.dataset.tp) { setPath(d, t.dataset.tp, t.type === 'number' ? num(t.value) : t.value); if (t.dataset.tp === 'name' || t.dataset.tp === 'status') renderCtx(); if (t.dataset.tp === 'pom.base') TechPack.render(); }
  if (t.dataset.tbl) { const r = (t.dataset.tbl === 'pom' ? d.pom.rows : d[t.dataset.tbl]).find(x => x.id === t.dataset.id); r[t.dataset.f] = t.type === 'number' ? num(t.value) : t.value; if (t.dataset.f === 'hex') t.previousElementSibling?.style.setProperty('background', t.value); }
  if (t.dataset.tpnote) d[t.dataset.tpnote] = t.innerText;
  touch(); TechPack.calc();
});
document.addEventListener('change', e => { const t = e.target; if (t.closest('#tpScroll') && t.dataset.tp === 'status') { S.current.status = t.value; touch(); renderCtx(); } });
document.addEventListener('click', e => {
  if (!e.target.closest('#tpScroll') || !S.current) return; const d = S.current;
  const add = e.target.closest('[data-add]')?.dataset.add;
  if (add) {
    const blank = { bom: { component: '', material: '', spec: '', supplier: '', qty: 1, uom: 'pc', cost: 0 }, colorways: { name: '', hex: '#000000', pantone: '', notes: '' }, construction: { area: '', method: '', spi: '', notes: '' }, revisions: { date: today(), author: Settings.get().designer, note: '' }, pom: { code: '', desc: '', tol: .25, base: 0, grade: 0 } }[add];
    (add === 'pom' ? d.pom.rows : d[add]).push(row(blank)); touch(); TechPack.render();
  }
  const del = e.target.closest('[data-del]')?.dataset.del;
  if (del) { const [k, id] = del.split(':'); if (k === 'pom') d.pom.rows = d.pom.rows.filter(r => r.id !== id); else d[k] = d[k].filter(r => r.id !== id); touch(); TechPack.render(); }
});

/* =========================================================================
   13b. Image-prompt builder — drafts for ChatGPT image generation
   ========================================================================= */
const SHOTS = {
  ghost: 'Ghost-mannequin e-commerce photo, straight-on front view, garment shaped as if worn, no body visible',
  flat: 'Top-down flat lay on the floor, garment neatly arranged, sleeves slightly angled',
  model: 'On-model streetwear editorial, full outfit, candid pose, 35 mm lens, shallow depth of field',
  hero: 'Studio product hero shot, three-quarter angle, crisp edges',
  macro: 'Macro detail shot of the fabric and print, visible knit texture and thread',
};
const SCENES = {
  seamless: 'seamless pale studio backdrop (#EEF1F9)',
  ink: 'deep navy studio backdrop (#0A0B15)',
  dakar: 'Dakar rooftop at golden hour, warm low sun, city and ocean behind',
  stair: 'raw concrete stairwell, overcast daylight',
  night: 'city street at night, direct on-camera flash',
};
function promptSpec(d) {
  const isW = d.category === 'watch', g = d.garment, W = d.watch;
  if (isW) return `a ${W.dia} mm wooden wristwatch: ${WOODS[W.caseWood].label.toLowerCase()} case with a ${BEZELS[W.bezel].label.toLowerCase()} bezel, ${colorName(W.dial)} dial (${W.dial}) with ${colorName(W.index)} baton indices and hands, ${colorName(W.accent)} seconds hand, three-piece link bracelet in ${WOODS[W.strapWood].label.toLowerCase()} with ${WOODS[W.strapAccent].label.toLowerCase()} side links, brushed steel butterfly clasp. Small text "N° ${String(W.editionNo).padStart(3, '0')}/${d.edition || 150}" printed above 6 o'clock. Hand-finished natural wood grain, matte lacquer`;
  const noun = { tee: 'T-shirt', longsleeve: 'long-sleeve T-shirt', crewneck: 'crewneck sweatshirt', hoodie: 'pullover hoodie' }[d.category];
  const f = FABRICS[g.fabric], fit = FITS[g.fit].label.toLowerCase();
  const build = { tee: 'ribbed crew neck, dropped shoulders, twin-needle hems', longsleeve: 'ribbed crew neck, ribbed cuffs', crewneck: 'ribbed crew neck, ribbed cuffs and waistband', hoodie: 'lined hood with flat drawcords and metal aglets, kangaroo pocket, ribbed cuffs and waistband' }[d.category];
  const parts = [`a ${fit}-fit ${noun} in ${colorName(g.color)} (${g.color.toUpperCase()}), ${f.label.split('·')[0].trim().toLowerCase()} (${f.gsm} gsm, ${f.comp.toLowerCase()})`, build];
  if (g.trim.toLowerCase() !== g.color.toLowerCase()) parts.push(`contrast ${colorName(g.trim)} rib trim`);
  if (FINISHES[g.finish]?.phrase) parts.push(FINISHES[g.finish].phrase);
  if (DISTRESS[g.distress]?.phrase) parts.push(DISTRESS[g.distress].phrase);
  return parts.join(', ');
}
function promptGraphics(d) {
  if (d.category === 'watch') return 'The DPP logo printed small at 12 o\'clock on the dial.';
  return ['front', 'back'].map(side => {
    const L = d.artwork[side].filter(l => !l.hidden); if (!L.length) return '';
    const P = d.place[side], bb = artBBox(d, side);
    const what = L.map(l => l.type === 'text' ? `the text "${l.text.replace(/\n/g, ' / ')}" in ${l.font === 'UnifrakturMaguntia' ? 'blackletter' : l.font.includes('Mono') ? 'monospace' : 'heavy sans-serif'} ${colorName(l.color)}` : l.type === 'mark' ? `the DPP logo in ${colorName(l.color)}` : l.type === 'shape' ? `a ${l.shape === 'ellipse' ? 'circle' : 'block'} outline` : 'the supplied graphic').join(', ');
    const where = side === 'front' ? (Math.abs(bb.cx) > 2 ? (bb.cx > 0 ? 'left chest' : 'right chest') : 'center chest') : (bb.top < 2 ? 'back neck' : 'upper back');
    return `${side === 'front' ? 'Front' : 'Back'}: ${what} — ${P.tech.toLowerCase()}, ${where}, about ${Math.round(bb.w)} in wide.`;
  }).filter(Boolean).join(' ') || 'Blank — no graphics.';
}
function buildPrompt(d, o) {
  const brand = o.logo ? ' The attached DPP logo image is the exact brand mark — reproduce it faithfully wherever the logo appears; do not redraw it, add letters or invent other logos.' : '';
  return [
    `Photorealistic product image for DPP (Don't Postpone Passion), a limited-run streetwear brand.`,
    `Subject: ${promptSpec(d)}.`,
    `Graphics: ${o.graphics.trim()}${brand}`,
    `Shot: ${SHOTS[o.shot]}. Setting: ${SCENES[o.scene]}. Soft directional light, true-to-life color.`,
    o.extra.trim() ? `Direction: ${o.extra.trim()}` : '',
    `Rules: no extra text, logos or watermarks; realistic seams, stitching and fabric texture; full product in frame. Aspect ratio ${o.aspect}.`,
  ].filter(Boolean).join('\n\n');
}
function promptModal(design) {
  const tmp = design || newDesign('tee');
  const o = { shot: tmp.category === 'watch' ? 'hero' : 'ghost', scene: 'seamless', aspect: '4:5', logo: true, extra: '', graphics: promptGraphics(tmp) };
  const sel = (id, obj, v) => `<select class="in" id="${id}">${Object.entries(obj).map(([k, t]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${esc(typeof t === 'string' ? t.split(',')[0] : t.label)}</option>`).join('')}</select>`;
  modal(`<h2>Image prompt</h2><p class="sub">${design ? `From ${esc(design.styleNo)} — ${esc(design.name)}.` : 'New draft. Set the base, then save it as a design.'} Paste into ChatGPT image generation and attach the logo PNG for an exact mark.</p>
    ${design ? '' : `<div class="grid3"><div class="fld"><label>Piece</label><select class="in" id="pCat">${Object.entries(CATS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></div><div class="fld"><label>Color</label><div class="row"><input type="color" id="pColor" value="${tmp.garment.color}"></div></div><div class="fld"><label>Fit</label>${sel('pFit', FITS, 'boxy')}</div></div>
      <div class="grid3" style="margin-top:10px"><div class="fld"><label>Fabric</label>${sel('pFab', FABRICS, tmp.garment.fabric)}</div><div class="fld"><label>Wash</label>${sel('pFin', FINISHES, 'none')}</div><div class="fld"><label>Distress</label>${sel('pDis', DISTRESS, 'none')}</div></div>`}
    <div class="grid3" style="margin-top:10px"><div class="fld"><label>Shot</label>${sel('pShot', SHOTS, o.shot)}</div><div class="fld"><label>Setting</label>${sel('pScene', SCENES, o.scene)}</div><div class="fld"><label>Aspect</label><select class="in" id="pAsp">${['4:5', '1:1', '3:2', '16:9', '9:16'].map(a => `<option>${a}</option>`).join('')}</select></div></div>
    <div class="fld" style="margin-top:10px"><label>Graphics</label><textarea class="in" id="pGfx" rows="2">${esc(o.graphics)}</textarea></div>
    <div class="fld" style="margin-top:10px"><label>Extra direction</label><input class="in" id="pExtra" placeholder="e.g. oversized drape, model mid-stride, gold chain"></div>
    <label class="row" style="margin-top:10px;gap:8px;font-size:12px"><input type="checkbox" id="pLogo" checked> I'll attach the DPP logo image</label>
    <div class="fld" style="margin-top:12px"><label>Prompt<b id="pLen"></b></label><textarea class="in mono" id="pOut" rows="9" style="font-size:11.5px"></textarea></div>
    <div class="acts" style="flex-wrap:wrap"><button class="btn" id="pLogoDl">Download logo PNG</button>${design && design.category !== 'watch' && design.artwork.front.length ? '<button class="btn" id="pArtDl">Front art PNG</button>' : ''}<a class="btn" href="https://chatgpt.com/" target="_blank" rel="noopener">Open ChatGPT</a>${design ? '' : '<button class="btn" id="pSave">Save as new design</button>'}<button class="btn primary" id="pCopy">Copy prompt</button></div>`, (m, close) => {
    const regen = () => {
      if (!design) { const cat = $('#pCat').value; if (cat !== tmp.category) { tmp.category = cat; $('#pGfx').value = promptGraphics(tmp); } Object.assign(tmp.garment, { color: $('#pColor').value, trim: $('#pColor').value, fit: $('#pFit').value, fabric: $('#pFab').value, finish: $('#pFin').value, distress: $('#pDis').value }); }
      Object.assign(o, { shot: $('#pShot').value, scene: $('#pScene').value, aspect: $('#pAsp').value, logo: $('#pLogo').checked, extra: $('#pExtra').value, graphics: $('#pGfx').value });
      $('#pOut').value = buildPrompt(tmp, o); $('#pLen').textContent = $('#pOut').value.length + ' chars';
    };
    m.addEventListener('input', e => { if (e.target.id !== 'pOut') regen(); }); m.addEventListener('change', e => { if (e.target.id !== 'pOut') regen(); });
    regen();
    $('#pCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#pOut').value); toast('Prompt copied'); } catch { $('#pOut').select(); toast('Select-all done — press Ctrl+C', true); } };
    $('#pLogoDl').onclick = () => { const c = document.createElement('canvas'), h = 2048, w = Math.round(h * Mark.aspect); c.width = w + 256; c.height = h + 256; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); Mark.draw(x, c.width / 2, c.height / 2, w, h, '#0A0B15'); download('DPP-logo.png', c.toDataURL('image/png')); };
    const ad = $('#pArtDl'); if (ad) ad.onclick = () => download(`${design.styleNo}_front_art.png`, Art.composite(design, 'front', 2048).toDataURL('image/png'));
    const sv = $('#pSave'); if (sv) sv.onclick = async () => { const d = newDesign(tmp.category); Object.assign(d.garment, tmp.garment); d.notes = 'Draft prompt:\n' + $('#pOut').value; S.designs.push(d); await DB.put('designs', d); close(); openDesign(d.id, 'studio'); };
  });
}

/* =========================================================================
   14. Settings, backup, gate, global wiring
   ========================================================================= */
function settingsModal() {
  const st = Settings.get();
  modal(`<h2>Settings</h2><p class="sub">Stored on this device only.</p>
    <div class="fld"><label>Designer name (tech pack, revisions)</label><input class="in" id="stDesigner" value="${esc(st.designer)}"></div>
    <div class="fld" style="margin-top:12px"><label>Anthropic API key — optional, powers the Claude read in Capture</label><input class="in mono" id="stKey" type="password" value="${esc(st.apiKey)}" placeholder="sk-ant-…" autocomplete="off"></div>
    <p class="hint" style="margin-top:6px">Saved in this browser's local storage and sent only to api.anthropic.com. Use a key with a spend limit; don't use this on a shared machine.</p>
    <div class="grid2" style="margin-top:16px"><button class="btn" id="stExport">Export full backup</button><button class="btn" id="stImport">Import backup / design</button></div>
    <div class="grid2" style="margin-top:8px"><button class="btn" id="stPin">Change PIN</button><button class="btn" id="stLock">Lock now</button></div>
    <div class="acts"><button class="btn" data-x>Close</button><button class="btn primary" data-ok>Save</button></div>`, (m, close) => {
    $('[data-x]', m).onclick = close;
    $('[data-ok]', m).onclick = () => { Settings.set({ designer: $('#stDesigner').value.trim() || 'Kendrick', apiKey: $('#stKey').value.trim() }); close(); toast('Settings saved'); };
    $('#stExport').onclick = exportBackup; $('#stImport').onclick = () => $('#fileJson').click();
    $('#stPin').onclick = () => { localStorage.removeItem('dpp.pin'); sessionStorage.removeItem('dpp.unlocked'); location.reload(); };
    $('#stLock').onclick = () => { sessionStorage.removeItem('dpp.unlocked'); location.reload(); };
  });
}
async function exportBackup() {
  const assets = await DB.all('assets');
  download(`dpp-studio-backup-${today()}.json`, JSON.stringify({ app: 'dpp-studio', v: 1, exported: new Date().toISOString(), designs: S.designs, assets }), 'application/json');
}
async function importJSON(text) {
  const j = JSON.parse(text); let n = 0;
  const designs = j.designs || (j.design ? [j.design] : []);
  for (const a of j.assets || []) await DB.put('assets', a);
  for (const d of designs) { const i = S.designs.findIndex(x => x.id === d.id); if (i >= 0) S.designs[i] = d; else S.designs.push(d); await DB.put('designs', d); n++; }
  Art.thumbsDirty(); Library.render(); toast(`Imported ${n} design${n === 1 ? '' : 's'}`);
}
async function exportDesign() {
  const d = S.current, ids = new Set([...d.refs, ...['front', 'back'].flatMap(s => d.artwork[s].filter(l => l.asset).map(l => l.asset))]);
  const assets = (await Promise.all([...ids].map(id => DB.get('assets', id)))).filter(Boolean);
  download(`${d.styleNo}.json`, JSON.stringify({ app: 'dpp-studio', v: 1, design: d, assets }), 'application/json');
}
let pickCb = null;
function pickImage(cb) { pickCb = cb; $('#fileImg').value = ''; $('#fileImg').click(); }
$('#fileImg').onchange = async e => { const f = e.target.files[0]; if (f && pickCb) pickCb(await fileToDataURL(f)); };
$('#fileJson').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { await importJSON(await f.text()); $('#modal').classList.remove('on'); } catch (err) { toast('Import failed: ' + err.message, true); } };

async function sha(s) {
  if (crypto?.subtle) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('dpp:' + s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
  let h = 5381; for (const c of 'dpp:' + s) h = (h * 33 ^ c.charCodeAt(0)) >>> 0; return 'x' + h.toString(16);
}
function gate() {
  return new Promise(res => {
    $('#gateYear').textContent = 'Internal · ' + new Date().getFullYear();
    if (sessionStorage.getItem('dpp.unlocked')) { $('#gate').remove(); return res(); }
    const stored = localStorage.getItem('dpp.pin'); let first = null;
    if (!stored) $('#gateMsg').textContent = 'First run on this device. Set a 4–8 digit studio PIN.';
    $('#gateForm').onsubmit = async e => {
      e.preventDefault(); const v = $('#gatePin').value.trim(); $('#gatePin').value = '';
      if (!/^\d{4,8}$/.test(v)) { $('#gateErr').textContent = 'PIN is 4–8 digits.'; return; }
      if (!stored) {
        if (!first) { first = v; $('#gateMsg').textContent = 'Confirm the PIN.'; $('#gateErr').textContent = ''; return; }
        if (first !== v) { first = null; $('#gateMsg').textContent = 'Did not match. Set a 4–8 digit studio PIN.'; return; }
        localStorage.setItem('dpp.pin', await sha(v));
      } else if (await sha(v) !== stored) { $('#gateErr').textContent = 'Wrong PIN.'; return; }
      sessionStorage.setItem('dpp.unlocked', '1'); $('#gate').remove(); res();
    };
  });
}

function wire() {
  $$('#tabs button').forEach(b => b.onclick = () => { if (b.dataset.view !== 'library' && b.dataset.view !== 'capture' && !S.current) { toast('Open or create a design first'); return; } go(b.dataset.view); });
  $('#btnSettings').onclick = settingsModal;
  $('#btnNew').onclick = () => Library.newModal();
  $('#btnPrompt').onclick = () => promptModal(null);
  $$('#libFilter button').forEach(b => b.onclick = () => { S.filter = b.dataset.f; $$('#libFilter button').forEach(x => x.classList.toggle('on', x === b)); Library.render(); });
  $('#libStatus').innerHTML += STATUSES.map(s => `<option>${s}</option>`).join('');
  $('#libStatus').onchange = () => Library.render(); $('#libSearch').oninput = debounce(() => Library.render(), 120);
  $('#cards').addEventListener('click', e => {
    const card = e.target.closest('.card[data-id]'); if (!card) return; const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'dup') return Library.dup(card.dataset.id); if (act === 'del') return Library.del(card.dataset.id);
    openDesign(card.dataset.id);
  });
  $('#cards').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.id) openDesign(e.target.dataset.id); });
  $('#tpPrint').onclick = () => window.print();
  $('#tpJson').onclick = exportDesign; $('#tpCsv').onclick = () => TechPack.csv();
  $('#tpRenders').onclick = async () => { await Studio.captureRenders(); TechPack.render(); };
  $('#capPick').onclick = () => pickImage(u => Capture.load(u));
  const drop = $('#capDrop');
  ['dragenter', 'dragover'].forEach(t => document.addEventListener(t, e => { if (S.view === 'capture') { e.preventDefault(); drop.classList.add('over'); } }));
  ['dragleave', 'drop'].forEach(t => document.addEventListener(t, e => { drop.classList.remove('over'); }));
  document.addEventListener('drop', async e => { if (S.view !== 'capture' && S.view !== 'artwork') return; e.preventDefault(); const f = [...e.dataTransfer.files].find(f => f.type.startsWith('image/')); if (!f) return; const u = await fileToDataURL(f); S.view === 'capture' ? Capture.load(u) : Art.addImage(u, f.name); });
  document.addEventListener('dragover', e => { if (S.view === 'artwork') e.preventDefault(); });
  document.addEventListener('paste', async e => {
    if (e.target.matches('input,textarea,[contenteditable]')) return;
    const it = [...e.clipboardData.items].find(i => i.type.startsWith('image/')); if (!it) return; e.preventDefault();
    const u = await fileToDataURL(it.getAsFile());
    if (S.view === 'artwork' && S.current) Art.addImage(u, 'Pasted'); else { go('capture'); Capture.load(u); }
  });
  document.addEventListener('keydown', e => {
    const typing = e.target.matches('input,textarea,select,[contenteditable]');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow().then(() => toast('Saved')); return; }
    if (S.view !== 'artwork' || typing) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? Art.redo() : Art.undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); Art.redo(); return; }
    const s = Art.L.find(l => l.id === Art.sel); if (!s) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); Art.del(); }
    const st = e.shiftKey ? 10 : 1, mv = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
    if (mv) { e.preventDefault(); s.x += mv[0]; s.y += mv[1]; Art.changed(); }
  });
  addEventListener('beforeunload', () => { if (S.current) DB.put('designs', S.current); });
  addEventListener('resize', () => Studio.ok && Studio.resize());
}

(async function boot() {
  await Mark.init();
  await gate();
  await DB.open();
  S.designs = await DB.all('designs');
  wire(); renderCtx(); Library.render();
  document.fonts.ready.then(() => { if (S.view === 'artwork') Art.render(); });
})();
