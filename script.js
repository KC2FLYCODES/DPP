// DPP Studio — internal design, 3D prototyping and tech pack tool.
// Storage: IndexedDB on this device (designs + image assets). Backup/restore via JSON.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ParametricGeometry } from 'three/addons/geometries/ParametricGeometry.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

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
  pants: { label: 'Pants', code: 'PT', msrp: null },
  shorts: { label: 'Shorts', code: 'SH', msrp: null },
  boxers: { label: 'Boxers', code: 'BX', msrp: null },
  socks: { label: 'Socks', code: 'SK', msrp: null },
  watch: { label: 'Watch', code: 'WT', msrp: 221 }, // The Teranga, Drop 001 — price per draft site
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
const SWATCHES = [['DPP Pale', '#EEF1F9'], ['DPP Ink', '#14172B'], ['DPP Deep', '#0A0B15'], ['DPP Gold', '#B98A4A'], ['White', '#FFFFFF'], ['Bone', '#E9E3D6'], ['Heather', '#9D9B96'], ['Khaki', '#B7A57A'], ['Indigo', '#283655'], ['Clay', '#9C5A3C'], ['Olive', '#59583A'], ['Oxblood', '#5B1F20']];
const FABRICS = {
  jersey: { label: 'Jersey · 220 gsm', gsm: 220, comp: '100% combed ring-spun cotton', rough: .88, sheen: .45, bump: .55, for: 'any' },
  heavy: { label: 'Heavyweight jersey · 300 gsm', gsm: 300, comp: '100% cotton, open-end, garment-dyed', rough: .93, sheen: .55, bump: .8, for: 'any' },
  fleece: { label: 'Loopback fleece · 420 gsm', gsm: 420, comp: '100% cotton French terry, loopback', rough: .97, sheen: .85, bump: .45, for: 'any' },
  waffle: { label: 'Waffle knit · 260 gsm', gsm: 260, comp: '100% cotton thermal waffle', rough: .95, sheen: .3, bump: 1.6, for: 'top' },
  denim: { label: 'Rigid denim · 13.5 oz', gsm: 458, comp: '100% cotton, 3/1 right-hand twill, ring-spun', rough: .9, sheen: .12, bump: 1.4, weave: 'denim', tint: 1, k: 1.6, for: 'bottom' },
  twill: { label: 'Khaki chino twill · 9 oz', gsm: 305, comp: '100% cotton 2/1 twill, peached', rough: .82, sheen: .2, bump: .9, weave: 'twill', k: 1.8, for: 'bottom' },
  cord: { label: 'Corduroy · 8-wale', gsm: 340, comp: '100% cotton corduroy, 8 wales / in', rough: .78, sheen: .75, bump: 3, weave: 'cord', k: .65, for: 'bottom' },
  canvas: { label: 'Duck canvas · 12 oz', gsm: 407, comp: '100% cotton duck, plain weave', rough: .9, sheen: .1, bump: 1.2, weave: 'canvas', k: 2, for: 'bottom' },
  ripstop: { label: 'Cotton/nylon ripstop', gsm: 200, comp: '50% cotton / 50% nylon ripstop', rough: .7, sheen: .25, bump: .9, weave: 'ripstop', k: 1, for: 'bottom' },
  nylon: { label: 'Nylon taslan shell', gsm: 120, comp: '100% nylon taslan, DWR finish', rough: .42, sheen: .2, bump: .3, weave: 'nylon', k: 2, for: 'bottom' },
  linen: { label: 'Linen · 7 oz', gsm: 237, comp: '100% European linen', rough: .88, sheen: .15, bump: 1, weave: 'linen', tint: 1, k: 1.2, for: 'bottom' },
  modal: { label: 'Micro modal · 190 gsm', gsm: 190, comp: '92% modal / 8% elastane', rough: .55, sheen: .7, bump: .3, for: 'boxers' },
  sockknit: { label: 'Sock knit · 200 needle', gsm: 0, comp: '80% combed cotton / 17% nylon / 3% spandex', rough: .95, sheen: .4, bump: .9, for: 'socks' },
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
const MOVEMENTS = ['Miyota 2035 · quartz', 'Miyota 8215 · automatic', 'Miyota 82S7 · open-heart automatic', 'Seiko NH35A · automatic', 'Seiko NH34 · GMT automatic', 'Seiko NH38 · skeleton automatic', 'Sellita SW200 · automatic', 'Seiko VK63 · meca-quartz chrono'];

/* =========================================================================
   2b. Bottoms, underwear, socks — specs, flats, fabric patterns
   ========================================================================= */
const TOPS = ['tee', 'longsleeve', 'crewneck', 'hoodie'], BOTTOMS = ['pants', 'shorts', 'boxers'];
const isTop = c => TOPS.includes(c), isBottom = c => BOTTOMS.includes(c);
const PATTERNS = { solid: 'Solid', plaid: 'Plaid / tartan', gingham: 'Gingham check', pinstripe: 'Pinstripe' };
function bottomsPOM(cat) {
  if (cat === 'socks') return {
    unit: 'in', sizes: ['S', 'M', 'L'], base: 'M', rows: [
      row({ code: 'S1', desc: 'Foot length, heel to toe (relaxed)', tol: .25, base: 9, grade: .75 }),
      row({ code: 'S2', desc: 'Leg height, heel to top of cuff', tol: .25, base: 7, grade: .25 }),
      row({ code: 'S3', desc: 'Top opening ½ (relaxed)', tol: .125, base: 3.75, grade: .125 }),
      row({ code: 'S4', desc: 'Cuff rib height', tol: .125, base: 1.5, grade: 0 }),
      row({ code: 'S5', desc: 'Foot width ½ (relaxed)', tol: .125, base: 3.25, grade: .125 }),
      row({ code: 'S6', desc: 'Heel depth', tol: .125, base: 2.25, grade: .125 }),
    ]
  };
  const S = cat === 'boxers' ? ['S', 'M', 'L', 'XL', '2XL'] : ['28', '30', '32', '34', '36', '38'], base = cat === 'boxers' ? 'M' : '32';
  const g = cat === 'boxers' ? 1 : .5; // waist grade per size step
  const rows = {
    pants: [['A', 'Outseam, waist top to hem', .5, 41, .25], ['W1', 'Waist ½, relaxed', .25, 16, g], ['H1', 'Hip ½, 7" below waist', .5, 21.5, g], ['R1', 'Front rise incl. waistband', .25, 11.5, .125], ['R2', 'Back rise incl. waistband', .25, 15, .125], ['T1', 'Thigh ½, 1" below crotch', .25, 13, .375], ['K1', 'Knee ½, 14" below crotch', .25, 10.5, .25], ['O1', 'Leg opening ½', .25, 9, .25], ['I1', 'Inseam', .5, 30, 0], ['WB1', 'Waistband height', .0625, 1.5, 0]],
    shorts: [['A', 'Outseam, waist top to hem', .25, 20, .25], ['W1', 'Waist ½, relaxed', .25, 16, g], ['H1', 'Hip ½', .5, 22, g], ['R1', 'Front rise incl. waistband', .25, 12, .125], ['R2', 'Back rise incl. waistband', .25, 15, .125], ['T1', 'Thigh ½, 1" below crotch', .25, 14, .375], ['O1', 'Leg opening ½', .25, 13, .25], ['I1', 'Inseam', .25, 7, 0], ['WB1', 'Waistband height', .0625, 1.75, 0]],
    boxers: [['A', 'Side length, waist top to hem', .25, 12, .25], ['W1', 'Waist ½, relaxed', .25, 14.5, 1], ['H1', 'Hip ½', .5, 20, 1], ['R1', 'Front rise', .25, 10.5, .25], ['R2', 'Back rise', .25, 13, .25], ['I1', 'Inseam', .125, 4.5, 0], ['O1', 'Leg opening ½', .25, 12, .5], ['WB1', 'Elastic waistband height', .0625, 1.5, 0]],
  }[cat];
  return { unit: 'in', sizes: S, base, rows: rows.map(([code, desc, tol, b, gr]) => row({ code, desc, tol, base: b, grade: gr })) };
}
function bottomsBOM(cat) {
  const lbl = [row({ component: 'Main label', material: 'Woven damask', supplier: '', spec: 'DPP mark, inside back waistband', qty: 1, uom: 'pc', cost: 0 }), row({ component: 'Care / content label', material: 'Printed satin', supplier: '', spec: 'Left side seam', qty: 1, uom: 'pc', cost: 0 })];
  if (cat === 'socks') return [
    row({ component: 'Body yarn', material: '80% combed cotton / 17% nylon / 3% spandex', supplier: '', spec: '200-needle, terry footbed', qty: 1, uom: 'pr', cost: 0 }),
    row({ component: 'Cuff rib', material: '1×1 rib, spandex plated', supplier: '', spec: 'Per S4', qty: 1, uom: 'pr', cost: 0 }),
    row({ component: 'Heel / toe', material: 'Nylon reinforced', supplier: '', spec: 'Accent color per colorway', qty: 1, uom: 'pr', cost: 0 }),
    row({ component: 'Toe closure', material: 'Hand-linked seamless', supplier: '', spec: 'No bulky toe seam', qty: 1, uom: 'pr', cost: 0 }),
    row({ component: 'Header card', material: 'Uncoated 400 gsm board', supplier: '', spec: 'Drop + pair number', qty: 1, uom: 'pc', cost: 0 }),
  ];
  if (cat === 'boxers') return [
    row({ component: 'Body fabric', material: '92% micro modal / 8% elastane', supplier: '', spec: '190 gsm jersey', qty: .6, uom: 'yd', cost: 0 }),
    row({ component: 'Waistband', material: 'Jacquard woven elastic', supplier: '', spec: 'Knit-in DPP text, per WB1', qty: 1, uom: 'pc', cost: 0 }),
    row({ component: 'Pouch lining', material: 'Same as body', supplier: '', spec: 'Double layer', qty: .1, uom: 'yd', cost: 0 }),
    ...lbl.slice(1), row({ component: 'Packaging', material: 'Recycled box sleeve', supplier: '', spec: '1 or 3-pack', qty: 1, uom: 'pc', cost: 0 }),
  ];
  const shell = cat === 'pants' ? '13.5 oz rigid denim, 100% cotton' : 'Heavyweight cotton twill / fleece per colorway';
  const b = [
    row({ component: 'Shell fabric', material: shell, supplier: '', spec: 'Per colorway', qty: cat === 'pants' ? 1.6 : .9, uom: 'yd', cost: 0 }),
    row({ component: 'Pocketing', material: 'Cotton twill 3.5 oz', supplier: '', spec: 'Front pockets', qty: .25, uom: 'yd', cost: 0 }),
    row({ component: 'Fly', material: 'YKK metal zipper #4.5', supplier: '', spec: 'Or elastic + drawcord', qty: 1, uom: 'pc', cost: 0 }),
    row({ component: 'Shank button / rivets', material: 'Brass, DPP engraved', supplier: '', spec: '1 button + 6 rivets', qty: 1, uom: 'set', cost: 0 }),
    row({ component: 'Thread', material: 'Tex 70 core-spun', supplier: '', spec: 'Contrast or tonal', qty: 1, uom: 'cone', cost: 0 }),
    ...lbl,
  ];
  return b;
}
function bottomsConstruction(cat) {
  if (cat === 'socks') return [row({ area: 'Knit', method: '200-needle circular knit, terry sole', spi: '', notes: 'Y-heel.' }), row({ area: 'Toe', method: 'Hand-linked', spi: '', notes: 'Seamless feel.' }), row({ area: 'Cuff', method: '1×1 rib, spandex plated', spi: '', notes: 'No dig-in.' }), row({ area: 'Finish', method: 'Boarding + pairing', spi: '', notes: 'Pair numbers match header card.' })];
  if (cat === 'boxers') return [row({ area: 'Seams', method: 'Flatlock 4-needle', spi: '14', notes: 'No chafe.' }), row({ area: 'Waistband', method: 'Elastic attached 3-needle coverstitch', spi: '12', notes: '' }), row({ area: 'Leg hem', method: 'Coverstitch 3/4"', spi: '12', notes: '' })];
  return [
    row({ area: 'Out/inseam', method: '5-thread safety stitch, topstitched', spi: '10', notes: '' }),
    row({ area: 'Waistband', method: 'Double-needle, belt loops ×5', spi: '10', notes: 'Double waistband: second band joined above main band, see WB2.' }),
    row({ area: 'Fly', method: 'J-stitch, bartack at base', spi: '10', notes: '' }),
    row({ area: 'Pockets', method: 'Bartacks at openings, rivets at stress points', spi: '', notes: '' }),
    row({ area: 'Hem', method: 'Chainstitch 1" turn', spi: '10', notes: '' }),
    row({ area: 'Wash', method: 'Rinse / enzyme per finish', spi: '', notes: 'Target shrinkage < 3%.' }),
  ];
}
function bottomsFlat(d, side, stroke) {
  const g = d.garment, fill = g.color, front = side === 'front';
  let s = `<svg viewBox="0 -40 400 480" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round">`;
  if (d.category === 'socks') {
    s += `<path d="M150 0 L150 250 C150 300 130 330 120 360 C110 395 140 410 180 405 L320 395 C350 392 352 360 330 350 L230 330 C215 320 212 300 214 250 L214 0 Z" fill="${fill}"/>`;
    s += `<path d="M150 46 L214 46" stroke-dasharray="3 2.5"/>${[8, 16, 24, 32, 40].map(y => `<path d="M${150 + 6} ${y} V${y + 0}"/>`).join('')}`;
    s += `<path d="M120 360 C110 395 140 410 180 405 L182 360 C160 350 135 345 120 360Z" fill="${g.trim}"/><path d="M300 397 L320 395 C350 392 352 360 330 350 L300 345Z" fill="${g.trim}"/>`;
    return s + '</svg>';
  }
  const short = d.category !== 'pants', box = d.category === 'boxers', hemY = box ? 230 : short ? 300 : 430;
  const wb2 = (g.doubleWB === '1') && !box;
  s += wb2 ? `<rect x="104" y="-6" width="192" height="26" fill="${g.wb2Pattern === 'plaid' ? g.plaid1 : g.wb2Color}"/>` : '';
  s += `<path d="M110 20 L290 20 L${box ? 318 : 306} ${hemY} L${box ? 214 : 212} ${hemY} L200 ${box ? 150 : 170} L${box ? 186 : 188} ${hemY} L${box ? 82 : 94} ${hemY} Z" fill="${fill}"/>`;
  s += `<path d="M110 48 L290 48"/>` + (box ? `<path d="M110 22 L290 22 M110 46 L290 46" stroke-dasharray="2 3"/>` : front ? `<path d="M200 48 L200 130" stroke-dasharray="3 2.5"/><path d="M118 48 C130 80 150 90 168 92 M282 48 C270 80 250 90 232 92"/>` : `<path d="M140 90 L180 86 L182 130 L144 134Z M260 90 L220 86 L218 130 L256 134Z"/><path d="M110 48 L200 74 L290 48"/>`);
  if (!box) for (const x of [118, 158, 200, 242, 282]) s += `<rect x="${x - 3}" y="18" width="6" height="32" fill="${fill}"/>`;
  s += `<path d="M${box ? 86 : 96} ${hemY - 10} L${box ? 186 : 188} ${hemY - 10} M${box ? 214 : 212} ${hemY - 10} L${box ? 314 : 304} ${hemY - 10}" stroke-dasharray="3 2.5"/>`;
  return s + '</svg>';
}

/* =========================================================================
   3. Presets — starter specs. Values are industry starting points; confirm on fit sample.
   ========================================================================= */
const row = o => ({ id: uid('r'), ...o });
function presetPOM(cat) {
  if (isBottom(cat) || cat === 'socks') return bottomsPOM(cat);
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
  if (isBottom(cat) || cat === 'socks') return bottomsBOM(cat);
  if (cat === 'watch') return [
    row({ component: 'Case', material: 'Per spec — shape, material, finish on Materials page', supplier: '', spec: 'Finish per colorway', qty: 1, uom: 'pc', cost: 0 }),
    row({ component: 'Movement', material: 'Per spec sheet', supplier: '', spec: 'See movement field', qty: 1, uom: 'pc', cost: 0 }),
    row({ component: 'Crystal', material: 'Sapphire, AR coated inside', supplier: '', spec: 'Flat, 1.5 mm', qty: 1, uom: 'pc', cost: 0 }),
    row({ component: 'Dial', material: 'Brass, printed', supplier: '', spec: 'Edition number pad-printed', qty: 1, uom: 'pc', cost: 0 }),
    row({ component: 'Hands', material: 'Steel, painted', supplier: '', spec: 'H/M/S set', qty: 1, uom: 'set', cost: 0 }),
    row({ component: 'Bezel / insert', material: 'Per spec', supplier: '', spec: 'Insert print per artwork', qty: 1, uom: 'pc', cost: 0 }),
    row({ component: 'Crown', material: '316L stainless, push-pull', supplier: '', spec: 'Hourglass engraved end', qty: 1, uom: 'pc', cost: 0 }),
    row({ component: 'Caseback', material: '316L stainless, laser engraved', supplier: '', spec: 'Baobab engraving + edition N°/150', qty: 1, uom: 'pc', cost: 0 }),
    row({ component: 'Bracelet / strap', material: 'Per spec', supplier: '', spec: 'Removable links or quick-release bars', qty: 1, uom: 'set', cost: 0 }),
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
  if (isBottom(cat) || cat === 'socks') return bottomsConstruction(cat);
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
    garment: { color: '#EEF1F9', trim: '#EEF1F9', stitch: cat === 'socks' ? '#14172B' : '#EEF1F9', fabric: { hoodie: 'fleece', crewneck: 'fleece', pants: 'denim', shorts: 'twill', boxers: 'modal', socks: 'sockknit' }[cat] || 'heavy', fit: 'boxy', finish: 'none', distress: 'none', pattern: 'solid', sockStyle: 'crew', sockAccent: '1', sockCuff: '', stripes: 0, stripeCol: '#B98A4A', plaid1: '#14172B', plaid2: '#B98A4A', plaid3: '#EEF1F9', plaidScale: 1, doubleWB: '', wb2Color: '#B98A4A', wb2Pattern: 'plaid', wb2H: 1.75 },
    watch: { ...WATCH_DEFAULT },
    place: cat === 'socks' ? { front: { dx: 0, top: 2, s: .25, r: 0, tech: 'Flat embroidery' }, back: { dx: 0, top: 2, s: .25, r: 0, tech: 'Flat embroidery' } } : { front: { dx: 0, top: 3, s: 1, r: 0, tech: 'Screen print' }, back: { dx: 0, top: 4, s: 1, r: 0, tech: 'Screen print' } },
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
// HPS height as a fraction of each default model's height (hooded models sit lower)
const MODEL_CAL = { tee: .965, longsleeve: .965, crewneck: .965, hoodie: .74, pants: 1, shorts: 1, boxers: 1, socks: 1 };
// default files that bundle a body or a second garment: keep only these node names
const MODEL_KEEP = { shorts: ['Object_6'], pants: ['Object_573'] };
// default models whose normal maps carry baked-in logos — use geometry folds only
const MODEL_NO_NORMAL = ['pants'];
// Garment meshes: per-design upload (garment.model asset id) or studio default at assets/models/<category>.glb
const Models = {
  cache: new Map(), // key -> THREE.Object3D | null (null = not available); absent while loading
  pending: new Map(),
  file(d) { return d.category === 'socks' && d.garment.sockStyle === 'noshow' ? 'socks-noshow' : d.category; },
  key(d) { return d.garment.model ? 'asset:' + d.garment.model : 'file:' + this.file(d); },
  peek(d) { return this.cache.get(this.key(d)); },
  load(d) {
    const k = this.key(d); if (this.cache.has(k)) return Promise.resolve(this.cache.get(k));
    if (!this.pending.has(k)) this.pending.set(k, (async () => {
      try {
        const src = d.garment.model ? await Assets.get(d.garment.model) : `assets/models/${this.file(d)}.glb`;
        this.cache.set(k, src ? (await new GLTFLoader().loadAsync(src)).scene : null);
      } catch { this.cache.set(k, null); } // no default model for this silhouette — procedural fallback
      this.pending.delete(k); return this.cache.get(k);
    })());
    return this.pending.get(k);
  },
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
  if (isBottom(d.category) || d.category === 'socks') return bottomsFlat(d, side, stroke);
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
  const W = watchSpec(d), cHex = caseHex(W), G = WATCH_GEOM[W.shape] || WATCH_GEOM.round, k = 98;
  const path = (pts, s) => 'M' + pts.map(p => `${(200 + p.x * k * s).toFixed(1)} ${(200 - p.y * k * s).toFixed(1)}`).join(' L') + 'Z';
  const caseP = W.shape === 'round' ? null : shapePts(W.shape, 1, 64);
  const metalStrap = ['oyster', 'jubilee', 'integrated', 'mesh'].includes(W.strap), metalHex = CASE_MATS[W.caseMat]?.kind === 'metal' ? cHex : '#c4c3bf';
  let s = `<svg viewBox="0 -40 400 480" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="${stroke}" stroke-width="1.4">`;
  const zEdge = 200 - G.halfZ * k;
  if (W.strap === 'woodlinks' || metalStrap) {
    const A = W.strap === 'woodlinks' ? (WOODS[W.strapAccent] || WOODS.maple).a : shade(metalHex, -.08), C = W.strap === 'woodlinks' ? (WOODS[W.strapWood] || WOODS.walnut).a : shade(metalHex, .12);
    for (let i = 0; i < 4; i++) { const y1 = zEdge - 22 - i * 30, y2 = 400 - zEdge + 22 + i * 30, w = 124 - i * 5; [y1, y2].forEach(y => { s += `<rect x="${200 - w / 2}" y="${y - 13}" width="${w * .3}" height="26" rx="3" fill="${A}"/><rect x="${200 - w / 2 + w * .31}" y="${y - 13}" width="${w * .38}" height="26" rx="3" fill="${C}"/><rect x="${200 + w / 2 - w * .3}" y="${y - 13}" width="${w * .3}" height="26" rx="3" fill="${A}"/>`; }); }
  } else {
    const sc = W.strapColor; s += `<rect x="142" y="-30" width="116" height="${zEdge + 30}" rx="8" fill="${sc}"/><rect x="142" y="${400 - zEdge}" width="116" height="${zEdge + 30}" rx="6" fill="${sc}"/>`;
    if (W.strap === 'nato') s += `<rect x="194" y="-30" width="12" height="${zEdge + 30}" fill="${W.strapColor2}" stroke="none"/><rect x="194" y="${400 - zEdge}" width="12" height="${zEdge + 30}" fill="${W.strapColor2}" stroke="none"/>`;
    if (W.strap === 'leather') s += `<path d="M150 -30 V${zEdge} M250 -30 V${zEdge} M150 ${400 - zEdge} V430 M250 ${400 - zEdge} V430" stroke="${W.strapColor2}" stroke-dasharray="4 3"/>`;
  }
  if (W.shape !== 'octagon') s += [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => `<rect x="${200 + x * 62 - 11}" y="${200 + z * G.halfZ * k - 20}" width="22" height="40" rx="4" fill="${cHex}"/>`).join('');
  s += `<rect x="${200 + G.halfX * k - 2}" y="190" width="16" height="20" rx="3" fill="${metalHex}"/>`;
  s += caseP ? `<path d="${path(caseP, 1)}" fill="${cHex}"/>` : `<circle cx="200" cy="200" r="${1.06 * k}" fill="${cHex}"/>`;
  if (side === 'front') {
    const dialPath = G.dialRect ? path(shapePts(W.shape, G.dialScale, 64), 1) : null, dr = G.dialR * k;
    if (W.shape === 'octagon') s += `<path d="${path(shapePts('octagon', .97), 1)}" fill="${shade(cHex, .15)}"/>` + Array.from({ length: 8 }, (_, i) => { const a = Math.PI / 8 + i * Math.PI / 4; return `<circle cx="${200 + Math.cos(a) * .95 * k}" cy="${200 - Math.sin(a) * .95 * k}" r="3.5" fill="${shade(cHex, -.3)}"/>`; }).join('');
    else if (!G.dialRect && W.bezelStyle !== 'none') s += W.bezelStyle === 'gmt' ? `<path d="M${200 - .93 * k} 200 A${.93 * k} ${.93 * k} 0 0 1 ${200 + .93 * k} 200Z" fill="${W.bezelColor}"/><path d="M${200 - .93 * k} 200 A${.93 * k} ${.93 * k} 0 0 0 ${200 + .93 * k} 200Z" fill="${W.bezelColor2}"/>` : `<circle cx="200" cy="200" r="${.93 * k}" fill="${/diver|tachy/.test(W.bezelStyle) ? W.bezelColor : shade(cHex, .12)}"/>`;
    const fillD = W.dialStyle === 'skeleton' ? '#4a4d52' : W.dial;
    s += dialPath ? `<path d="${dialPath}" fill="${fillD}"/>` : `<circle cx="200" cy="200" r="${(/diver|gmt|tachy/.test(W.bezelStyle) && W.shape === 'round' ? .73 : G.dialR) * k}" fill="${fillD}"/>`;
    if (W.dialStyle === 'skeleton') s += `<circle cx="200" cy="170" r="22" fill="#c9ccd2" stroke-width=".8"/><circle cx="225" cy="205" r="13" fill="#d8b26a" stroke-width=".8"/><circle cx="178" cy="212" r="11" fill="#d8b26a" stroke-width=".8"/><circle cx="200" cy="${200 + G.dialR * k * .42}" r="14" stroke="#d8b26a" stroke-width="2"/>`;
    if (W.dialStyle === 'openheart') s += `<circle cx="${200 - G.dialR * k * .54}" cy="200" r="${G.dialR * k * .26}" fill="#4a4d52"/><circle cx="${200 - G.dialR * k * .54}" cy="200" r="${G.dialR * k * .14}" stroke="#d8b26a" stroke-width="2"/>`;
    if (/panda/.test(W.dialStyle)) [[1, 0], [-1, 0], [0, 1]].forEach(([x, y]) => s += `<circle cx="${200 + x * .46 * dr * G.fit}" cy="${200 + y * .46 * dr * G.fit}" r="${.2 * dr * G.fit}" fill="${W.dialStyle === 'panda' ? W.index : '#EEF1F9'}" stroke-width=".8"/>`);
    const rr = dr * G.fit;
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; s += `<line x1="${200 + Math.sin(a) * rr * .76}" y1="${200 - Math.cos(a) * rr * .76}" x2="${200 + Math.sin(a) * rr * .92}" y2="${200 - Math.cos(a) * rr * .92}" stroke="${W.index}" stroke-width="${i % 3 ? 2 : 3.4}"/>`; }
    s += `<line x1="200" y1="200" x2="200" y2="${200 - rr * .5}" stroke="${W.index}" stroke-width="4"/><line x1="200" y1="200" x2="${200 + rr * .55}" y2="${200 + rr * .18}" stroke="${W.index}" stroke-width="3"/><line x1="200" y1="${200 + rr * .15}" x2="200" y2="${200 - rr * .8}" stroke="${W.accent}" stroke-width="1.2"/><circle cx="200" cy="200" r="4" fill="${W.index}" stroke="none"/>`;
    if (W.date !== 'none') { const p = W.date === '3' ? [200 + rr * .68, 200] : [200, 200 + rr * .68]; s += `<rect x="${p[0] - 8}" y="${p[1] - 6}" width="16" height="12" fill="#f7f5f0" stroke-width=".8"/>`; }
  } else {
    s += `<circle cx="200" cy="200" r="${.8 * k}" fill="#cfcdc8"/><circle cx="200" cy="200" r="${.72 * k}" stroke-dasharray="2 3"/>`;
    [[150, 150], [250, 150], [150, 250], [250, 250]].forEach(([x, y]) => s += `<circle cx="${x}" cy="${y}" r="4" fill="#9a9893"/>`);
    s += `<text x="200" y="196" text-anchor="middle" font-family="JetBrains Mono" font-size="10" fill="#14172B" stroke="none">N° ${String(W.editionNo).padStart(3, '0')} / ${d.edition || 150}</text><text x="200" y="214" text-anchor="middle" font-family="Archivo" font-size="7.5" letter-spacing="1.5" fill="#14172B" stroke="none">${esc(W.engraving)}</text>`;
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
  // draw in a logical size, store at 2x pixels (sharp dials / inserts up close)
  canvasHi(size, draw) { return this.canvas(size * 2, size * 2, (x) => { x.scale(2, 2); draw(x, size, size); }); },
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
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 16; return (this._c[k] = t);
  },
  carbon() {
    if (this._c.carbon) return this._c.carbon;
    const c = this.canvas(512, 512, (x, w, h) => { x.fillStyle = '#141415'; x.fillRect(0, 0, w, h); for (let i = 0; i < 1400; i++) { const v = 30 + Math.random() * 70 | 0; x.fillStyle = `rgba(${v},${v},${v + 4},.75)`; x.save(); x.translate(Math.random() * w, Math.random() * h); x.rotate(Math.random() * 6.3); x.beginPath(); x.moveTo(0, 0); x.lineTo(6 + Math.random() * 26, Math.random() * 6); x.lineTo(Math.random() * 18, 4 + Math.random() * 14); x.fill(); x.restore(); } });
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2); return (this._c.carbon = t);
  },
  // Woven fabric surfaces (bump height maps): twill diagonals, denim slub, corduroy wales, duck canvas, ripstop grid, nylon, linen
  weave(kind) {
    const k = 'weave:' + kind; if (this._c[k]) return this._c[k];
    const S = 256, c = this.canvas(S, S, (x) => {
      const im = x.createImageData(S, S), p = im.data, col = Array.from({ length: S }, () => Math.random()), row = Array.from({ length: S }, () => Math.random());
      for (let y = 0; y < S; y++) for (let i = 0; i < S; i++) {
        const n = Math.random() * 16 - 8; let v = 128;
        if (kind === 'twill') v = 128 + 70 * Math.sin(((i + y) % 6) / 6 * Math.PI * 2) + n;
        else if (kind === 'denim') v = 128 + 80 * Math.sin(((i + y * 1.0) % 8) / 8 * Math.PI * 2) * (.75 + col[i] * .25) + (row[y] - .5) * 40 + n;
        else if (kind === 'cord') { const w = (i % 32) / 32; v = 40 + 200 * Math.pow(Math.sin(w * Math.PI), .6) + n * 1.5; }
        else if (kind === 'canvas') v = 128 + 70 * ((((i >> 2) + (y >> 2)) & 1) ? 1 : -1) * Math.sin((i % 4) / 4 * Math.PI) + n;
        else if (kind === 'ripstop') v = 128 + 35 * ((((i >> 1) + (y >> 1)) & 1) ? 1 : -1) + ((i % 48 < 3 || y % 48 < 3) ? 90 : 0) + n;
        else if (kind === 'nylon') v = 128 + n * .5 + 10 * Math.sin(y / 2);
        else if (kind === 'linen') v = 128 + 50 * ((((i >> 1) + (y >> 1)) & 1) ? 1 : -1) * .6 + (col[i] - .5) * 90 + (row[y] - .5) * 70 + n;
        const o = (y * S + i) * 4; p[o] = p[o + 1] = p[o + 2] = clamp(v, 0, 255); p[o + 3] = 255;
      }
      x.putImageData(im, 0, 0);
    });
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 16; return (this._c[k] = t);
  },
  // Yarn-colour variation (multiplies the base colour): denim slub/fading, linen irregular slubs
  weaveTint(kind) {
    const k = 'tint:' + kind; if (this._c[k]) return this._c[k];
    const S = 512, c = this.canvas(S, S, (x) => {
      x.fillStyle = '#fff'; x.fillRect(0, 0, S, S);
      for (let i = 0; i < (kind === 'denim' ? 900 : 500); i++) { const g = 200 + Math.random() * 55 | 0; x.fillStyle = `rgba(${g},${g},${g},${kind === 'denim' ? .55 : .4})`; x.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 2, 6 + Math.random() * (kind === 'denim' ? 60 : 30)); }
      if (kind === 'denim') { x.globalAlpha = .18; for (let i = 0; i < 160; i++) { x.fillStyle = '#ffffff'; x.fillRect(Math.random() * S, Math.random() * S, 1, 20 + Math.random() * 80); } }
    });
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 16; return (this._c[k] = t);
  },
  // Woven / printed fabric patterns: plaid (tartan sett), gingham, pinstripe
  pattern(kind, c1, c2, c3, scale = 1, small = false) {
    const k = ['pat', kind, c1, c2, c3, scale, small].join(':'); if (this._c[k]) return this._c[k];
    const cv = this.canvas(512, 512, (x, w, h) => {
      x.fillStyle = c1; x.fillRect(0, 0, w, h);
      if (kind === 'plaid') {
        const sett = [[c1, 70], [c2, 14], [c1, 26], [c3, 8], [c1, 26], [c2, 14], [c1, 70], [shade(c1, -.35), 40], [c3, 4], [shade(c1, -.35), 40]];
        const tot = sett.reduce((s, [, n]) => s + n, 0), sc = w / tot;
        let o = 0; for (const [col, n] of sett) { x.fillStyle = col; x.fillRect(o * sc, 0, n * sc, h); o += n; }      // warp
        o = 0; x.globalAlpha = .55; for (const [col, n] of sett) { x.fillStyle = col; x.fillRect(0, o * sc, w, n * sc); o += n; } // weft
        x.globalAlpha = .1; x.strokeStyle = '#000'; x.lineWidth = 1; for (let i = -h; i < w; i += 4) { x.beginPath(); x.moveTo(i, h); x.lineTo(i + h, 0); x.stroke(); } // 2/2 twill
      } else if (kind === 'gingham') {
        const n = 8, s = w / n; x.globalAlpha = .5; x.fillStyle = c2; for (let i = 0; i < n; i += 2) { x.fillRect(i * s, 0, s, h); x.fillRect(0, i * s, w, s); }
      } else if (kind === 'pinstripe') { x.fillStyle = c3; for (let i = 0; i < w; i += 32) x.fillRect(i, 0, 2.5, h); }
      x.globalAlpha = 1;
    });
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 16;
    const r = small ? 1 / scale : 3 / scale; t.repeat.set(r, r); return (this._c[k] = t);
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
    const tm = new THREE.CanvasTexture(map); tm.colorSpace = THREE.SRGBColorSpace; tm.anisotropy = 16;
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
   9b. Watch system — cases, materials, dials, bezels, hands, straps, presets
   ========================================================================= */
const CASE_MATS = {
  wood: { label: 'Wood', kind: 'wood', c: '#6a4329' },
  steel: { label: '316L steel · brushed', kind: 'metal', c: '#c4c3bf', r: .4 },
  polished: { label: '316L steel · polished', kind: 'metal', c: '#dad9d5', r: .1 },
  titanium: { label: 'Grade 5 titanium', kind: 'metal', c: '#8f9094', r: .42 },
  dlc: { label: 'Black DLC steel', kind: 'metal', c: '#252527', r: .36 },
  gold: { label: 'Yellow gold PVD', kind: 'metal', c: '#d8b26a', r: .2 },
  rose: { label: 'Rose gold PVD', kind: 'metal', c: '#d29a80', r: .2 },
  bronze: { label: 'CuSn8 bronze', kind: 'metal', c: '#a8743f', r: .46 },
  ceramicB: { label: 'Black ceramic', kind: 'ceramic', c: '#121214', r: .16 },
  ceramicW: { label: 'White ceramic', kind: 'ceramic', c: '#ecebe8', r: .18 },
  carbon: { label: 'Forged carbon', kind: 'carbon', c: '#1c1c1d' },
};
const CASE_SHAPES = { round: 'Round', cushion: 'Cushion', octagon: 'Octagon', tonneau: 'Tonneau', rect: 'Rectangle' };
const WATCH_GEOM = {
  round: { halfX: 1.05, halfZ: 1.02, dialR: .76, fit: 1 },
  cushion: { halfX: 1.1, halfZ: 1.06, dialR: .76, fit: 1 },
  octagon: { halfX: 1.1, halfZ: 1.1, dialR: .74, fit: 1 },
  tonneau: { halfX: .95, halfZ: 1.28, dialR: 1, dialRect: true, dialScale: .8, fit: .68 },
  rect: { halfX: .93, halfZ: 1.2, dialR: .95, dialRect: true, dialScale: .82, fit: .72 },
};
const BEZEL_STYLES = { smooth: 'Smooth', fluted: 'Fluted', diver: 'Diver 60-min insert', gmt: 'GMT 24-hr two-tone', tachy: 'Tachymeter', gem: 'Gem-set (iced)', none: 'Bezel-less' };
const DIAL_STYLES = {
  classic: { label: 'Classic matte', rough: .55, metal: .1 }, sunburst: { label: 'Sunburst', rough: .3, metal: .2 },
  guilloche: { label: 'Guilloché · tapisserie', rough: .38, metal: .15 }, linen: { label: 'Linen', rough: .62, metal: .05 },
  enamel: { label: 'Enamel look', rough: .1, metal: 0 }, fume: { label: 'Fumé gradient', rough: .3, metal: .2 },
  tropical: { label: 'Tropical (aged)', rough: .6, metal: .05 }, sector: { label: 'Sector', rough: .5, metal: .1 },
  panda: { label: 'Panda chrono', rough: .5, metal: .1 }, rpanda: { label: 'Reverse panda chrono', rough: .5, metal: .1 },
  skeleton: { label: 'Skeleton', rough: .38, metal: .3 }, openheart: { label: 'Open-heart', rough: .35, metal: .2 },
};
const NUMERALS = { index: 'Baton indices', arabic: 'Arabic', roman: 'Roman', california: 'California', none: 'None · minimal' };
const HANDS = { baton: 'Baton', dauphine: 'Dauphine', sword: 'Sword', mercedes: 'Mercedes', pencil: 'Pencil' };
const STRAPS = { woodlinks: 'Wood links · 3-piece', oyster: 'Oyster-style 3-link', jubilee: 'Jubilee-style 5-link', integrated: 'Integrated H-link', mesh: 'Milanese mesh', leather: 'Leather', rubber: 'FKM rubber', nato: 'NATO nylon' };
const WATCH_DEFAULT = { dia: 42, shape: 'round', caseMat: 'wood', caseWood: 'walnut', bezel: 'steel', bezelStyle: 'smooth', bezelColor: '#14172B', bezelColor2: '#B98A4A', dialStyle: 'classic', dial: '#EEF1F9', index: '#14172B', accent: '#B98A4A', numerals: 'index', hands: 'baton', date: 'none', strap: 'woodlinks', strapWood: 'walnut', strapAccent: 'maple', strapColor: '#2b1d14', strapColor2: '#B98A4A', crownGuards: '', movement: MOVEMENTS[0], crystal: 'Sapphire', editionNo: 1, engraving: "TERANGA · DON'T POSTPONE PASSION", wr: '3 ATM' };
const watchSpec = d => ({ ...WATCH_DEFAULT, ...d.watch });
const WATCH_PRESETS = [
  ['The Teranga · wood', { shape: 'round', caseMat: 'wood', caseWood: 'walnut', bezel: 'steel', bezelStyle: 'smooth', dialStyle: 'classic', dial: '#EEF1F9', index: '#14172B', accent: '#B98A4A', numerals: 'index', hands: 'baton', date: 'none', strap: 'woodlinks', strapWood: 'walnut', strapAccent: 'maple', crownGuards: '', movement: 'Miyota 2035 · quartz', wr: '3 ATM' }],
  ['Skeleton automatic', { shape: 'round', caseMat: 'steel', bezelStyle: 'smooth', dialStyle: 'skeleton', dial: '#14172B', index: '#EEF1F9', accent: '#B98A4A', numerals: 'roman', hands: 'sword', date: 'none', strap: 'leather', strapColor: '#151515', strapColor2: '#B98A4A', crownGuards: '', movement: 'Seiko NH38 · skeleton automatic', wr: '5 ATM' }],
  ['Open-heart dress', { shape: 'round', caseMat: 'rose', bezelStyle: 'smooth', dialStyle: 'openheart', dial: '#EFE6D6', index: '#3a2a20', accent: '#9c3a2a', numerals: 'roman', hands: 'dauphine', date: 'none', strap: 'leather', strapColor: '#4a2a1a', strapColor2: '#d9c3a0', crownGuards: '', movement: 'Miyota 82S7 · open-heart automatic', wr: '3 ATM' }],
  ['Dive · black', { shape: 'round', caseMat: 'steel', bezelStyle: 'diver', bezelColor: '#111214', dialStyle: 'sunburst', dial: '#111214', index: '#EEF1F9', accent: '#d2452b', numerals: 'index', hands: 'mercedes', date: '3', strap: 'oyster', crownGuards: '1', movement: 'Seiko NH35A · automatic', wr: '20 ATM' }],
  ['GMT · two-tone', { shape: 'round', caseMat: 'steel', bezelStyle: 'gmt', bezelColor: '#9b1b2a', bezelColor2: '#1d3a7a', dialStyle: 'classic', dial: '#0f1012', index: '#EEF1F9', accent: '#d2452b', numerals: 'index', hands: 'mercedes', date: '3', strap: 'jubilee', crownGuards: '1', movement: 'Seiko NH34 · GMT automatic', wr: '10 ATM' }],
  ['Octagonal sport', { shape: 'octagon', caseMat: 'steel', bezelStyle: 'smooth', dialStyle: 'guilloche', dial: '#1f3556', index: '#EEF1F9', accent: '#EEF1F9', numerals: 'index', hands: 'baton', date: '3', strap: 'integrated', crownGuards: '', movement: 'Sellita SW200 · automatic', wr: '5 ATM' }],
  ['Panda chronograph', { shape: 'round', caseMat: 'steel', bezelStyle: 'tachy', bezelColor: '#111214', dialStyle: 'panda', dial: '#EEF1F9', index: '#111214', accent: '#d2452b', numerals: 'index', hands: 'baton', date: 'none', strap: 'leather', strapColor: '#1a1a1a', strapColor2: '#EEF1F9', crownGuards: '', movement: 'Seiko VK63 · meca-quartz chrono', wr: '10 ATM' }],
  ['Sector field', { shape: 'round', caseMat: 'titanium', bezelStyle: 'smooth', dialStyle: 'sector', dial: '#d9d3c3', index: '#14172B', accent: '#2b4ba8', numerals: 'arabic', hands: 'sword', date: 'none', strap: 'nato', strapColor: '#3b4a3a', strapColor2: '#14172B', crownGuards: '', movement: 'Miyota 2035 · quartz', wr: '10 ATM' }],
  ['Rectangular dress', { shape: 'rect', caseMat: 'gold', bezelStyle: 'smooth', dialStyle: 'classic', dial: '#f3efe6', index: '#14172B', accent: '#14172B', numerals: 'roman', hands: 'sword', date: 'none', strap: 'leather', strapColor: '#141414', strapColor2: '#141414', crownGuards: '', movement: 'Miyota 2035 · quartz', wr: '3 ATM' }],
  ['Iced · gold', { shape: 'round', caseMat: 'gold', bezelStyle: 'gem', dialStyle: 'sunburst', dial: '#d8b26a', index: '#14172B', accent: '#14172B', numerals: 'index', hands: 'dauphine', date: '3', strap: 'jubilee', crownGuards: '', movement: 'Seiko NH35A · automatic', wr: '5 ATM' }],
  ['Fumé minimal', { shape: 'round', caseMat: 'dlc', bezelStyle: 'smooth', dialStyle: 'fume', dial: '#2b4ba8', index: '#EEF1F9', accent: '#B98A4A', numerals: 'none', hands: 'pencil', date: 'none', strap: 'mesh', crownGuards: '', movement: 'Miyota 8215 · automatic', wr: '5 ATM' }],
  ['Tropical cushion', { shape: 'cushion', caseMat: 'bronze', bezelStyle: 'smooth', dialStyle: 'tropical', dial: '#4a3322', index: '#efe3c8', accent: '#efe3c8', numerals: 'arabic', hands: 'sword', date: 'none', strap: 'rubber', strapColor: '#2a2018', crownGuards: '1', movement: 'Seiko NH35A · automatic', wr: '20 ATM' }],
  ['Forged carbon skeleton', { shape: 'round', caseMat: 'carbon', bezelStyle: 'smooth', dialStyle: 'skeleton', dial: '#0f0f10', index: '#B98A4A', accent: '#B98A4A', numerals: 'index', hands: 'sword', date: 'none', strap: 'rubber', strapColor: '#0f0f10', crownGuards: '', movement: 'Seiko NH38 · skeleton automatic', wr: '10 ATM' }],
  ['Tonneau ceramic', { shape: 'tonneau', caseMat: 'ceramicB', bezelStyle: 'smooth', dialStyle: 'skeleton', dial: '#111111', index: '#EEF1F9', accent: '#d2452b', numerals: 'arabic', hands: 'baton', date: 'none', strap: 'rubber', strapColor: '#111111', crownGuards: '', movement: 'Seiko NH38 · skeleton automatic', wr: '5 ATM' }],
];
function shapePts(shape, s = 1, n = 160) {
  if (shape === 'octagon') return Array.from({ length: 8 }, (_, i) => { const a = Math.PI / 8 + i * Math.PI / 4; return new THREE.Vector2(Math.cos(a) * 1.12 * s, Math.sin(a) * 1.12 * s); });
  const [ax, ay, p] = { cushion: [1.04, 1.04, 4.2], tonneau: [.86, 1.22, 3.2], rect: [.86, 1.14, 9] }[shape] || [1, 1, 2], out = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
    let x = Math.sign(c) * Math.abs(c) ** (2 / p) * ax; const y = Math.sign(sn) * Math.abs(sn) ** (2 / p) * ay;
    if (shape === 'tonneau') x *= 1 - .14 * (y / ay) ** 2;
    const v = new THREE.Vector2(x * s, y * s);
    if (!out.length || out[out.length - 1].distanceTo(v) > .006 * s) out.push(v); // drop near-duplicates (bevel NaNs at tight corners)
  }
  if (out.length > 2 && out[0].distanceTo(out[out.length - 1]) < .006 * s) out.pop();
  return out;
}
// Curved watch lug: side profile swept outward and down from the case, extruded to lug width
// Fluted (coin-edge) bezel: radial ridges as a bump map along the lathe's U direction
function flutedMat(base) { const t = new THREE.CanvasTexture(TEX.canvas(64, 8, (x) => { for (let i = 0; i < 64; i++) { const v = 128 + 127 * Math.sin(i / 64 * Math.PI * 2); x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(i, 0, 1, 8); } })); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(90, 1); t.userData.own = true; const m = base.clone(); m.bumpMap = t; m.bumpScale = 4; return m; }
// Product-photography environment: dark room + softbox panels → long crisp highlights on polished metal and sapphire
function softboxScene() {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.BoxGeometry(30, 30, 30), new THREE.MeshBasicMaterial({ color: '#3a3a40', side: THREE.BackSide })));
  const panel = (w, h, pos, i) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(i, i, i * .97), side: THREE.DoubleSide })); m.position.set(...pos); m.lookAt(0, 0, 0); s.add(m); };
  panel(16, 7, [0, 10, 1], 3); panel(2.2, 12, [-7, 2, 3], 4); panel(2.2, 12, [7, 3, -2], 2.6); panel(10, 4, [0, 1.5, 10], 1.4); panel(10, 5, [0, 3, -10], 1.1); panel(8, 4, [0, -8, 0], .5);
  return s;
}
let _lug = null;
function lugGeo() {
  if (_lug) return _lug;
  const s = new THREE.Shape(); s.moveTo(0, .13); s.bezierCurveTo(.2, .13, .38, .06, .5, -.1); s.bezierCurveTo(.53, -.15, .51, -.21, .45, -.21); s.bezierCurveTo(.34, -.17, .18, -.16, 0, -.22); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: .15, bevelEnabled: true, bevelThickness: .025, bevelSize: .022, bevelSegments: 6, curveSegments: 40 });
  g.rotateY(-Math.PI / 2); g.translate(.075, 0, 0); g.computeVertexNormals(); return (_lug = g);
}
const circlePts = (r, n) => Array.from({ length: n }, (_, i) => new THREE.Vector2(Math.cos(-i / n * Math.PI * 2) * r, Math.sin(-i / n * Math.PI * 2) * r));
const caseHex = W => W.caseMat === 'wood' ? (WOODS[W.caseWood] || WOODS.walnut).a : (CASE_MATS[W.caseMat] || CASE_MATS.steel).c;
function watchMat(key, species, bz) {
  if (key === '_bz') return new THREE.MeshPhysicalMaterial({ color: bz.c, metalness: 1, roughness: bz.r });
  const m = CASE_MATS[key] || CASE_MATS.steel;
  if (key === 'wood' || m.kind === 'wood') return new THREE.MeshPhysicalMaterial({ map: TEX.wood(species || 'walnut'), roughness: .5, clearcoat: .55, clearcoatRoughness: .35 });
  if (m.kind === 'ceramic') return new THREE.MeshPhysicalMaterial({ color: m.c, metalness: 0, roughness: m.r, clearcoat: 1, clearcoatRoughness: .06 });
  if (m.kind === 'carbon') return new THREE.MeshPhysicalMaterial({ map: TEX.carbon(), roughness: .4, metalness: .15, clearcoat: 1, clearcoatRoughness: .08 });
  return new THREE.MeshPhysicalMaterial({ color: m.c, metalness: 1, roughness: m.r, clearcoat: m.r < .2 ? .3 : 0 });
}
function strapMat(type, c1, c2) {
  // UV: x = around the strap (x .5 = top face, .25/.75 = edges), y = along the strap (y = t·H, buckle at .5)
  const k = ['strap2', type, c1, c2].join(':');
  if (!TEX._c[k]) {
    const tile = type === 'nato';
    const cv = TEX.canvas(256, tile ? 512 : 2048, (x, w, h) => {
      x.fillStyle = c1; x.fillRect(0, 0, w, h);
      const im = x.getImageData(0, 0, w, h), p = im.data, amp = type === 'leather' ? 16 : 5;
      for (let i = 0; i < p.length; i += 4) { const v = (Math.random() - .5) * amp + (type === 'leather' && Math.random() < .02 ? -14 : 0); p[i] += v; p[i + 1] += v; p[i + 2] += v; }
      x.putImageData(im, 0, 0);
      if (type === 'leather' || type === 'rubber') {
        x.fillStyle = type === 'leather' ? shade(c1, -.45) : shade(c1, -.25); [.25, .75].forEach(u => x.fillRect(u * w - 7, 0, 14, h)); // painted / moulded edges
        if (type === 'leather') { x.strokeStyle = c2; x.lineWidth = 3.2; x.lineCap = 'round'; x.setLineDash([9, 7]); [.36, .64].forEach(u => { x.beginPath(); x.moveTo(u * w, 0); x.lineTo(u * w, h); x.stroke(); }); x.setLineDash([]); }
        if (type === 'rubber') { x.fillStyle = shade(c1, -.3); for (let y = 0; y < h; y += 26) x.fillRect(w * .34, y, w * .32, 5); }
        for (let i = 0; i < 6; i++) { const y = (.53 + i * .022) * h; x.fillStyle = 'rgba(0,0,0,.85)'; x.beginPath(); x.ellipse(w * .5, y, 9, 7, 0, 0, Math.PI * 2); x.fill(); x.strokeStyle = shade(c1, .25); x.lineWidth = 1.5; x.stroke(); }
      }
      if (type === 'nato') { x.fillStyle = c2; [[.46, .54], [.3, .34], [.66, .7]].forEach(([a, b]) => x.fillRect(a * w, 0, (b - a) * w, h)); for (let y = 0; y < h; y += 4) { x.fillStyle = 'rgba(0,0,0,.14)'; x.fillRect(0, y, w, 1.6); } for (let xx = 0; xx < w; xx += 3) { x.fillStyle = 'rgba(255,255,255,.05)'; x.fillRect(xx, 0, 1, h); } }
    });
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, tile ? 14 : 1); TEX._c[k] = t;
  }
  return new THREE.MeshPhysicalMaterial({ map: TEX._c[k], bumpMap: TEX._c[k], bumpScale: type === 'nato' ? .5 : .8, side: THREE.DoubleSide, roughness: type === 'rubber' ? .78 : type === 'nato' ? .92 : .5, sheen: type === 'nato' ? .7 : .25, sheenColor: new THREE.Color(c1).lerp(new THREE.Color('#fff'), .4), clearcoat: type === 'leather' ? .3 : type === 'rubber' ? .1 : 0, clearcoatRoughness: .5 });
}
function meshMat(metal) {
  if (!TEX._c.mesh) { const cv = TEX.canvas(128, 128, (x, w, h) => { x.fillStyle = '#808080'; x.fillRect(0, 0, w, h); x.strokeStyle = '#fff'; x.lineWidth = 2; for (let i = -h; i < w * 2; i += 8) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i - h, h); x.stroke(); } x.strokeStyle = '#000'; for (let i = -h; i < w * 2; i += 8) { x.beginPath(); x.moveTo(i + 4, 0); x.lineTo(i + 4 - h, h); x.stroke(); } }); const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 90); TEX._c.mesh = t; }
  const m = metal.clone(); m.bumpMap = TEX._c.mesh; m.bumpScale = 3; m.roughness = Math.max(.25, m.roughness); return m;
}
function handGeo(style, L, w) {
  const t = .1, shapes = [], s = new THREE.Shape();
  if (style === 'dauphine') { s.moveTo(0, -t); s.lineTo(w * .65, L * .2); s.lineTo(0, L); s.lineTo(-w * .65, L * .2); }
  else if (style === 'sword') { s.moveTo(-w * .4, -t); s.lineTo(-w * .55, L * .76); s.lineTo(0, L); s.lineTo(w * .55, L * .76); s.lineTo(w * .4, -t); }
  else if (style === 'pencil') { s.moveTo(-w * .3, -t); s.lineTo(-w * .3, L * .9); s.lineTo(0, L); s.lineTo(w * .3, L * .9); s.lineTo(w * .3, -t); }
  else if (style === 'mercedes') {
    s.moveTo(-w / 2, -t); s.lineTo(-w / 2, L * .62); s.lineTo(w / 2, L * .62); s.lineTo(w / 2, -t);
    const ring = new THREE.Shape(); ring.absarc(0, L * .74, w * 1.25, 0, Math.PI * 2, false); const hole = new THREE.Path(); hole.absarc(0, L * .74, w * .8, 0, Math.PI * 2, true); ring.holes.push(hole); shapes.push(ring);
    const tip = new THREE.Shape(); tip.moveTo(-w * .4, L * .86); tip.lineTo(0, L); tip.lineTo(w * .4, L * .86); shapes.push(tip);
  }
  else { s.moveTo(-w / 2, -t); s.lineTo(-w / 2, L); s.lineTo(w / 2, L); s.lineTo(w / 2, -t); }
  shapes.push(s);
  const g = new THREE.ExtrudeGeometry(shapes, { depth: .012, bevelEnabled: false, curveSegments: 24 }); g.rotateX(-Math.PI / 2); return g;
}
// Dial artwork. `fit` shrinks the layout for rectangular/tonneau dials.
function dialCanvas(d, W, fit = 1) {
  return TEX.canvasHi(1024, (x, w) => {
    const c = w / 2, R = c * fit, st = W.dialStyle, dial = W.dial, ink = W.index, skel = st === 'skeleton', heart = st === 'openheart';
    const chrono = st === 'panda' || st === 'rpanda';
    x.clearRect(0, 0, w, w);
    if (!skel) { x.fillStyle = dial; x.fillRect(0, 0, w, w); }
    const over = (fn) => { x.save(); fn(); x.restore(); };
    if (st === 'classic' || st === 'enamel' || chrono) over(() => { const g = x.createRadialGradient(c, c * .7, 40, c, c, c); g.addColorStop(0, `rgba(255,255,255,${st === 'enamel' ? .14 : .07})`); g.addColorStop(1, 'rgba(0,0,0,.16)'); x.fillStyle = g; x.fillRect(0, 0, w, w); });
    if (st === 'sunburst' || st === 'fume') over(() => {
      if (st === 'fume') { const g = x.createRadialGradient(c, c, 30, c, c, c * 1.05); g.addColorStop(0, shade(dial, .28)); g.addColorStop(.55, dial); g.addColorStop(1, shade(dial, -.82)); x.fillStyle = g; x.fillRect(0, 0, w, w); }
      const g2 = x.createConicGradient(0, c, c); for (let i = 0; i <= 8; i++) g2.addColorStop(i / 8, i % 2 ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.16)'); x.fillStyle = g2; x.fillRect(0, 0, w, w);
      x.strokeStyle = 'rgba(255,255,255,.035)'; x.lineWidth = 1; for (let i = 0; i < 720; i++) { const a = i / 720 * Math.PI * 2; x.beginPath(); x.moveTo(c, c); x.lineTo(c + Math.cos(a) * c * 1.5, c + Math.sin(a) * c * 1.5); x.stroke(); }
    });
    if (st === 'guilloche') over(() => { const s = 26; for (let yy = 0; yy < w; yy += s) for (let xx = 0; xx < w; xx += s) { x.fillStyle = 'rgba(255,255,255,.13)'; x.beginPath(); x.moveTo(xx, yy); x.lineTo(xx + s, yy); x.lineTo(xx + s / 2, yy + s / 2); x.fill(); x.fillStyle = 'rgba(0,0,0,.2)'; x.beginPath(); x.moveTo(xx, yy + s); x.lineTo(xx + s, yy + s); x.lineTo(xx + s / 2, yy + s / 2); x.fill(); } });
    if (st === 'linen') over(() => { for (let i = 0; i < w; i += 3) { x.fillStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '0,0,0'},.05)`; x.fillRect(i, 0, 1.5, w); x.fillRect(0, i, w, 1.5); } });
    if (st === 'tropical') over(() => { const f = TEX.clouds(128, 128), sm = TEX.canvas(128, 128, (y) => { const im = y.createImageData(128, 128); for (let i = 0; i < f.length; i++) { im.data[i * 4] = 140; im.data[i * 4 + 1] = 92; im.data[i * 4 + 2] = 48; im.data[i * 4 + 3] = f[i] * 120; } y.putImageData(im, 0, 0); }); x.imageSmoothingQuality = 'high'; x.drawImage(sm, 0, 0, w, w); });
    if (st === 'sector') over(() => { x.fillStyle = shade(dial, -.12); x.beginPath(); x.arc(c, c, R * .78, 0, Math.PI * 2); x.arc(c, c, R * .5, 0, Math.PI * 2, true); x.fill(); x.strokeStyle = ink; x.globalAlpha = .55; x.lineWidth = 2; [.5, .78].forEach(k => { x.beginPath(); x.arc(c, c, R * k, 0, Math.PI * 2); x.stroke(); }); x.beginPath(); x.moveTo(c - R * .78, c); x.lineTo(c + R * .78, c); x.moveTo(c, c - R * .78); x.lineTo(c, c + R * .78); x.stroke(); });
    if (skel) over(() => { x.fillStyle = dial; x.beginPath(); x.arc(c, c, c, 0, Math.PI * 2); x.arc(c, c, R * .76, 0, Math.PI * 2, true); x.fill(); x.strokeStyle = dial; x.lineWidth = 26; x.beginPath(); x.arc(c, c, R * .2, 0, Math.PI * 2); x.stroke(); });
    const hole = heart ? { x: c - R * .54, y: c, r: R * .26 } : null;
    if (hole) over(() => { x.globalCompositeOperation = 'destination-out'; x.beginPath(); x.arc(hole.x, hole.y, hole.r, 0, Math.PI * 2); x.fill(); x.globalCompositeOperation = 'source-over'; x.strokeStyle = ink; x.lineWidth = 8; x.beginPath(); x.arc(hole.x, hole.y, hole.r + 4, 0, Math.PI * 2); x.stroke(); });
    const sub = chrono ? [[R * .46, 0], [-R * .46, 0], [0, R * .46]] : [];
    sub.forEach(([dx, dy]) => over(() => { const sc = st === 'panda' ? ink : '#EEF1F9', sx = c + dx, sy = c + dy, r = R * .2; x.fillStyle = sc; x.beginPath(); x.arc(sx, sy, r, 0, Math.PI * 2); x.fill(); x.strokeStyle = st === 'panda' ? dial : ink; x.lineWidth = 3; for (let i = 0; i < 30; i++) { const a = i / 30 * Math.PI * 2, r1 = i % 5 ? r * .82 : r * .7; x.beginPath(); x.moveTo(sx + Math.sin(a) * r1, sy - Math.cos(a) * r1); x.lineTo(sx + Math.sin(a) * r * .94, sy - Math.cos(a) * r * .94); x.stroke(); } x.lineWidth = 5; x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + r * .5, sy - r * .55); x.stroke(); }));
    const blocked = new Set([...(W.date === '3' || chrono ? [3] : []), ...(W.date === '6' || chrono ? [6] : []), ...(chrono ? [9] : []), ...(heart ? [9] : [])]);
    x.strokeStyle = ink; x.fillStyle = ink;
    if (W.numerals !== 'none') for (let i = 0; i < 60; i++) { // minute track
      if (i % 5 === 0) continue; const a = i / 60 * Math.PI * 2; x.lineWidth = 3; x.beginPath(); x.moveTo(c + Math.sin(a) * R * .89, c - Math.cos(a) * R * .89); x.lineTo(c + Math.sin(a) * R * .94, c - Math.cos(a) * R * .94); x.stroke();
    }
    const ROM = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    for (let hNum = 0; hNum < 12; hNum++) {
      const pos = hNum || 12, a = hNum / 12 * Math.PI * 2; if (blocked.has(pos)) continue;
      const nx = c + Math.sin(a) * R * .72, ny = c - Math.cos(a) * R * .72;
      let kind = W.numerals; if (kind === 'california') kind = (pos >= 4 && pos <= 8) ? 'arabic' : (pos === 3 || pos === 9) ? 'index' : 'roman';
      if (kind === 'none') { if (pos % 3 === 0) { x.beginPath(); x.arc(c + Math.sin(a) * R * .88, c - Math.cos(a) * R * .88, 9, 0, Math.PI * 2); x.fill(); } continue; }
      if (kind === 'index') { x.lineWidth = pos === 12 ? 22 : 14; const r1 = R * (pos === 12 ? .72 : .75); x.beginPath(); x.moveTo(c + Math.sin(a) * r1, c - Math.cos(a) * r1); x.lineTo(c + Math.sin(a) * R * .93, c - Math.cos(a) * R * .93); x.stroke(); continue; }
      x.save(); x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = kind === 'roman' ? `400 ${Math.round(84 * fit)}px "Instrument Serif"` : `400 ${Math.round(68 * fit)}px "Archivo Black"`; x.letterSpacing = '0px';
      x.fillText(kind === 'roman' ? ROM[hNum] : String(pos), nx, ny); x.restore();
    }
    if (W.date === '3' || W.date === '6') over(() => { const p = W.date === '3' ? [c + R * .68, c] : [c, c + R * .68]; x.fillStyle = '#f7f5f0'; x.strokeStyle = ink; x.lineWidth = 4; x.fillRect(p[0] - 42, p[1] - 30, 84, 60); x.strokeRect(p[0] - 42, p[1] - 30, 84, 60); x.fillStyle = '#111'; x.font = '600 40px "JetBrains Mono"'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(new Date().getDate()), p[0], p[1] + 2); });
    if (!skel) {
      Mark.draw(x, c, c - R * .42, 150 * fit, 128 * fit, ink);
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = `500 ${Math.round(24 * fit)}px "JetBrains Mono"`; x.letterSpacing = '6px';
      const mv = String(W.movement).toUpperCase(), label = mv.includes('GMT') ? 'GMT AUTOMATIC' : mv.includes('CHRONO') ? 'CHRONOGRAPH' : mv.includes('AUTO') ? 'AUTOMATIC' : 'QUARTZ';
      if (!chrono) x.fillText(label, c, c + R * .27);
      x.font = `600 ${Math.round(30 * fit)}px "JetBrains Mono"`; x.letterSpacing = '4px';
      x.fillText(`N° ${String(W.editionNo).padStart(3, '0')}/${d.edition || 150}`, c, chrono ? c + R * .2 : c + R * .4);
    } else { x.textAlign = 'center'; x.font = '600 22px "JetBrains Mono"'; x.letterSpacing = '3px'; x.fillStyle = ink; x.fillText(`N° ${String(W.editionNo).padStart(3, '0')}/${d.edition || 150}`, c, c + R * .84); }
  });
}
// Bezel insert ring (planar UVs: outer radius = canvas edge)
function insertCanvas(W) {
  return TEX.canvasHi(1024, (x, w) => {
    const c = w / 2, rIn = c * .825 / .945, rMid = (c + rIn) / 2, ink = lum(W.bezelColor) > .5 ? '#111' : '#EEF1F9';
    const ring = (a0, a1, col) => { x.fillStyle = col; x.beginPath(); x.arc(c, c, c, a0, a1); x.arc(c, c, rIn, a1, a0, true); x.closePath(); x.fill(); };
    if (W.bezelStyle === 'gmt') { ring(Math.PI, Math.PI * 2, W.bezelColor); ring(0, Math.PI, W.bezelColor2); } else ring(0, Math.PI * 2, W.bezelColor);
    x.fillStyle = ink; x.strokeStyle = ink; x.textAlign = 'center'; x.textBaseline = 'middle';
    const label = (txt, a, size, font = 'Archivo Black') => { x.save(); x.translate(c, c); x.rotate(a); x.font = `400 ${size}px "${font}"`; x.fillText(txt, 0, -rMid); x.restore(); };
    const tri = () => { x.save(); x.translate(c, c); x.beginPath(); x.moveTo(0, -rIn - 8); x.lineTo(-26, -c + 14); x.lineTo(26, -c + 14); x.closePath(); x.fill(); x.restore(); };
    if (W.bezelStyle === 'diver') { tri(); [10, 20, 30, 40, 50].forEach(n => label(String(n), n / 60 * Math.PI * 2, 44)); for (let i = 1; i < 60; i++) { if (i % 10 === 0) continue; const a = i / 60 * Math.PI * 2; x.save(); x.translate(c, c); x.rotate(a); x.fillRect(-3, -c + 14, 6, i <= 15 ? 26 : i % 5 ? 0 : 30); x.restore(); } }
    if (W.bezelStyle === 'gmt') { tri(); for (let n = 2; n < 24; n += 2) label(String(n), n / 24 * Math.PI * 2, 40); for (let n = 1; n < 24; n += 2) { x.save(); x.translate(c, c); x.rotate(n / 24 * Math.PI * 2); x.beginPath(); x.arc(0, -rMid, 6, 0, Math.PI * 2); x.fill(); x.restore(); } }
    if (W.bezelStyle === 'tachy') { label('TACHYMETRE', 0, 26, 'JetBrains Mono'); [60, 70, 80, 90, 100, 120, 150, 200, 250, 300, 400, 500].forEach(n => { const a = (3600 / n) / 60 * Math.PI * 2; if (n !== 60) label(String(n), a, 30, 'JetBrains Mono'); x.save(); x.translate(c, c); x.rotate(a); x.fillRect(-2, -c + 8, 4, 18); x.restore(); }); }
  });
}
// Visible movement for skeleton / open-heart
function movementCanvas(W) {
  return TEX.canvasHi(1024, (x, w) => {
    const c = w / 2, gold = /gold|rose|bronze/.test(W.caseMat), base = gold ? '#9c8452' : '#4a4d52', bridge = gold ? '#cdb57a' : '#9a9da3';
    x.fillStyle = base; x.fillRect(0, 0, w, w);
    for (let yy = 0; yy < w; yy += 26) for (let xx = (yy / 26 % 2) * 13; xx < w; xx += 26) { const g = x.createRadialGradient(xx, yy, 2, xx, yy, 16); g.addColorStop(0, 'rgba(255,255,255,.16)'); g.addColorStop(1, 'rgba(0,0,0,.08)'); x.fillStyle = g; x.beginPath(); x.arc(xx, yy, 16, 0, Math.PI * 2); x.fill(); }
    const gear = (gx, gy, r, teeth, col) => { x.fillStyle = col; x.beginPath(); for (let i = 0; i < teeth * 2; i++) { const a = i / (teeth * 2) * Math.PI * 2, rr = i % 2 ? r : r * .9; x.lineTo(gx + Math.cos(a) * rr, gy + Math.sin(a) * rr); } x.fill(); x.globalCompositeOperation = 'destination-out'; for (let k = 0; k < 5; k++) { const a0 = k / 5 * Math.PI * 2 + .2; x.beginPath(); x.moveTo(gx, gy); x.arc(gx, gy, r * .72, a0, a0 + Math.PI * 2 / 5 - .35); x.closePath(); x.fill(); } x.globalCompositeOperation = 'source-over'; x.fillStyle = col; x.beginPath(); x.arc(gx, gy, r * .2, 0, Math.PI * 2); x.fill(); x.fillStyle = '#b0192b'; x.beginPath(); x.arc(gx, gy, Math.max(6, r * .08), 0, Math.PI * 2); x.fill(); x.fillStyle = 'rgba(255,255,255,.6)'; x.beginPath(); x.arc(gx - 2, gy - 2, 2.5, 0, Math.PI * 2); x.fill(); };
    gear(c, c - 210, 170, 60, gold ? '#e3c98d' : '#c9ccd2');
    gear(c + 190, c - 20, 95, 40, '#d8b26a'); gear(c - 160, c + 60, 80, 34, '#d8b26a'); gear(c + 40, c + 120, 62, 28, '#c9ccd2'); gear(c - 30, c - 40, 50, 22, '#d8b26a');
    x.lineCap = 'round'; x.strokeStyle = bridge; x.lineWidth = 64; x.globalAlpha = .92;
    x.beginPath(); x.moveTo(c - 380, c + 260); x.quadraticCurveTo(c, c + 120, c + 380, c + 280); x.stroke();
    x.beginPath(); x.moveTo(c - 360, c - 300); x.lineTo(c + 340, c - 330); x.stroke();
    x.globalAlpha = 1; x.strokeStyle = 'rgba(255,255,255,.18)'; x.lineWidth = 3; for (let i = -6; i < 6; i++) { x.beginPath(); x.moveTo(c - 380, c + 260 + i * 9); x.quadraticCurveTo(c, c + 120 + i * 9, c + 380, c + 280 + i * 9); x.stroke(); }
    [[c - 300, c - 300], [c + 300, c - 325], [c - 340, c + 255], [c + 340, c + 275]].forEach(([sx, sy]) => { x.fillStyle = '#2a3a8a'; x.beginPath(); x.arc(sx, sy, 16, 0, Math.PI * 2); x.fill(); x.strokeStyle = '#111'; x.lineWidth = 4; x.beginPath(); x.moveTo(sx - 12, sy); x.lineTo(sx + 12, sy); x.stroke(); });
  });
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
      // shoulder yoke: rounded roll-over (no hard lid edge), front/back panels stay full until near the neck
      const k = (v - split) / (1 - split), e = k * k * (3 - 2 * k);
      rx = lerp(P.w, P.neckR, Math.pow(k, 1.5)); rz = lerp(P.d, P.neckR * .8, Math.pow(k, 1.3));
      y = P.h / 2 + P.rise * Math.sin(k * Math.PI / 2) - P.neckDrop * Math.pow(Math.max(0, s), 1.5) * e * e;
    }
    t.set(rx * c, y, rz * s);
  };
}
// ring of points around `c`, perpendicular to tangent T (curve lives in the x/y plane, so z is a stable binormal)
function ellipseRing(c, T, r, ratio, n, Bv = null, phase = 0, sq = 2) {
  const B = Bv || new THREE.Vector3(0, 0, 1), N = new THREE.Vector3().crossVectors(B, T).normalize(), out = [];
  const se = v => Math.sign(v) * Math.abs(v) ** (2 / sq); // sq > 2 squares the profile (flat strap, rounded edges)
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + phase; out.push(c.clone().addScaledVector(N, se(Math.cos(a)) * r).addScaledVector(B, se(Math.sin(a)) * r * ratio)); }
  return out;
}
// swept tube with variable radius and an elliptical cross-section
function sweepGeo(curve, radiusAt, ratio, segs, radial, B = null, o = {}) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= segs; j++) {
    const t = j / segs, ring = ellipseRing(curve.getPointAt(t), curve.getTangentAt(t), radiusAt(t), o.ratioAt ? o.ratioAt(t) : ratio, radial, B, o.phase || 0, o.sq || 2);
    ring.push(ring[0]); ring.forEach((p, i) => { pos.push(p.x, p.y, p.z); uv.push(i / radial, 1 - t); });
  }
  const w = radial + 1;
  for (let j = 0; j < segs; j++) for (let i = 0; i < radial; i++) { const a = j * w + i, b = a + w; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const bandFn = (rx, rz, y0, h, taper = .94) => (u, v, t) => { const a = u * Math.PI * 2, k = lerp(1, taper, v); t.set(rx * k * Math.cos(a), y0 - v * h, rz * k * Math.sin(a)); };

const Studio = {
  ok: false, spin: false, root: null, decals: [], dial: null, hands: null,
  init() {
    const host = $('#stage');
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(Math.max(devicePixelRatio, 1.5), 2)); // supersample on 1x screens r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = .82;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    host.prepend(r.domElement);
    const sc = this.scene = new THREE.Scene(); sc.background = new THREE.Color('#121527');
    const pm = new THREE.PMREMGenerator(r); this.envRoom = pm.fromScene(new RoomEnvironment(), .04).texture; this.envStudio = pm.fromScene(softboxScene(), .015).texture; sc.environment = this.envRoom; sc.environmentIntensity = .55;
    const cam = this.camera = new THREE.PerspectiveCamera(30, 1, .1, 100); cam.position.set(0, .5, 10);
    const ctl = this.controls = new OrbitControls(cam, r.domElement); ctl.enableDamping = true; ctl.dampingFactor = .08; ctl.minDistance = 2.5; ctl.maxDistance = 18; ctl.autoRotateSpeed = 2.2;
    const key = new THREE.DirectionalLight(0xfff6ec, 1.7); key.position.set(4, 7, 6); key.castShadow = true; key.shadow.mapSize.set(4096, 4096); this.key = key;
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
    this.root.clear(); this.decals = []; this.dial = null; this.hands = null; this.torso = null; this.modelMeshes = null;
  },
  build() {
    const d = S.current; if (!d || !this.ok) return;
    this.clear();
    const isW = d.category === 'watch'; this.scene.environment = isW ? this.envStudio : this.envRoom; this.scene.environmentIntensity = isW ? 1 : .55; // softbox reflections for metal
    if (isW) this.buildWatch(d); else this.buildGarment(d);
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.root); this.ground.position.y = box.min.y - .01;
    { const sc = this.key.shadow.camera, rr = box.getSize(new THREE.Vector3()).length() * .62; Object.assign(sc, { left: -rr, right: rr, top: rr, bottom: -rr }); sc.updateProjectionMatrix(); this.key.shadow.radius = 3; } // tight shadow frustum = crisp shadows
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
    const kk = f.k || 1; // woven fabrics carry their own texture scale
    const bump = TEX.repeat(rib ? TEX.rib() : f.weave ? TEX.weave(f.weave) : TEX.knit(fabric === 'waffle' ? 'waffle' : fabric === 'fleece' ? 'fleece' : 'jersey'), rib ? rx * 3 : rx * kk, rib ? 1 : ry * kk);
    bump.userData.own = true;
    const tint = !rib && f.tint && !surf ? TEX.repeat(TEX.weaveTint(f.weave), rx * kk / 6, ry * kk / 6) : null; if (tint) tint.userData.own = true;
    return new THREE.MeshPhysicalMaterial({ color: hex, roughness: f.rough, sheen: f.sheen, sheenRoughness: .75, sheenColor: new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), .3), side: THREE.DoubleSide, bumpMap: bump, bumpScale: (rib ? 1.4 : f.bump), ...(tint ? { map: tint } : {}),
      ...(surf ? { color: '#ffffff', sheenColor: new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), .3), map: surf.map, ...(surf.alpha ? { alphaMap: surf.alpha, alphaTest: .5 } : {}) } : {}) });
  },
  add(geo, mat, cast = true) { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; this.root.add(m); return m; },
  // Real garment meshes (CLO / Marvelous / marketplace GLB) take priority over the procedural fallback.
  buildGarment(d) {
    const model = Models.peek(d);
    if (model === undefined) { Models.load(d).then(() => { if (S.current === d && S.view === 'studio') { this.build(); Panels.studio(); } }); if (isBottom(d.category)) return; } // bottoms have no fallback shape: wait for the model
    if (model) return this.buildFromModel(d, model);
    return this.buildProcedural(d);
  },
  buildFromModel(d, gltfScene) {
    const g = d.garment, fit = FITS[g.fit] || FITS.boxy;
    const fin = g.finish || 'none', dis = g.distress || 'none', washed = fin !== 'none' || dis !== 'none';
    const surf = g.pattern && g.pattern !== 'solid' ? { map: TEX.pattern(g.pattern, g.plaid1, g.plaid2, g.plaid3, num(g.plaidScale) || 1) } : washed ? TEX.surface(g.color, fin, dis) : null;
    const obj = SkeletonUtils.clone(gltfScene); obj.rotation.y = (g.modelRot || 0) * Math.PI / 180;
    // bake rigged (skinned) meshes into static geometry so measuring, decals and the waist trace see the posed shape
    obj.updateMatrixWorld(true); { const sk = []; obj.traverse(o => { if (o.isSkinnedMesh) sk.push(o); }); sk.forEach(o => { const geo = o.geometry.clone(), p = geo.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); o.applyBoneTransform(i, v); p.setXYZ(i, v.x, v.y, v.z); } geo.deleteAttribute('skinIndex'); geo.deleteAttribute('skinWeight'); geo.computeVertexNormals(); geo.computeBoundingBox(); geo.computeBoundingSphere(); const m = new THREE.Mesh(geo, o.material); m.name = o.name; m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale); o.parent.add(m); o.parent.remove(m === o ? null : o); }); }
    const keep = !g.model && MODEL_KEEP[d.category]; if (keep) { const drop = []; obj.traverse(o => { if (o.isMesh && !keep.includes(o.name)) drop.push(o); }); drop.forEach(o => o.parent.remove(o)); }
    const holder = new THREE.Group(); holder.add(obj); this.root.add(holder);
    // normalise: garment height ≈ body length from HPS at this fit, centred, hem at -h/2
    holder.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(obj), sz = box.getSize(new THREE.Vector3());
    // calibrate: HPS→hem equals the tech-pack body length, so prints land at true inches
    const pv = code => num((d.pom.rows.find(r => r.code === code) || {}).base);
    const A = (d.category === 'socks' ? (pv('S2') || 7) + 1.5 : (pv('A') || fit.h * 10)) / 10, hpsFrac = num(g.modelHps) || (g.model ? .96 : (MODEL_CAL[d.category] || .96));
    const s = d.category === 'socks' && !g.model ? ((pv('S1') || 9) / 10) / sz.z : A / (hpsFrac * sz.y); obj.scale.multiplyScalar(s); holder.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(obj); const c = box.getCenter(new THREE.Vector3());
    obj.position.x -= c.x; obj.position.z -= c.z; const H = d.category === 'socks' ? box.max.y - box.min.y : A; obj.position.y += (-H / 2) - box.min.y; holder.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(obj);
    let biggest = null, most = -1; this.modelMeshes = [];
    obj.traverse(o => {
      if (!o.isMesh) return;
      const orig = Array.isArray(o.material) ? o.material[0] : o.material;
      const m = this.fabricMat(g.color, g.fabric, false, 30, 18, surf);
      if (orig?.normalMap && !(MODEL_NO_NORMAL.includes(d.category) && !g.model)) { m.normalMap = orig.normalMap; m.normalScale = orig.normalScale?.clone() || new THREE.Vector2(1, 1); m.bumpScale *= .35; } // keep baked folds
      if (orig?.aoMap) { m.aoMap = orig.aoMap; m.aoMapIntensity = 1; }
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals(); // trimmed defaults ship without normals
      o.material = m; o.castShadow = o.receiveShadow = true; this.modelMeshes.push(o);
      const n = o.geometry.attributes.position.count; if (n > most) { most = n; biggest = o; }
    });
    this.torso = biggest;
    this.P = { w: (box.max.x - box.min.x) / 4, d: box.max.z, h: H, rise: 0, neckR: .34, side: d.category === 'socks' }; // socks: logos on the outer side of each leg
    if ((d.category === 'pants' || d.category === 'shorts') && g.doubleWB === '1') this.addSecondWaistband(d, box);
    if (d.category === 'socks' && !g.model) this.paintSockZones(d, box);
    this.updateDecals();
  },
  // Sock zones painted in the shader by world position: heel cup, toe, cuff band, athletic stripes.
  // Works on any sock mesh (feet point +z) and layers over the body colour or a fabric pattern.
  paintSockZones(d, box) {
    const g = d.garment, pv = c => num((d.pom.rows.find(r => r.code === c) || {}).base), noshow = g.sockStyle === 'noshow';
    const foot = box.max.z - box.min.z, heelD = (pv('S6') || 2.25) / 10, rib = (pv('S4') || 1.5) / 10, n = noshow ? 0 : clamp(Math.round(num(g.stripes)), 0, 4);
    const top = box.max.y, sw = .045, gap = .045, y1 = top - (noshow ? .05 : rib) - .03, y0 = y1 - (n * sw + (n - 1) * gap);
    const U = {
      uAccent: { value: new THREE.Color(g.stitch) }, uCuff: { value: new THREE.Color(g.trim) }, uStripe: { value: new THREE.Color(g.stripeCol || '#B98A4A') },
      uAccentOn: { value: g.sockAccent === '1' ? 1 : 0 }, uCuffOn: { value: g.sockCuff === '1' ? 1 : 0 },
      uToeZ: { value: box.max.z - Math.min(.2, foot * .2) }, uHeelZ: { value: box.min.z + Math.min(heelD * 1.5, foot * .34) }, uHeelY: { value: box.min.y + Math.min(heelD * 1.25, (top - box.min.y) * .6) },
      uMinZ: { value: box.min.z }, uMinY: { value: box.min.y }, uCuffY: { value: top - (noshow ? .05 : rib) }, uStripeN: { value: n }, uStripeY0: { value: y0 }, uStripeY1: { value: y1 },
    };
    this.modelMeshes.forEach(m => {
      const mat = m.material; mat.customProgramCacheKey = () => 'sockzones';
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, U);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; uniform vec3 uAccent, uCuff, uStripe; uniform float uAccentOn, uCuffOn, uToeZ, uHeelZ, uHeelY, uCuffY, uStripeN, uStripeY0, uStripeY1, uMinZ, uMinY;')
          .replace('#include <map_fragment>', `#include <map_fragment>
            float e = 0.012;
            float toe = smoothstep(uToeZ - e, uToeZ + e, vWp.z);
            float hr = length(vec2((vWp.z - uMinZ) / (uHeelZ - uMinZ), (vWp.y - uMinY) / (uHeelY - uMinY)));
            float heel = 1.0 - smoothstep(1.0 - 0.06, 1.0 + 0.06, hr); // rounded heel cup
            toe *= 1.0 - smoothstep(uCuffY - 0.02, uCuffY, vWp.y);
            diffuseColor.rgb = mix(diffuseColor.rgb, uAccent, uAccentOn * max(toe, heel));
            diffuseColor.rgb = mix(diffuseColor.rgb, uCuff, uCuffOn * smoothstep(uCuffY - 0.004, uCuffY + 0.004, vWp.y));
            if (uStripeN > 0.5 && vWp.y > uStripeY0 && vWp.y < uStripeY1) {
              float t = (vWp.y - uStripeY0) / (uStripeY1 - uStripeY0) * (uStripeN * 2.0 - 1.0);
              if (mod(floor(t), 2.0) < 0.5) diffuseColor.rgb = uStripe;
            }`);
      };
      mat.needsUpdate = true;
    });
  },
  // Double waistband: a second band traced from the model's own waist line, sitting above the main band
  addSecondWaistband(d, box) {
    const g = d.garment, top = box.max.y, bins = 72, R = new Float32Array(bins), cx = 0, v = new THREE.Vector3();
    this.modelMeshes.forEach(m => { const p = m.geometry.attributes.position; m.updateMatrixWorld(true); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); if (v.y < top - .06) continue; const a = Math.atan2(v.z, v.x - cx), b = ((Math.round((a / (Math.PI * 2) + .5) * bins)) % bins + bins) % bins; R[b] = Math.max(R[b], Math.hypot(v.x - cx, v.z)); } });
    for (let k = 0; k < 3; k++) for (let b = 0; b < bins; b++) if (!R[b]) R[b] = Math.max(R[(b + 1) % bins], R[(b + bins - 1) % bins]); // fill gaps
    const sm = Array.from(R, (r, b) => (R[(b + bins - 1) % bins] + 2 * r + R[(b + 1) % bins]) / 4 * 1.012);
    const h = num(g.wb2H || 1.75) / 10, y0 = top - .05, per = sm.reduce((s, r) => s + r, 0) / bins * Math.PI * 2;
    const geo = new ParametricGeometry((u, w, t) => { const a = (u - .5) * Math.PI * 2, f = u * bins, i0 = Math.floor(f) % bins, i1 = (i0 + 1) % bins, r = lerp(sm[i0], sm[i1], f - Math.floor(f)) * lerp(1, .985, w); t.set(cx + Math.cos(a) * r, y0 + w * h, Math.sin(a) * r); }, bins * 2, 6);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * per * 2.2, uv.getY(i) * h * 2.2);
    geo.computeVertexNormals();
    const plaid = g.wb2Pattern === 'plaid', map = plaid ? TEX.pattern('plaid', g.plaid1, g.plaid2, g.plaid3, num(g.plaidScale) || 1, true) : null;
    const mat = this.fabricMat(plaid ? '#ffffff' : g.wb2Color, 'twill', false, 6, 2, map ? { map } : null);
    const band = this.add(geo, mat); this.modelMeshes.push(band);
    const seam = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: bins }, (_, b) => { const a = (b / bins - .5) * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * sm[b] * 1.004, y0 + .004, Math.sin(a) * sm[b] * 1.004); }), true), 144, .006, 6, true);
    this.add(seam, new THREE.MeshStandardMaterial({ color: shade(g.color, -.3), roughness: .8 }));
  },
  // Socks: a knit tube swept down the leg, round the heel and out to the toe
  buildSock(d) {
    const g = d.garment, v = c => num((d.pom.rows.find(r => r.code === c) || {}).base);
    const FL = (v('S1') || 9) / 10, LH = (v('S2') || 7) / 10, cuff = (v('S4') || 1.5) / 10;
    const pts = [[0, LH + .18, -.02], [0, LH * .55, -.02], [0, .2, -.03], [0, .07, .08], [0, .03, FL * .4], [0, .04, FL * .82], [0, .06, FL * .98]].map(p => new THREE.Vector3(...p));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal'), X = new THREE.Vector3(1, 0, 0);
    const sub = (a, b) => ({ getPointAt: t => curve.getPointAt(a + (b - a) * t), getTangentAt: t => curve.getTangentAt(a + (b - a) * t) });
    const L = curve.getLength(), tc = cuff / L, tHeel = [.4, .58], tToe = .88;
    const rad = t => t < .35 ? lerp(.19, .165, t / .35) : t < .5 ? lerp(.165, .14, (t - .35) / .15) : lerp(.135, .085, Math.pow((t - .5) / .5, 1.8));
    const ratio = t => t < .42 ? 1 : lerp(1, 1.4, Math.min(1, (t - .42) / .18)); // foot is wider than tall
    const pat = g.pattern && g.pattern !== 'solid' ? { map: TEX.pattern(g.pattern, g.plaid1, g.plaid2, g.plaid3, num(g.plaidScale) || 1) } : null;
    const body = this.fabricMat(g.color, 'sockknit', false, 12, 30, pat), rib = this.fabricMat(g.trim, 'sockknit', true, 10, 4), acc = this.fabricMat(g.stitch, 'sockknit', false, 12, 12);
    const seg = (a, b, mat) => this.add(sweepGeo(sub(a, b), t => rad(a + (b - a) * t), 1, Math.max(8, Math.round((b - a) * 120)), 56, X, { ratioAt: t => ratio(a + (b - a) * t) }), mat);
    // body map: heel cup on the back/sole side only (ring angle 0 = back of leg / sole), toe all round
    if (!pat) {
      const loc = t => (t - tc) / (1 - tc), H = 1024;
      const cv = TEX.canvas(256, H, (x, w) => { x.fillStyle = g.color; x.fillRect(0, 0, w, H); x.fillStyle = g.stitch; const y0 = loc(tHeel[0]) * H, y1 = loc(tHeel[1]) * H; [[0, 1], [w, -1]].forEach(([cx]) => { x.beginPath(); x.ellipse(cx, (y0 + y1) / 2, w * .24, (y1 - y0) / 2, 0, 0, Math.PI * 2); x.fill(); }); x.fillRect(0, loc(tToe) * H, w, H); });
      const mt = new THREE.CanvasTexture(cv); mt.colorSpace = THREE.SRGBColorSpace; mt.userData.own = true;
      body.map = mt; body.color.set('#ffffff'); body.needsUpdate = true;
    }
    const main = [seg(0, tc, rib), seg(tc - .002, 1, body)];
    const tip = this.add(new THREE.SphereGeometry(.1, 32, 16), acc); tip.position.copy(curve.getPointAt(1)); tip.scale.set(1.18, .95, .6);
    this.torso = main[1]; this.modelMeshes = main;
    this.P = { w: .2, d: .2, h: (LH + .18) * 2, rise: 0, neckR: .2, side: true };
    this.updateDecals();
  },
  buildProcedural(d) {
    if (d.category === 'socks') return this.buildSock(d);
    if (isBottom(d.category)) { toast('No 3D model for ' + CATS[d.category].label + ' yet — upload a GLB', true); return; }
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
    // sleeves — one continuous sweep: starts buried in the body, rolls over the shoulder, runs down the arm
    const armR = (long ? .4 : .43) * fit.w, openR = long ? .19 : .35, len = long ? 2.2 : .95, ang = long ? .3 : .78;
    const sleeveMat = this.fabricMat(g.color, g.fabric, false, 14, 10, surf);
    [1, -1].forEach(sx => {
      const shY = P.h / 2 - armR * .92 - fit.drop * .35;
      const sh = new THREE.Vector3(sx * (P.w * .9 + fit.drop * .3), shY, 0);
      const dir = new THREE.Vector3(sx * Math.sin(ang), -Math.cos(ang), 0);
      const pts = [new THREE.Vector3(sx * P.w * .42, shY + .05, 0), new THREE.Vector3(sx * P.w * .7, shY + .03, 0), sh,
        sh.clone().addScaledVector(dir, len * .5).add(new THREE.Vector3(0, 0, long ? .06 : 0)),
        sh.clone().addScaledVector(dir, len).add(new THREE.Vector3(-sx * (long ? .06 : 0), 0, long ? .1 : 0))];
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const t0 = .3; // fraction of the curve that sits inside the body
      const rad = t => t < t0 ? lerp(armR * .8, armR, t / t0) : lerp(armR, openR, Math.pow((t - t0) / (1 - t0), long ? .8 : 1.1));
      this.add(sweepGeo(curve, rad, .8, 90, 48), sleeveMat);
      const end = curve.getPoint(1), T = curve.getTangent(1);
      if (long) this.add(sweepGeo(new THREE.LineCurve3(end.clone().addScaledVector(T, -.02), end.clone().addScaledVector(T, fleece ? .32 : .26)), t => openR * lerp(1.04, .94, t), .8, 4, 40), trim);
      else this.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ellipseRing(end, T, openR, .8, 64), true), 64, .02, 8, true), body);
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
  detailDecal(pos, size, tex, rotZ = 0, back = false, bump = false, target = this.torso, yaw = null) {
    target.updateMatrixWorld(true);
    const geo = new DecalGeometry(target, pos, new THREE.Euler(0, yaw ?? (back ? Math.PI : 0), rotZ), size);
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
      const tex = new THREE.CanvasTexture(art); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 16;
      const puff = /Puff|embroider|Chenille|patch/i.test(P.tech);
      // real models: aim at the actual fabric surface; procedural: known front plane
      let pos = new THREE.Vector3(x, cy, side === 'front' ? this.P.d : -this.P.d), target = this.torso, depth = .95;
      const sideways = this.P.side, dirS = side === 'front' ? 1 : -1, yaw = sideways ? dirS * Math.PI / 2 : null;
      let zc = 0;
      if (sideways && this.modelMeshes?.length) { // find the leg's centre at this height (feet point forward, legs sit back)
        const zs = []; for (let z = -1.2; z <= 1.2; z += .03) { const h = new THREE.Raycaster(new THREE.Vector3(dirS * 20, cy, z), new THREE.Vector3(-dirS, 0, 0)).intersectObjects(this.modelMeshes, false)[0]; if (h) zs.push(z); }
        if (zs.length) zc = (zs[0] + zs[zs.length - 1]) / 2;
      }
      if (this.modelMeshes?.length) { const rc = sideways ? new THREE.Raycaster(new THREE.Vector3(dirS * 20, cy, zc + P.dx / 10), new THREE.Vector3(-dirS, 0, 0)) : new THREE.Raycaster(new THREE.Vector3(x, cy, side === 'front' ? 20 : -20), new THREE.Vector3(0, 0, side === 'front' ? -1 : 1)); const hit = rc.intersectObjects(this.modelMeshes, false)[0]; if (!hit) return; pos = hit.point; target = hit.object; depth = .5; }
      // project onto every mesh the print overlaps — models often split panels into separate pieces
      (this.modelMeshes?.length ? this.modelMeshes : [target]).forEach(tg => {
        const m = this.detailDecal(pos, new THREE.Vector3(size, size, depth), tex, THREE.MathUtils.degToRad(side === 'front' ? -P.r : P.r), side === 'back', puff && (/3D puff|Chenille/i.test(P.tech) ? 6 : /Puff print/.test(P.tech) ? 4 : 2.2), tg, yaw);
        if (!m.geometry.attributes.position?.count) { this.root.remove(m); m.geometry.dispose(); m.material.dispose(); return; }
        if (P.tech === 'Discharge') m.material.opacity = .82;
        this.decals.push(m);
      });
    });
  },
  /* ---------- watch ---------- */
  buildWatch(d) {
    // Real proportions at 42 mm (1 unit ≈ 20 mm): case ≈ 10.5 mm tall, dial recessed under a machined bezel, domed sapphire
    const W = watchSpec(d), sc = W.dia / 42, grp = new THREE.Group(); this.root.add(grp);
    const mk = (geo, mat, parent = grp) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
    const V2 = a => a.map(([x, y]) => new THREE.Vector2(x, y));
    const caseMat = watchMat(W.caseMat, W.caseWood);
    const cm = CASE_MATS[W.caseMat] || CASE_MATS.steel;
    const metal = cm.kind === 'metal' ? caseMat : W.caseMat === 'wood' ? (BEZELS[W.bezel]?.m ? watchMat('_bz', null, BEZELS[W.bezel]) : watchMat('wood', W.caseWood)) : watchMat('steel');
    const polished = metal.clone(); polished.roughness = Math.min(.16, metal.roughness); polished.envMapIntensity = 1.3;
    const steel = watchMat('steel');
    const G = WATCH_GEOM[W.shape] || WATCH_GEOM.round;
    const TOP = .17, DIAL_Y = .14, BZ_TOP = .255, CRY_Y = .262, MID = -.055;
    // case
    if (W.shape === 'round') {
      mk(new THREE.LatheGeometry(V2([[0, -.28], [.6, -.28], [.64, -.272], [.67, -.25], [.69, -.238], [.84, -.234], [.92, -.222], [.985, -.18], [1.03, -.11], [1.048, -.03], [1.05, .04], [1.042, .1], [1.02, .14], [.99, .162], [.96, TOP], [.93, TOP], [.92, DIAL_Y], [.76, DIAL_Y]]), 160), caseMat);
    } else {
      // shaped case: a ring with the dial well cut through, closed underneath by a caseback
      const cs = new THREE.Shape(shapePts(W.shape, 1));
      cs.holes.push(new THREE.Path(G.dialRect ? shapePts(W.shape, G.dialScale * 1.01).reverse() : circlePts(G.dialR + .01, 128)));
      const g = new THREE.ExtrudeGeometry(cs, { depth: .34, bevelEnabled: true, bevelThickness: .06, bevelSize: .055, bevelSegments: 8, curveSegments: 72 });
      g.rotateX(-Math.PI / 2); g.computeBoundingBox(); g.translate(0, TOP - g.boundingBox.max.y, 0); g.computeBoundingBox(); mk(g, caseMat);
      const back = mk(new THREE.CircleGeometry(Math.min(G.halfX, G.halfZ) * .9, 96), steel); back.rotation.x = Math.PI / 2; back.position.y = g.boundingBox.min.y - .002;
    }
    // dial (shape-aware), movement for skeleton / open-heart
    const dialR = G.dialR, insert = /diver|gmt|tachy/.test(W.bezelStyle) && W.shape === 'round';
    const dialShape = G.dialRect ? shapePts(W.shape, G.dialScale) : null;
    const dialGeo = () => { if (!dialShape) return new THREE.CircleGeometry(dialR, 128); const g = new THREE.ShapeGeometry(new THREE.Shape(dialShape), 64), p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) / dialR + 1) / 2, (p.getY(i) / dialR + 1) / 2); return g; };
    const open = W.dialStyle === 'skeleton' || W.dialStyle === 'openheart';
    const dialTex = new THREE.CanvasTexture(dialCanvas(d, W, G.fit)); dialTex.colorSpace = THREE.SRGBColorSpace; dialTex.anisotropy = 16; dialTex.userData.own = true;
    const finish = DIAL_STYLES[W.dialStyle] || DIAL_STYLES.classic;
    const dial = mk(dialGeo(), new THREE.MeshPhysicalMaterial({ map: dialTex, roughness: finish.rough, metalness: finish.metal, clearcoat: W.dialStyle === 'enamel' ? 1 : .2, envMapIntensity: .55, transparent: open, alphaTest: open ? .4 : 0, side: THREE.DoubleSide }));
    dial.rotation.x = -Math.PI / 2; dial.position.y = DIAL_Y;
    // rehaut: the angled chapter ring between dial and crystal (round cases)
    if (W.shape === 'round' || W.shape === 'cushion') mk(new THREE.LatheGeometry(V2([[dialR - .005, DIAL_Y + .002], [dialR + .05, TOP + .03]]), 160), new THREE.MeshStandardMaterial({ color: shade(W.dial, lum(W.dial) > .5 ? -.08 : .1), roughness: .6, metalness: .2, side: THREE.DoubleSide }));
    this.balance = null;
    if (open) {
      const mv = new THREE.CanvasTexture(movementCanvas(W)); mv.colorSpace = THREE.SRGBColorSpace; mv.userData.own = true;
      const plate = mk(dialGeo(), new THREE.MeshStandardMaterial({ map: mv, metalness: .75, roughness: .38 })); plate.rotation.x = -Math.PI / 2; plate.position.y = DIAL_Y - .07;
      const bw = new THREE.Group(), gold = new THREE.MeshStandardMaterial({ color: '#d8b26a', metalness: 1, roughness: .22 });
      const rim = new THREE.Mesh(new THREE.TorusGeometry(.12, .01, 12, 64), gold); rim.rotation.x = Math.PI / 2; bw.add(rim);
      for (let i = 0; i < 2; i++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(.24, .007, .01), gold); sp.rotation.y = i * Math.PI / 2; bw.add(sp); }
      const coil = []; for (let a = 0; a < Math.PI * 10; a += .2) coil.push(new THREE.Vector3(Math.cos(a) * (.015 + a * .0022), .008, Math.sin(a) * (.015 + a * .0022)));
      bw.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coil), 160, .002, 4), steel));
      const bp = W.dialStyle === 'skeleton' ? [0, DIAL_Y - .05, dialR * .42] : [-dialR * .48, DIAL_Y - .05, 0];
      bw.position.set(...bp); grp.add(bw); this.balance = bw;
    }
    // bezel
    if (W.shape === 'octagon') {
      const oct = new THREE.Shape(shapePts('octagon', .97)); oct.holes.push(new THREE.Path(circlePts(dialR + .02, 128)));
      const og = new THREE.ExtrudeGeometry(oct, { depth: .05, bevelEnabled: true, bevelThickness: .02, bevelSize: .018, bevelSegments: 4, curveSegments: 72 }); og.rotateX(-Math.PI / 2); og.translate(0, TOP + .02, 0);
      mk(og, polished);
      const sy = TOP + .02 + .05 + .02;
      for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4, s = mk(new THREE.CylinderGeometry(.034, .034, .02, 24), metal); s.position.set(Math.cos(a) * .89, sy, Math.sin(a) * .89); const slot = mk(new THREE.BoxGeometry(.05, .008, .008), new THREE.MeshStandardMaterial({ color: '#2a2a2a', metalness: .8, roughness: .5 })); slot.position.set(s.position.x, sy + .011, s.position.z); slot.rotation.y = -a + .7; }
    } else if (W.shape !== 'round') {
      const fr = new THREE.Shape(shapePts(W.shape, .98)); fr.holes.push(new THREE.Path(G.dialRect ? shapePts(W.shape, G.dialScale * 1.02).reverse() : circlePts(G.dialR + .02, 128)));
      const fg = new THREE.ExtrudeGeometry(fr, { depth: .035, bevelEnabled: true, bevelThickness: .015, bevelSize: .012, bevelSegments: 4, curveSegments: 72 }); fg.rotateX(-Math.PI / 2); fg.translate(0, TOP + .01, 0); mk(fg, W.caseMat === 'wood' ? metal : polished);
    } else if (W.bezelStyle !== 'none') {
      // machined bezel: polished outer chamfer, flat top, inner step
      const bzMat = W.bezelStyle === 'gem' ? watchMat(W.caseMat === 'wood' ? 'steel' : W.caseMat) : W.bezelStyle === 'fluted' ? flutedMat(polished) : insert ? metal : polished;
      mk(new THREE.LatheGeometry(V2([[.965, TOP - .005], [.972, TOP + .03], [.968, TOP + .065], [.952, BZ_TOP], [.83, BZ_TOP + .003], [.812, BZ_TOP - .006], [.8, BZ_TOP - .025], [.8, TOP]]), 200), bzMat);
      if (insert) {
        const it = new THREE.CanvasTexture(insertCanvas(W)); it.colorSpace = THREE.SRGBColorSpace; it.anisotropy = 16; it.userData.own = true;
        const ring = mk(new THREE.RingGeometry(.825, .945, 200), new THREE.MeshPhysicalMaterial({ map: it, roughness: .18, metalness: .1, clearcoat: 1, clearcoatRoughness: .05 })); ring.rotation.x = -Math.PI / 2; ring.position.y = BZ_TOP + .004;
      } else if (W.bezelStyle === 'gem') {
        const gm = new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: 0, roughness: 0, transmission: 1, ior: 2.4, thickness: .2, iridescence: .4, envMapIntensity: 3 });
        const gg = new THREE.OctahedronGeometry(.036, 1), n = 52, inst = new THREE.InstancedMesh(gg, gm, n), o = new THREE.Object3D();
        for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; o.position.set(Math.cos(a) * .885, BZ_TOP + .02, Math.sin(a) * .885); o.rotation.set(Math.PI / 2, 0, a); o.updateMatrix(); inst.setMatrixAt(i, o.matrix); }
        grp.add(inst);
      }
    }
    // hands — pivot at center, pointing to 12 (-z)
    const handMat = c => new THREE.MeshPhysicalMaterial({ color: c, metalness: .7, roughness: .22, clearcoat: .4 });
    const hand = (len, wid, col, y, style) => { const g = handGeo(style, len, wid); const m = mk(g, handMat(col)); m.position.y = y; return m; };
    const hl = dialR / .89;
    this.hands = { h: hand(.5 * hl, .065, W.index, DIAL_Y + .012, W.hands), m: hand(.75 * hl, .046, W.index, DIAL_Y + .026, W.hands === 'mercedes' ? 'sword' : W.hands), s: hand(.84 * hl, .012, W.accent, DIAL_Y + .04, 'baton') };
    mk(new THREE.CylinderGeometry(.03, .034, .05, 32), handMat(W.index)).position.y = DIAL_Y + .03;
    // domed sapphire crystal
    const cR = insert ? .825 : W.shape === 'round' ? .81 : dialR, dome = .025, sR = (cR * cR + dome * dome) / (2 * dome);
    const cry = mk(W.shape === 'round' || W.shape === 'cushion' || W.shape === 'octagon' ? new THREE.SphereGeometry(sR, 128, 12, 0, Math.PI * 2, 0, Math.asin(cR / sR)) : dialGeo(),
      new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: 1, thickness: .04, ior: 1.77, roughness: 0, metalness: 0, clearcoat: 1, envMapIntensity: 1.6, transparent: true, opacity: 1 }));
    if (W.shape === 'round' || W.shape === 'cushion' || W.shape === 'octagon') cry.position.y = CRY_Y + dome - sR; else { cry.rotation.x = -Math.PI / 2; cry.position.y = CRY_Y; }
    cry.castShadow = false;
    // knurled crown + stem + guards
    const crownMat = cm.kind === 'metal' ? metal : steel;
    const gear = new THREE.Shape(); for (let i = 0; i <= 64; i++) { const a = i / 64 * Math.PI * 2, r = i % 2 ? .08 : .088; i ? gear.lineTo(Math.cos(a) * r, Math.sin(a) * r) : gear.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    const cg2 = new THREE.ExtrudeGeometry(gear, { depth: .11, bevelEnabled: true, bevelThickness: .015, bevelSize: .012, bevelSegments: 3, curveSegments: 8 }); cg2.rotateY(Math.PI / 2);
    const crown = mk(cg2, crownMat); crown.position.set(G.halfX + .05, MID, 0);
    const stem = mk(new THREE.CylinderGeometry(.04, .04, .08, 24), crownMat); stem.rotation.z = Math.PI / 2; stem.position.set(G.halfX + .01, MID, 0);
    if (W.crownGuards) [-1, 1].forEach(s => { const gd = mk(new RoundedBoxGeometry(.13, .16, .08, 4, .035), caseMat); gd.position.set(G.halfX + .02, MID, s * .15); });
    // lugs (integrated octagon has none)
    if (W.shape !== 'octagon') { const lg = lugGeo(); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => { const l = mk(lg, caseMat); l.position.set(sx * .63, 0, sz * (G.halfZ - .34)); if (sz < 0) l.rotation.y = Math.PI; }); }
    const bm = cm.kind === 'metal' ? metal : steel, bp = bm.clone(); bp.roughness = .17; bp.envMapIntensity = 1.35; // polished, not a perfect mirror
    this.buildStrap(W, grp, mk, { metal: bm, polished: bp, steel }, G);
    grp.scale.setScalar(sc); grp.rotation.x = .62;
  },
  buildStrap(W, grp, mk, M, G) {
    const z0 = G.halfZ + .18, integ = W.shape === 'octagon';
    const base = [[0, -.14, z0], [0, -.3, z0 + .33], [0, -.78, 1.86], [0, -1.6, 1.88], [0, -2.36, 1.48], [0, -2.78, .72], [0, -2.9, 0], [0, -2.78, -.72], [0, -2.36, -1.48], [0, -1.6, -1.88], [0, -.78, -1.86], [0, -.3, -(z0 + .33)], [0, -.14, -z0]].map(p => new THREE.Vector3(...p));
    const X = new THREE.Vector3(1, 0, 0);
    const t = W.strap, Q = (curve, u) => ({ p: curve.getPointAt(u), T: curve.getTangentAt(u), q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), curve.getTangentAt(u)) });
    // flat strap with rounded edges; width tapers from lug width toward the buckle
    const pad = u => lerp(1.45, 1, 1 - Math.abs(u - .5) * 2); // padded: thicker at the lugs, slimmer at the buckle
    const band = (curve, w0, thick, mat, closed = false) => mk(sweepGeo(curve, u => thick / 2 * pad(u), 1, closed ? 360 : 320, 72, X, { phase: Math.PI, sq: 5, ratioAt: u => lerp(w0, w0 * .82, 1 - Math.abs(u - .5) * 2) / (thick * pad(u)) }), mat);
    const widthAt = (w0, u) => lerp(w0, w0 * .82, 1 - Math.abs(u - .5) * 2);
    const loop = (curve, u, hw, hh, r, mat, lift = 0) => { // rounded-rect hoop around the strap (buckle frame, keepers)
      const { p, T } = Q(curve, u), N = new THREE.Vector3().crossVectors(X, T).normalize(), pts = [];
      for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2, se = v => Math.sign(v) * Math.abs(v) ** (2 / 6); pts.push(p.clone().addScaledVector(X, se(Math.cos(a)) * hw).addScaledVector(N, se(Math.sin(a)) * hh + lift)); }
      return mk(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 96, r, 10, true), mat);
    };
    const tuck = [[0, -.15, G.halfZ + .05], ...base.slice(1, -1).map(v => v.toArray()), [0, -.15, -(G.halfZ + .05)]].map(p => new THREE.Vector3(...p));
    if (t === 'leather' || t === 'rubber' || t === 'mesh') {
      const curve = new THREE.CatmullRomCurve3(tuck), w0 = integ ? 1.15 : 1.02, th = t === 'mesh' ? .06 : t === 'rubber' ? .13 : .11;
      band(curve, w0, th, t === 'mesh' ? meshMat(M.metal) : strapMat(t, W.strapColor, W.strapColor2));
      if (t === 'mesh') { const { p, q } = Q(curve, .5); const cl = mk(new RoundedBoxGeometry(w0 * .86, .09, .55, 3, .03), M.polished); cl.position.copy(p); cl.quaternion.copy(q); return; }
      const wb = widthAt(w0, .5) / 2, keeperMat = new THREE.MeshPhysicalMaterial({ color: W.strapColor, roughness: t === 'rubber' ? .8 : .55, sheen: .2 });
      loop(curve, .5, wb + .05, th / 2 + .05, .024, M.polished, .015);                     // buckle frame
      const { p, T } = Q(curve, .5), N = new THREE.Vector3().crossVectors(X, T).normalize();
      const prong = mk(new THREE.CylinderGeometry(.014, .014, .17, 10), M.polished);         // prong lying on the strap
      prong.position.copy(p).addScaledVector(N, th / 2 + .02).addScaledVector(T, .08); prong.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), T);
      [.465, .44].forEach(u => loop(curve, u, widthAt(w0, u) / 2 + .016, th / 2 + .016, .015, keeperMat)); // keepers
      return;
    }
    if (t === 'nato') {
      const pts = [[0, -.56, 0], [0, -.52, .9], [0, -.08, G.halfZ + .05], ...base.slice(1, -1).map(v => v.toArray()), [0, -.08, -(G.halfZ + .05)], [0, -.52, -.9]].map(p => new THREE.Vector3(...p));
      const curve = new THREE.CatmullRomCurve3(pts, true), w0 = .98, th = .05;
      mk(sweepGeo(curve, () => th / 2, w0 / th, 260, 40, X, { phase: Math.PI, sq: 9 }), strapMat('nato', W.strapColor, W.strapColor2));
      [.36, .46].forEach(u => loop(curve, u, w0 / 2 + .02, th / 2 + .02, .016, M.polished));
      loop(curve, .41, w0 / 2 + .04, th / 2 + .04, .022, M.polished, .01);
      return;
    }
    // link bracelets
    const L = {
      woodlinks: { pitch: .34, th: .17, lw: 1.02, p: [[0, .5, 'A'], [-.38, .24, 'B'], [.38, .24, 'B']] },
      oyster: { pitch: .3, th: .12, lw: 1.02, p: [[0, .32, 'P'], [-.33, .3, 'S'], [.33, .3, 'S']] },
      jubilee: { pitch: .2, th: .11, lw: 1.02, p: [[-.375, .25, 'S'], [.375, .25, 'S'], [-.125, .22, 'P'], [.125, .22, 'P']] },
      integrated: { pitch: .26, th: .13, lw: integ ? 1.2 : 1.04, p: [[0, .16, 'P'], [-.3, .42, 'S'], [.3, .42, 'S']] },
    }[t] || null;
    if (!L) return;
    const mats = t === 'woodlinks' ? { A: watchMat('wood', W.strapWood), B: watchMat('wood', W.strapAccent) } : { P: M.polished, S: M.metal };
    const curve = new THREE.CatmullRomCurve3(base), len = curve.getLength(), n = Math.floor(len / L.pitch);
    // machined links: flat tops, tight chamfer, rows nearly touching (wood links keep a softer edge)
    const wood = t === 'woodlinks', geos = L.p.map(([, w]) => new RoundedBoxGeometry(L.lw * w, L.th, L.pitch * (wood ? .95 : .99), wood ? 5 : 3, wood ? Math.min(.05, L.th * .35) : Math.min(.022, L.th * .18)));
    [0, 1].forEach(u => { const p = curve.getPointAt(u), T = curve.getTangentAt(u), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), T); const e = mk(new RoundedBoxGeometry(L.lw * (integ ? 1 : .98), L.th * 1.15, .34, 4, .05), t === 'woodlinks' ? mats.A : M.polished); e.position.copy(p).addScaledVector(T, u ? .12 : -.12).add(new THREE.Vector3(0, -.02, 0)); e.quaternion.copy(q); }); // solid end links
    for (let i = 0; i < n; i++) {
      const u = (i + .5) / n, p = curve.getPointAt(u), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), curve.getTangentAt(u));
      const taper = lerp(1, t === 'integrated' ? .84 : .88, 1 - Math.abs(u - .5) * 2);
      if (Math.abs(u - .5) < .55 / n) { const c = mk(new RoundedBoxGeometry(L.lw * taper, L.th * .8, L.pitch * 1.8, 3, .03), M.polished); c.position.copy(p); c.quaternion.copy(q); continue; }
      const link = new THREE.Group(); link.position.copy(p); link.quaternion.copy(q); link.scale.set(taper, 1, 1); grp.add(link);
      L.p.forEach(([x, , m], j) => { const pc = mk(geos[j], mats[m], link); pc.position.x = x * L.lw; if (t === 'jubilee' && m === 'P' && i % 2) { if (x < 0) pc.position.x = 0; else pc.visible = false; } }); // jubilee: staggered centre links
    }
  },
  tickHands() {
    if (!this.hands) return;
    const t = new Date(), s = t.getSeconds() + t.getMilliseconds() / 1000, m = t.getMinutes() + s / 60, h = (t.getHours() % 12) + m / 60;
    const quartz = /quartz/i.test(S.current?.watch?.movement || '') && !/meca/i.test(S.current?.watch?.movement || '');
    const ss = quartz ? Math.floor(s) : s; // quartz ticks, mechanical sweeps
    this.hands.s.rotation.y = -ss / 60 * Math.PI * 2; this.hands.m.rotation.y = -m / 60 * Math.PI * 2; this.hands.h.rotation.y = -h / 12 * Math.PI * 2;
    if (this.balance) this.balance.rotation.y = Math.sin(performance.now() / 1000 * Math.PI * 2 * 4) * 1.9; // 4 Hz / 28,800 vph
  },
  /* ---------- output ---------- */
  snap(view, size = 1200) {
    const r = this.renderer, cam = this.camera, prev = { v: this.lastView, p: cam.position.clone(), a: cam.aspect, w: r.domElement.width / r.getPixelRatio(), h: r.domElement.height / r.getPixelRatio(), pr: r.getPixelRatio() };
    const SS = 2; r.setPixelRatio(1); r.setSize(size * SS, size * SS, false); cam.aspect = 1; cam.updateProjectionMatrix();
    if (view) this.view(view);
    r.render(this.scene, cam);
    const out = TEX.canvas(size, size, (x) => { x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(r.domElement, 0, 0, size, size); }); // 2x supersample
    const url = out.toDataURL('image/jpeg', .93);
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
    d.renders = { front: this.snap('front', 1400), back: this.snap(isW ? 'three' : 'back', 1400), three: this.snap('three', 1400) };
    this.scene.background.copy(bg); d.thumb = this.snap('three', 760);
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
      const W = watchSpec(d), woods = Object.entries(WOODS).map(([k, v]) => [k, v.label]), kv = o => Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? v : v.label]);
      const cp = (path, label, val) => `<div class="fld"><label>${label}</label><div class="row"><input type="color" data-bind="${path}" value="${val}"><span class="mono">${String(val).toUpperCase()}</span></div></div>`;
      const band = ['leather', 'rubber', 'nato'].includes(W.strap);
      L.innerHTML = `<div class="sec"><h4><em>A</em>Style presets</h4><div class="grid2">${WATCH_PRESETS.map(([n], i) => `<button class="btn sm" style="white-space:normal;text-align:left;justify-content:flex-start;line-height:1.25" data-wpreset="${i}">${n}</button>`).join('')}</div>
          <p class="hint" style="margin-top:8px">Starting points. Every field below stays editable.</p></div>
        <div class="sec"><h4><em>B</em>Case</h4>
          <div class="fld"><label>Shape</label><div class="seg" data-segbind="watch.shape">${Object.entries(CASE_SHAPES).map(([k, v]) => `<button data-v="${k}" style="padding:7px 2px;font-size:10.5px" class="${k === W.shape ? 'on' : ''}">${v === 'Rectangle' ? 'Rect' : v}</button>`).join('')}</div></div>
          <div style="margin-top:10px">${this.select('watch.caseMat', 'Material', W.caseMat, kv(CASE_MATS))}</div>
          ${W.caseMat === 'wood' ? `<div class="grid2" style="margin-top:10px">${this.select('watch.caseWood', 'Species', W.caseWood, woods)}${this.select('watch.bezel', 'Bezel metal', W.bezel, kv(BEZELS))}</div>` : ''}
          <div style="margin-top:10px">${this.range('watch.dia', 'Case size', W.dia, 34, 46, 1, v => v + ' mm')}</div>
          <div class="grid2" style="margin-top:10px">${this.select('watch.crownGuards', 'Crown guards', W.crownGuards, [['', 'No'], ['1', 'Yes']])}${this.select('watch.crystal', 'Crystal', W.crystal, [['Sapphire', 'Sapphire'], ['Domed sapphire', 'Domed sapphire'], ['Mineral', 'Hardened mineral']])}</div></div>
        <div class="sec"><h4><em>C</em>Bezel</h4>${this.select('watch.bezelStyle', 'Style', W.bezelStyle, kv(BEZEL_STYLES))}
          ${/diver|gmt|tachy/.test(W.bezelStyle) ? `<div class="grid2" style="margin-top:10px">${cp('watch.bezelColor', W.bezelStyle === 'gmt' ? 'Day half' : 'Insert', W.bezelColor)}${W.bezelStyle === 'gmt' ? cp('watch.bezelColor2', 'Night half', W.bezelColor2) : ''}</div>` : ''}
          ${W.shape !== 'round' ? '<p class="hint" style="margin-top:8px">Inserts and gem-setting render on round cases. Shaped cases use a fitted frame.</p>' : ''}</div>
        <div class="sec"><h4><em>D</em>Dial</h4>${this.select('watch.dialStyle', 'Dial style', W.dialStyle, kv(DIAL_STYLES))}
          <div style="margin-top:10px">${this.colorField('watch.dial', 'Dial color', W.dial)}</div>
          <div class="grid2" style="margin-top:12px">${cp('watch.index', 'Indices / hands', W.index)}${cp('watch.accent', 'Seconds hand', W.accent)}</div>
          <div class="grid2" style="margin-top:10px">${this.select('watch.numerals', 'Numerals', W.numerals, kv(NUMERALS))}${this.select('watch.hands', 'Hands', W.hands, kv(HANDS))}</div>
          <div class="grid3" style="margin-top:10px">${this.select('watch.date', 'Date', W.date, [['none', 'None'], ['3', '3 o\'clock'], ['6', '6 o\'clock']])}<div class="fld"><label>Edition N°</label><input class="in mono" type="number" min="1" max="${d.edition || 150}" data-bind="watch.editionNo" data-num value="${W.editionNo}"></div><div class="fld"><label>Cap</label><input class="in mono" type="number" min="1" data-bind="edition" data-num value="${d.edition || 150}"></div></div></div>
        <div class="sec"><h4><em>E</em>Bracelet / strap</h4>${this.select('watch.strap', 'Type', W.strap, kv(STRAPS))}
          ${W.strap === 'woodlinks' ? `<div class="grid2" style="margin-top:10px">${this.select('watch.strapWood', 'Center links', W.strapWood, woods)}${this.select('watch.strapAccent', 'Side links', W.strapAccent, woods)}</div>` : ''}
          ${band ? `<div class="grid2" style="margin-top:10px">${cp('watch.strapColor', 'Strap', W.strapColor)}${W.strap !== 'rubber' ? cp('watch.strapColor2', W.strap === 'nato' ? 'Stripe' : 'Stitch', W.strapColor2) : ''}</div>` : ''}
          ${['oyster', 'jubilee', 'integrated', 'mesh'].includes(W.strap) ? '<p class="hint" style="margin-top:8px">Metal bracelets follow the case metal. Wood or ceramic cases default to steel.</p>' : ''}</div>
        <div class="sec"><h4><em>F</em>Movement & caseback</h4>${this.select('watch.movement', 'Movement', W.movement, MOVEMENTS.map(m => [m, m]))}
          <div style="margin-top:10px">${this.select('watch.wr', 'Water resistance', W.wr, ['3 ATM', '5 ATM', '10 ATM', '20 ATM', '30 ATM'].map(v => [v, v]))}</div>
          <div class="fld" style="margin-top:10px"><label>Caseback engraving</label><input class="in" data-bind="watch.engraving" value="${esc(W.engraving)}"></div></div>`;
    } else {
      const g = d.garment;
      L.innerHTML = `<div class="sec"><h4><em>A</em>Piece</h4>
        <div class="fld"><label>Silhouette</label><div class="seg" data-segbind="category">${(isTop(d.category) ? TOPS : isBottom(d.category) ? BOTTOMS : [d.category]).map(c => `<button data-v="${c}" class="${c === d.category ? 'on' : ''}">${CATS[c].label.replace('Long Sleeve', 'L/S')}</button>`).join('')}</div></div>
        ${d.category === 'socks' ? `<div class="fld" style="margin-top:10px"><label>Style</label><div class="seg" data-segbind="garment.sockStyle">${[['crew', 'Crew'], ['noshow', 'No-show']].map(([k, v]) => `<button data-v="${k}" class="${k === (g.sockStyle || 'crew') ? 'on' : ''}">${v}</button>`).join('')}</div></div>
          <div class="grid2" style="margin-top:10px">${this.select('garment.sockAccent', 'Contrast heel & toe', g.sockAccent ?? '1', [['1', 'Yes'], ['', 'No']])}${g.sockStyle === 'noshow' ? '' : this.select('garment.sockCuff', 'Contrast cuff', g.sockCuff || '', [['1', 'Yes'], ['', 'No']])}</div>
          ${g.sockStyle === 'noshow' ? '' : `<div class="grid2" style="margin-top:10px">${this.select('garment.stripes', 'Cuff stripes', String(g.stripes || 0), [['0', 'None'], ['1', '1 stripe'], ['2', '2 stripes'], ['3', '3 stripes'], ['4', '4 stripes']])}<div class="fld"><label>Stripe color</label><div class="row"><input type="color" data-bind="garment.stripeCol" value="${g.stripeCol || '#B98A4A'}"><span class="mono">${(g.stripeCol || '#B98A4A').toUpperCase()}</span></div></div></div>`}` : `<div class="fld" style="margin-top:10px"><label>Fit</label><div class="seg" data-segbind="garment.fit">${Object.entries(FITS).map(([k, v]) => `<button data-v="${k}" class="${k === g.fit ? 'on' : ''}">${v.label}</button>`).join('')}</div></div>`}
        <div style="margin-top:10px">${this.select('garment.fabric', 'Fabric', g.fabric, Object.entries(FABRICS).filter(([k, v]) => k === g.fabric || v.for === 'any' || v.for === (isTop(d.category) ? 'top' : d.category === 'socks' ? 'socks' : d.category === 'boxers' ? 'boxers' : 'bottom')).map(([k, v]) => [k, v.label]))}</div>
        <div class="grid2" style="margin-top:10px">${this.select('garment.finish', 'Wash / finish', g.finish || 'none', Object.entries(FINISHES).map(([k, v]) => [k, v.label]))}${this.select('garment.distress', 'Distressing', g.distress || 'none', Object.entries(DISTRESS).map(([k, v]) => [k, v.label]))}</div>
        <div class="fld" style="margin-top:12px"><label>3D model<b>${g.model ? 'Uploaded GLB' : Models.peek(d) ? 'Studio default' : 'Built-in shape'}</b></label>
          <div class="grid2"><button class="btn sm" id="mdlUp">Upload GLB</button>${g.model ? '<button class="btn sm" id="mdlRm">Remove</button>' : `<span class="hint" style="align-self:center">CLO · Marvelous · marketplace</span>`}</div>
          ${g.model || Models.peek(d) ? `<div style="margin-top:8px">${this.select('garment.modelRot', 'Facing', g.modelRot || 0, [[0, 'As exported'], [90, 'Rotate 90°'], [180, 'Rotate 180°'], [270, 'Rotate 270°']])}</div>` : ''}</div></div>
        <div class="sec"><h4><em>B</em>Color</h4>${this.colorField('garment.color', 'Body', g.color)}<div class="grid2" style="margin-top:10px">${this.select('garment.pattern', 'Fabric pattern', g.pattern || 'solid', Object.entries(PATTERNS))}${g.pattern && g.pattern !== 'solid' ? this.range('garment.plaidScale', 'Scale', num(g.plaidScale) || 1, .4, 3, .1) : ''}</div>${(g.pattern && g.pattern !== 'solid') || g.doubleWB === '1' ? `<div class="grid3" style="margin-top:8px"><div class="fld"><label>Ground</label><input type="color" data-bind="garment.plaid1" value="${g.plaid1 || '#14172B'}"></div><div class="fld"><label>Stripe</label><input type="color" data-bind="garment.plaid2" value="${g.plaid2 || '#B98A4A'}"></div><div class="fld"><label>Accent</label><input type="color" data-bind="garment.plaid3" value="${g.plaid3 || '#EEF1F9'}"></div></div>` : ''}${d.category === 'pants' || d.category === 'shorts' ? `<div class="grid2" style="margin-top:10px">${this.select('garment.doubleWB', 'Double waistband', g.doubleWB || '', [['', 'No'], ['1', 'Yes']])}${g.doubleWB === '1' ? this.select('garment.wb2Pattern', 'Band 2 fabric', g.wb2Pattern || 'plaid', [['plaid', 'Plaid'], ['solid', 'Solid']]) : ''}</div>${g.doubleWB === '1' ? `<div class="grid2" style="margin-top:8px">${this.range('garment.wb2H', 'Band 2 height', num(g.wb2H) || 1.75, .75, 4, .125, v => frac(v) + '"')}<div class="fld"><label>Band 2 solid</label><input type="color" data-bind="garment.wb2Color" value="${g.wb2Color || '#B98A4A'}"></div></div>` : ''}` : ''}
          <div class="grid2" style="margin-top:12px"><div class="fld"><label>${d.category === 'socks' ? 'Cuff' : isBottom(d.category) ? 'Waistband / trim' : 'Rib / trim'}</label><div class="row"><input type="color" data-bind="garment.trim" value="${g.trim}"><button class="btn sm" data-copy="garment.trim">= Body</button></div></div>
          <div class="fld"><label>${d.category === 'socks' ? 'Heel / toe' : 'Stitch'}</label><div class="row"><input type="color" data-bind="garment.stitch" value="${g.stitch}"><button class="btn sm" data-copy="garment.stitch">= Body</button></div></div></div></div>
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
    const up = $('#mdlUp');
    if (up) up.onclick = () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.glb,model/gltf-binary';
      inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return;
        if (f.size > 40e6) return toast('Model over 40 MB — decimate it first', true);
        d.garment.model = await Assets.put(await fileToDataURL(f), f.name); touch();
        await Models.load(d); if (!Models.peek(d)) { d.garment.model = ''; touch(); return toast('Could not read that GLB', true); }
        Studio.build(); this.studio(); toast('Model loaded: ' + f.name);
      };
      inp.click();
    };
    const rm = $('#mdlRm'); if (rm) rm.onclick = () => { d.garment.model = ''; touch(); Studio.build(); this.studio(); };
    $$('[data-preset]', L).forEach(b => b.onclick = () => { const [s, i] = b.dataset.preset.split(':'); Object.assign(d.place[s], PLACE_PRESETS[s][i][1]); touch(); Studio.updateDecals(); this.studio(); });
    $('#sPng').onclick = () => Studio.exportPNG();
    $('#sGlb').onclick = () => Studio.exportGLB();
    $('#cwAdd').onclick = () => { const hex = d.category === 'watch' ? WOODS[d.watch.caseWood].a : d.garment.color; d.colorways.push(row({ name: 'Colorway ' + (d.colorways.length + 1), hex, pantone: '', notes: d.category === 'watch' ? `${WOODS[d.watch.caseWood].label} / ${WOODS[d.watch.strapAccent].label}` : '' })); touch(); this.studio(); };
    $$('[data-cw]', R).forEach(el => el.onclick = () => { const c = d.colorways.find(x => x.id === el.dataset.cw); if (d.category === 'watch') return; d.garment.color = c.hex; touch(); Studio.build(); this.studio(); });
    $$('[data-wpreset]', L).forEach(b => b.onclick = () => { Object.assign(d.watch, WATCH_PRESETS[b.dataset.wpreset][1]); touch(); Studio.build(); this.studio(); toast(WATCH_PRESETS[b.dataset.wpreset][0] + ' applied'); });
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
  if (/^watch\.(caseMat|bezelStyle|strap|dialStyle)$|^garment\.(pattern|doubleWB|wb2Pattern|sockStyle)$/.test(path)) { Studio.build(); Panels.studio(); return; }
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
    if (p === 'category') {
      const d = S.current, cat = d.category; d.place.front.s = clamp(d.place.front.s, .2, 1.6);
      // a different silhouette needs its own POM / BOM / construction when the measurement set differs
      const pom = presetPOM(cat), codes = x => x.rows.map(r => r.code).join();
      if (codes(pom) !== codes(d.pom)) { d.pom = pom; d.bom = presetBOM(cat); d.construction = presetConstruction(cat); toast(`Specs switched to the ${CATS[cat].label} template`); }
      d.styleNo = d.styleNo.replace(/^DPP-[A-Z]{2}-/, `DPP-${CATS[cat].code}-`);
      renderCtx();
    }
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
    const isW = d.category === 'watch', g = d.garment, W = watchSpec(d), f = FABRICS[g.fabric];
    const spec = isW
      ? (() => { const sw = h => `<span class="tp-sw" style="background:${h}"></span>${h.toUpperCase()}`; return [
        ['Case', `${CASE_SHAPES[W.shape]} · ${W.dia} mm · ${W.caseMat === 'wood' ? WOODS[W.caseWood].label : CASE_MATS[W.caseMat].label}`],
        ['Crown', W.crownGuards ? 'Screw-down style, with guards' : 'Push-pull'],
        ['Bezel', W.shape === 'round' ? BEZEL_STYLES[W.bezelStyle] + (/diver|gmt|tachy/.test(W.bezelStyle) ? ' · ' + sw(W.bezelColor) + (W.bezelStyle === 'gmt' ? ' / ' + sw(W.bezelColor2) : '') : '') : 'Fitted frame'],
        ['Dial', `${DIAL_STYLES[W.dialStyle].label} · ${sw(W.dial)}`],
        ['Numerals / hands', `${NUMERALS[W.numerals]} · ${HANDS[W.hands]} · ${sw(W.index)}`],
        ['Seconds / date', `${sw(W.accent)} · date ${W.date === 'none' ? 'none' : 'at ' + W.date}`],
        ['Movement', W.movement], ['Crystal / WR', `${W.crystal} · ${W.wr}`],
        ['Strap', STRAPS[W.strap] + (W.strap === 'woodlinks' ? `: ${WOODS[W.strapWood].label} / ${WOODS[W.strapAccent].label}` : ['leather', 'rubber', 'nato'].includes(W.strap) ? ' · ' + sw(W.strapColor) : '')],
        ['Edition', `N° ${String(W.editionNo).padStart(3, '0')} of ${d.edition || 150}`], ['Caseback', esc(W.engraving)]]; })()
      : [['Body fabric', `${f.label} · ${f.comp}`], ['Fit', FITS[g.fit].label], ['Wash / finish', FINISHES[g.finish || 'none'].label], ...(d.category === 'socks' ? [['Sock style', g.sockStyle === 'noshow' ? 'No-show' : 'Crew'], ['Heel & toe', g.sockAccent === '1' ? `<span class="tp-sw" style="background:${g.stitch}"></span>${g.stitch.toUpperCase()}` : 'Self'], ['Cuff', g.sockCuff === '1' ? `<span class="tp-sw" style="background:${g.trim}"></span>${g.trim.toUpperCase()}` : 'Self'], ['Cuff stripes', num(g.stripes) ? ` × 1/2" · <span class="tp-sw" style="background:${g.stripeCol}"></span>${String(g.stripeCol).toUpperCase()}` : 'None']] : []), ...(g.pattern && g.pattern !== 'solid' ? [['Fabric pattern', ` · <span class="tp-sw" style="background:${g.plaid1}"></span><span class="tp-sw" style="background:${g.plaid2}"></span><span class="tp-sw" style="background:${g.plaid3}"></span>`]] : []), ...(g.doubleWB === '1' ? [['Waistband 2', `Stacked above main band · ${frac(num(g.wb2H) || 1.75)}" · ${g.wb2Pattern === 'plaid' ? 'plaid' : g.wb2Color}`]] : []), ['Distressing', DISTRESS[g.distress || 'none'].label], ['Body color', `<span class="tp-sw" style="background:${g.color}"></span>${g.color.toUpperCase()}`], ['Rib / trim', `<span class="tp-sw" style="background:${g.trim}"></span>${g.trim.toUpperCase()}`], ['Thread', `<span class="tp-sw" style="background:${g.stitch}"></span>${g.stitch.toUpperCase()} · tonal`], ['Front print', `${d.place.front.tech}${d.artwork.front.length ? '' : ' — no art'}`], ['Back print', `${d.place.back.tech}${d.artwork.back.length ? '' : ' — no art'}`]];
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
  const isW = d.category === 'watch', g = d.garment, W = watchSpec(d);
  if (isW) {
    const mat = W.caseMat === 'wood' ? WOODS[W.caseWood].label.toLowerCase() + ' wood' : CASE_MATS[W.caseMat].label.toLowerCase();
    const dialTxt = { skeleton: 'fully skeletonized dial exposing the gears, bridges and red jewels of the movement', openheart: 'open-heart dial with a cut-out at 9 o\'clock showing the beating balance wheel', panda: 'panda chronograph dial with three contrasting sub-dials', rpanda: 'reverse-panda chronograph dial with three light sub-dials', sector: 'sector dial with concentric zones and a crosshair', guilloche: 'guilloché tapisserie-pattern dial', sunburst: 'sunburst dial', fume: 'fumé gradient dial fading to black at the edge', tropical: 'aged tropical dial with brown fading', enamel: 'glossy enamel dial', linen: 'linen-texture dial' }[W.dialStyle] || 'matte dial';
    const strapTxt = { woodlinks: `three-piece wood link bracelet in ${WOODS[W.strapWood].label.toLowerCase()} with ${WOODS[W.strapAccent].label.toLowerCase()} side links`, oyster: 'three-link oyster-style bracelet, brushed outer links and polished centre', jubilee: 'five-link jubilee-style bracelet', integrated: 'integrated H-link bracelet flowing from the case', mesh: 'Milanese mesh bracelet', leather: `${colorName(W.strapColor)} leather strap with ${colorName(W.strapColor2)} stitching`, rubber: `${colorName(W.strapColor)} FKM rubber strap`, nato: `${colorName(W.strapColor)} NATO strap with a ${colorName(W.strapColor2)} stripe` }[W.strap];
    const bez = W.shape !== 'round' ? '' : { diver: `, unidirectional diver bezel with ${colorName(W.bezelColor)} 60-minute insert`, gmt: `, 24-hour GMT bezel split ${colorName(W.bezelColor)} and ${colorName(W.bezelColor2)}`, tachy: `, ${colorName(W.bezelColor)} tachymeter bezel`, fluted: ', fluted polished bezel', gem: ', fully gem-set iced-out bezel', none: ', slim bezel-less case' }[W.bezelStyle] || '';
    return `a ${W.dia} mm ${CASE_SHAPES[W.shape].toLowerCase()} wristwatch in ${mat}${bez}${W.crownGuards ? ', crown guards' : ''}; ${colorName(W.dial)} (${W.dial}) ${dialTxt}, ${NUMERALS[W.numerals].toLowerCase()}, ${HANDS[W.hands].toLowerCase()} hands in ${colorName(W.index)}, ${colorName(W.accent)} seconds hand${W.date !== 'none' ? `, date window at ${W.date} o'clock` : ''}; ${strapTxt}. Small text "N° ${String(W.editionNo).padStart(3, '0')}/${d.edition || 150}" on the dial. Sapphire crystal with crisp reflections, precise machining, realistic metal finishing`;
  }
  const noun = { tee: 'T-shirt', longsleeve: 'long-sleeve T-shirt', crewneck: 'crewneck sweatshirt', hoodie: 'pullover hoodie', pants: 'pair of straight-leg pants', shorts: 'pair of shorts', boxers: 'pair of boxer briefs', socks: d.garment.sockStyle === 'noshow' ? 'pair of no-show socks' : 'pair of crew socks' }[d.category];
  const f = FABRICS[g.fabric], fit = FITS[g.fit].label.toLowerCase();
  const build = { tee: 'ribbed crew neck, dropped shoulders, twin-needle hems', longsleeve: 'ribbed crew neck, ribbed cuffs', crewneck: 'ribbed crew neck, ribbed cuffs and waistband', hoodie: 'lined hood with flat drawcords and metal aglets, kangaroo pocket, ribbed cuffs and waistband', pants: 'five-pocket construction, belt loops, shank button' + (d.garment.doubleWB === '1' ? ', a second exposed waistband stacked above the main waistband' : ''), shorts: 'elastic waistband with drawcords, side pockets' + (d.garment.doubleWB === '1' ? ', a second exposed waistband above the main band' : ''), boxers: 'jacquard elastic waistband, contoured pouch', socks: 'ribbed cuff, Y-heel, terry footbed' + (d.garment.sockAccent === '1' ? ', contrast heel and toe' : '') + (num(d.garment.stripes) ? `, ${d.garment.stripes} athletic stripes below the cuff` : '') }[d.category];
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
  const d = S.current, ids = new Set([...d.refs, ...(d.garment?.model ? [d.garment.model] : []), ...['front', 'back'].flatMap(s => d.artwork[s].filter(l => l.asset).map(l => l.asset))]);
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

window.DPP = { Studio, S, Models }; // console debug handle (internal tool)
(async function boot() {
  await Mark.init();
  await gate();
  await DB.open();
  S.designs = await DB.all('designs');
  wire(); renderCtx(); Library.render();
  document.fonts.ready.then(() => { if (S.view === 'artwork') Art.render(); });
})();
