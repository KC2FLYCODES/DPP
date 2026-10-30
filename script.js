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
  scarf: { label: 'Scarf', code: 'SC', msrp: null },
  duffle: { label: 'Duffle', code: 'DF', msrp: null },
  balaclava: { label: 'Balaclava', code: 'BL', msrp: null },
  watch: { label: 'Watch', code: 'WT', msrp: 221 }, // The Teranga, Drop 001 — price per draft site
};
const STATUSES = ['Concept', 'Sampling', 'Revision', 'Approved', 'Production'];
const TECHNIQUES = ['Screen print', 'Puff print', 'Discharge', 'DTG', 'Flat embroidery', '3D puff embroidery', 'Tonal embroidery', 'Chenille patch', 'Woven patch', 'Heat transfer', 'Deboss (pressed)', 'Emboss (raised)', 'Foil stamp'];
const pressMode = t => /Deboss/.test(t) ? 'deboss' : /Emboss/.test(t) ? 'emboss' : /Foil stamp/.test(t) ? 'foil' : null;
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
  pebble: { label: 'Pebble-grain leather · 1.4 mm', gsm: 0, comp: 'Full-grain cowhide, pebble embossed, chrome-tanned', rough: .55, sheen: .12, bump: 1.1, coat: .15, leather: 1, for: 'bag' },
  smooth: { label: 'Smooth full-grain leather', gsm: 0, comp: 'Full-grain cowhide, aniline finish', rough: .36, sheen: .1, bump: .25, coat: .35, leather: 1, for: 'bag' },
  suede: { label: 'Suede', gsm: 0, comp: 'Split cowhide suede, brushed', rough: .97, sheen: .9, bump: .5, leather: 1, for: 'bag' },
  waxcanvas: { label: 'Waxed canvas · 16 oz', gsm: 542, comp: '100% cotton duck, paraffin-wax finish', rough: .62, sheen: .15, bump: 1.2, weave: 'canvas', k: 2, for: 'bag' },
  ballistic: { label: 'Ballistic nylon · 1680D', gsm: 400, comp: '1680D ballistic nylon, PU-coated back', rough: .5, sheen: .25, bump: 1.4, weave: 'canvas', k: 3, for: 'bag' },
  linen: { label: 'Linen · 7 oz', gsm: 237, comp: '100% European linen', rough: .88, sheen: .15, bump: 1, weave: 'linen', tint: 1, k: 1.2, for: 'bottom' },
  modal: { label: 'Micro modal · 190 gsm', gsm: 190, comp: '92% modal / 8% elastane', rough: .55, sheen: .7, bump: .3, for: 'boxers' },
  merino: { label: 'Merino rib · 2×2, 240 gsm', gsm: 240, comp: '100% extra-fine merino wool, 2×2 rib', rough: .96, sheen: .55, bump: 1.3, knit: 'rib', k: 1.8, for: 'acc' },
  polar: { label: 'Polar fleece · 280 gsm', gsm: 280, comp: '100% recycled polyester, double-brushed anti-pill', rough: .99, sheen: 1, bump: .35, knit: 'fleece', for: 'acc' },
  cableknit: { label: 'Chunky knit · 5 gg', gsm: 0, comp: '70% wool / 30% nylon, 5-gauge', rough: .97, sheen: .5, bump: 2.4, knit: 'rib', k: .6, for: 'acc' },
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
const MOVEMENTS = ['Miyota 2035 · quartz', 'Miyota 8215 · automatic', 'Miyota 82S7 · open-heart automatic', 'Seiko NH35A · automatic', 'Seiko NH34 · GMT automatic', 'Seiko NH38 · skeleton automatic', 'Sellita SW200 · automatic', 'Seiko VK63 · meca-quartz chrono', 'Digital quartz module · 10-yr battery', 'Ana-digi quartz module'];

/* =========================================================================
   2b. Bottoms, underwear, socks — specs, flats, fabric patterns
   ========================================================================= */
const TOPS = ['tee', 'longsleeve', 'crewneck', 'hoodie'], BOTTOMS = ['pants', 'shorts', 'boxers'];
const isTop = c => TOPS.includes(c), isBottom = c => BOTTOMS.includes(c);
const PATTERNS = { solid: 'Solid', plaid: 'Plaid / tartan', gingham: 'Gingham check', pinstripe: 'Pinstripe', camo: 'Woodland camo' };
const ACCESSORIES = ['scarf', 'balaclava', 'duffle'], isAcc = c => ACCESSORIES.includes(c);
function bottomsPOM(cat) {
  if (cat === 'duffle') return { unit: 'in', sizes: ['Mini', 'Weekender', 'Large'], base: 'Weekender', rows: [row({ code: 'A', desc: 'Length, end panel to end panel', tol: .25, base: 22, grade: 4 }), row({ code: 'B', desc: 'Height at centre, base to zip', tol: .25, base: 11, grade: 2 }), row({ code: 'C', desc: 'Depth (end panel width)', tol: .25, base: 10.5, grade: 2 }), row({ code: 'D', desc: 'Handle drop, zip to top of handle', tol: .25, base: 8.5, grade: .5 }), row({ code: 'E', desc: 'Handle strap width', tol: .0625, base: 1.5, grade: 0 }), row({ code: 'F', desc: 'Shoulder strap length, adjustable max', tol: .5, base: 52, grade: 0 }), row({ code: 'G', desc: 'Shoulder strap width', tol: .0625, base: 1.25, grade: 0 }), row({ code: 'H', desc: 'Zip opening length', tol: .25, base: 20, grade: 4 })] };  if (cat === 'scarf') return { unit: 'in', sizes: ['OS'], base: 'OS', rows: [row({ code: 'A', desc: 'Drape height as styled (3D reference)', tol: .5, base: 16, grade: 0 }), row({ code: 'S1', desc: 'Length, end to end', tol: 1, base: 70, grade: 0 }), row({ code: 'S2', desc: 'Width', tol: .5, base: 12, grade: 0 }), row({ code: 'S3', desc: 'Hood depth (wrap style)', tol: .5, base: 13, grade: 0 }), row({ code: 'S4', desc: 'Edge finish width', tol: .0625, base: .25, grade: 0 })] };
  if (cat === 'balaclava') return { unit: 'in', sizes: ['S/M', 'L/XL'], base: 'S/M', rows: [row({ code: 'A', desc: 'Total height, crown to hem', tol: .5, base: 13, grade: .5 }), row({ code: 'B1', desc: 'Head ½, relaxed', tol: .25, base: 10, grade: .5 }), row({ code: 'E1', desc: 'Eye opening width', tol: .25, base: 6.5, grade: .25 }), row({ code: 'E2', desc: 'Eye opening height', tol: .125, base: 2.5, grade: 0 }), row({ code: 'N1', desc: 'Neck ½, relaxed', tol: .25, base: 6.5, grade: .25 }), row({ code: 'H1', desc: 'Hem width ½ (bib)', tol: .5, base: 9, grade: .5 })] };
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
  if (cat === 'duffle') return [row({ component: 'Shell', material: 'Per fabric choice (pebble / smooth full-grain / suede / waxed canvas / ballistic)', supplier: '', spec: '1.4 mm, chrome-tanned', qty: 14, uom: 'sq ft', cost: 0 }), row({ component: 'Trim leather', material: 'Smooth full-grain, edge-painted', supplier: '', spec: 'Handles, straps, piping, tag', qty: 5, uom: 'sq ft', cost: 0 }), row({ component: 'Lining', material: 'Cotton twill, printed DPP jacquard', supplier: '', spec: 'With slip + zip pocket', qty: 1.25, uom: 'yd', cost: 0 }), row({ component: 'Zipper', material: '#8 metal, two-way', supplier: '', spec: '20 in, finish per hardware', qty: 1, uom: 'pc', cost: 0 }), row({ component: 'D-rings', material: 'Solid brass, plated per hardware', supplier: '', spec: '1.5 in', qty: 6, uom: 'pc', cost: 0 }), row({ component: 'Snap hooks', material: 'Swivel snap hook', supplier: '', spec: '1.25 in', qty: 2, uom: 'pc', cost: 0 }), row({ component: 'Rivets / feet', material: 'Double-cap rivets, base studs', supplier: '', spec: '', qty: 12, uom: 'pc', cost: 0 }), row({ component: 'Shoulder pad', material: 'Leather over foam, non-slip back', supplier: '', spec: '6 × 2 in', qty: 1, uom: 'pc', cost: 0 }), row({ component: 'Logo stamp', material: 'Brass deboss die / foil', supplier: '', spec: 'From artwork file', qty: 1, uom: 'pc', cost: 0 }), row({ component: 'Packaging', material: 'Cotton dust bag + tissue', supplier: '', spec: '', qty: 1, uom: 'pc', cost: 0 })];  if (cat === 'scarf') return [row({ component: 'Body', material: 'Per fabric choice (jersey / brushed knit / wool blend)', supplier: '', spec: 'Cut on grain', qty: 2, uom: 'yd', cost: 0 }), row({ component: 'Edge finish', material: 'Rolled hem / overlock', supplier: '', spec: 'Per S4', qty: 1, uom: 'pc', cost: 0 }), row({ component: 'Woven label', material: 'Damask, DPP mark', supplier: '', spec: 'Corner', qty: 1, uom: 'pc', cost: 0 }), row({ component: 'Packaging', material: 'Recycled sleeve', supplier: '', spec: 'Folded 10 × 10 in', qty: 1, uom: 'pc', cost: 0 })];
  if (cat === 'balaclava') return [row({ component: 'Body', material: 'Rib knit 95% cotton / 5% spandex or merino', supplier: '', spec: 'Per fabric choice', qty: .4, uom: 'yd', cost: 0 }), row({ component: 'Eye binding', material: 'Self-fabric binding 3/8 in', supplier: '', spec: 'Clean finish', qty: .4, uom: 'yd', cost: 0 }), row({ component: 'Woven label', material: 'Damask, DPP mark', supplier: '', spec: 'Back neck / side', qty: 1, uom: 'pc', cost: 0 }), row({ component: 'Packaging', material: 'Header card + polybag', supplier: '', spec: '', qty: 1, uom: 'pc', cost: 0 })];
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
  if (cat === 'duffle') return [row({ area: 'Body', method: 'Turned construction, piped end panels', spi: '8', notes: 'Bonded nylon thread #138.' }), row({ area: 'Handles', method: 'Rolled over cord core, hand-stitched closure', spi: '7', notes: 'Riveted through D-ring tabs.' }), row({ area: 'Handle straps', method: 'Edge-painted, topstitched, wrap under base', spi: '8', notes: 'Load-bearing; reinforce at base.' }), row({ area: 'Logo', method: 'Heat deboss / emboss / foil stamp', spi: '', notes: 'Die from artwork; test on offcut first.' }), row({ area: 'Base', method: 'Board stiffener + 4 metal feet', spi: '', notes: '' })];  if (cat === 'scarf') return [row({ area: 'Edges', method: 'Rolled hem or 3-thread overlock', spi: '14', notes: 'Hood seam if wrap style.' }), row({ area: 'Finish', method: 'Garment wash, press', spi: '', notes: '' })];
  if (cat === 'balaclava') return [row({ area: 'Crown / back', method: 'Flatlock seams', spi: '14', notes: 'No ridge against the head.' }), row({ area: 'Eye opening', method: 'Self binding, coverstitch', spi: '12', notes: 'Per E1/E2.' }), row({ area: 'Hem', method: 'Coverstitch 3/4 in', spi: '12', notes: '' })];
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
  if (d.category === 'balaclava') return s + `<path d="M200 10 C120 10 90 80 92 170 C94 250 110 300 100 380 L300 380 C290 300 306 250 308 170 C310 80 280 10 200 10Z" fill="${fill}"/>` + (front ? `<path d="M140 150 C160 128 240 128 260 150 C250 178 150 178 140 150Z" fill="#1a1a1a"/><path d="M140 150 C160 128 240 128 260 150 C250 178 150 178 140 150Z" stroke-dasharray="3 2.5"/>` : '<path d="M200 14 V376" stroke-dasharray="3 2.5"/>') + '<path d="M104 360 H296" stroke-dasharray="3 2.5"/></svg>';
  if (d.category === 'duffle') { const t = g.trim && g.trim !== '#EEF1F9' ? g.trim : shade(fill, -.06);
    return s + (front ? `<path d="M150 200 C150 90 250 90 250 200" stroke="${t}" stroke-width="9" fill="none"/><path d="M150 200 C150 90 250 90 250 200" fill="none"/><path d="M40 230 C40 190 70 175 110 172 L290 172 C330 175 360 190 360 230 L360 360 C360 375 350 382 335 382 L65 382 C50 382 40 375 40 360Z" fill="${fill}"/><path d="M48 232 C48 196 74 183 110 180 L290 180 C326 183 352 196 352 232" stroke-dasharray="3 2.5"/><rect x="138" y="172" width="22" height="210" fill="${t}"/><rect x="240" y="172" width="22" height="210" fill="${t}"/><path d="M141 176 V378 M157 176 V378 M243 176 V378 M259 176 V378" stroke-dasharray="3 2.5"/><circle cx="149" cy="196" r="5"/><circle cx="251" cy="196" r="5"/><path d="M262 214 l36 18 v52 l-36 0Z" fill="${t}"/><path d="M40 250 C10 300 60 420 200 430 C340 420 390 300 360 250" fill="none" stroke-width="2.2"/>`
      : `<path d="M90 120 C90 70 310 70 310 120 L310 360 C310 375 300 382 285 382 L115 382 C100 382 90 375 90 360Z" fill="${fill}"/><path d="M100 128 C100 84 300 84 300 128 L300 356 C300 368 292 372 282 372 L118 372 C108 372 100 368 100 356Z" stroke-dasharray="3 2.5"/><path d="M200 60 V100" stroke-width="2.4"/><circle cx="200" cy="200" r="8"/><text x="200" y="420" text-anchor="middle" font-size="12" fill="${stroke}" stroke="none">END PANEL</text>`) + '</svg>'; }
  if (d.category === 'scarf') return s + `<path d="M120 30 C160 0 240 0 280 30 L300 200 C260 240 140 240 100 200Z" fill="${fill}"/><path d="M150 200 L130 420 L190 420 L200 230Z" fill="${shade(fill, -.06)}"/><path d="M250 200 L270 420 L210 420 L200 230Z" fill="${fill}"/><path d="M130 412 H190 M210 412 H270" stroke-dasharray="3 2.5"/></svg>`;
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
  if (isBottom(cat) || cat === 'socks' || isAcc(cat)) return bottomsPOM(cat);
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
  if (isBottom(cat) || cat === 'socks' || isAcc(cat)) return bottomsBOM(cat);
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
  if (isBottom(cat) || cat === 'socks' || isAcc(cat)) return bottomsConstruction(cat);
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
    garment: { color: cat === 'duffle' ? '#1b1b1e' : '#EEF1F9', trim: cat === 'duffle' ? '' : '#EEF1F9', stitch: cat === 'socks' ? '#14172B' : '#EEF1F9', fabric: { hoodie: 'fleece', crewneck: 'fleece', pants: 'denim', shorts: 'twill', boxers: 'modal', socks: 'sockknit', duffle: 'pebble', balaclava: 'merino', scarf: 'merino' }[cat] || 'heavy', fit: 'boxy', finish: 'none', distress: 'none', pattern: 'solid', sockStyle: 'crew', sockAccent: '1', sockCuff: '', stripes: 0, stripeCol: '#B98A4A', plaid1: '#14172B', plaid2: '#B98A4A', plaid3: '#EEF1F9', plaidScale: 1, doubleWB: '', wb2Color: '#B98A4A', wb2Pattern: 'plaid', wb2H: 1.75 },
    watch: { ...WATCH_DEFAULT },
    place: cat === 'duffle' ? { front: { dx: 0, top: .4, s: .8, r: 0, tech: 'Deboss (pressed)' }, back: { dx: 0, top: 3, s: .5, r: 0, tech: 'Deboss (pressed)' } } : cat === 'socks' ? { front: { dx: 0, top: 2, s: .25, r: 0, tech: 'Flat embroidery' }, back: { dx: 0, top: 2, s: .25, r: 0, tech: 'Flat embroidery' } } : { front: { dx: 0, top: 3, s: 1, r: 0, tech: 'Screen print' }, back: { dx: 0, top: 4, s: 1, r: 0, tech: 'Screen print' } },
    artwork: cat === 'duffle' ? { front: [{ id: uid('l'), x: 512, y: 512, rot: 0, opacity: 1, hidden: false, locked: false, type: 'mark', name: 'DPP mark (stamp)', w: 640, h: 640 / (Mark.aspect || 1), color: '#000000' }], back: [] } : { front: [], back: [] },
    colorways: [row({ name: 'Main', hex: isW ? WOODS.walnut.a : cat === 'duffle' ? '#1b1b1e' : '#EEF1F9', pantone: '', notes: '' })],
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
const MODEL_CAL = { tee: .965, longsleeve: .965, crewneck: .965, hoodie: .74, pants: 1, shorts: 1, boxers: 1, socks: 1, scarf: 1, balaclava: 1 };
// default files that bundle a body or a second garment: keep only these node names
const MODEL_KEEP = { shorts: ['Object_6'], pants: ['Object_573'] };
// default models whose normal maps carry baked-in logos — use geometry folds only
const MODEL_NO_NORMAL = ['pants', 'balaclava']; // balaclava: its baked map carries scan streaks; the rib relief comes from the fabric shader
// default facing fixes (degrees) for models exported facing sideways
const MODEL_ROT = { balaclava: -90 };
const HEAD_LIFT = .05; // model heads sit slightly above our dial so the hands clear inside the case
// Garment meshes: per-design upload (garment.model asset id) or studio default at assets/models/<category>.glb
const Models = {
  cache: new Map(), // key -> THREE.Object3D | null (null = not available); absent while loading
  pending: new Map(),
  file(d) { const g = d.garment; return d.category === 'socks' && g.sockStyle === 'noshow' ? 'socks-noshow' : d.category === 'pants' && g.pantStyle === 'slim' ? 'pants-slim' : d.category; },
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
  if (isBottom(d.category) || d.category === 'socks' || isAcc(d.category)) return bottomsFlat(d, side, stroke);
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
    const grp = d => S.filter === 'all' || d.category === S.filter || (S.filter === 'tops' && isTop(d.category)) || (S.filter === 'bottoms' && isBottom(d.category)) || (S.filter === 'acc' && (isAcc(d.category) || d.category === 'socks'));
    const list = S.designs.filter(d => grp(d) && (!st || d.status === st)
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
  // stamped logos: the art only supplies the shape; colour comes from the material (darker + burnished when pressed, gold foil)
  press(art, base, mode) { const N = art.width, mk = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c; }, solid = (src, col) => { const c = mk(), x = c.getContext('2d'); x.drawImage(src, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, N, N); return c; };
    const mask = solid(art, '#fff'), map = mk(), m = map.getContext('2d'); m.fillStyle = base; m.fillRect(0, 0, N, N); m.drawImage(solid(art, mode === 'foil' ? '#C9A24A' : shade(base, mode === 'deboss' ? -.22 : .04)), 0, 0);
    const alpha = mk(), a = alpha.getContext('2d'); a.fillStyle = '#000'; a.fillRect(0, 0, N, N); a.filter = 'blur(9px)'; for (let i = 0; i < 4; i++) a.drawImage(mask, 0, 0); a.filter = 'none'; a.drawImage(mask, 0, 0);
    const bump = mk(), b = bump.getContext('2d'); b.fillStyle = mode === 'emboss' ? '#000' : '#fff'; b.fillRect(0, 0, N, N); b.filter = 'blur(2.5px)'; b.drawImage(solid(art, mode === 'emboss' ? '#fff' : '#000'), 0, 0);
    let metal = null; if (mode === 'foil') { metal = mk(); const t = metal.getContext('2d'); t.fillStyle = '#000'; t.fillRect(0, 0, N, N); t.drawImage(mask, 0, 0); metal = new THREE.CanvasTexture(metal); }
    const map3 = new THREE.CanvasTexture(map); map3.colorSpace = THREE.SRGBColorSpace; map3.anisotropy = 16;
    return { mode, map: map3, alpha: new THREE.CanvasTexture(alpha), bump: new THREE.CanvasTexture(bump), metal }; },
  // leather grain: pebble = packed soft cells, smooth = faint pores, suede = fine nap
  grain(kind) { const key = 'grain_' + kind; if (this[key]) return this[key]; const N = 512, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d');
    x.fillStyle = '#808080'; x.fillRect(0, 0, N, N); const cnt = kind === 'pebble' ? 5200 : kind === 'suede' ? 30000 : 2200, r0 = kind === 'pebble' ? 3.2 : kind === 'suede' ? .7 : .9;
    for (let i = 0; i < cnt; i++) { const px = Math.random() * N, py = Math.random() * N, r = r0 * (.6 + Math.random() * .8), v = kind === 'pebble' ? 150 + Math.random() * 60 : 60 + Math.random() * 50; const gr = x.createRadialGradient(px, py, 0, px, py, r); gr.addColorStop(0, `rgb(${v},${v},${v})`); gr.addColorStop(1, 'rgba(128,128,128,0)'); x.fillStyle = gr; [-N, 0, N].forEach(ox => [-N, 0, N].forEach(oy => { if (Math.abs(px + ox - N / 2) < N / 2 + r && Math.abs(py + oy - N / 2) < N / 2 + r) { x.beginPath(); x.arc(px + ox, py + oy, r, 0, 7); x.fill(); } })); }
    return (this[key] = new THREE.CanvasTexture(c)); },
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
      else if (kind === 'camo') { // woodland: 3 blob layers over the ground colour
        [[c2, .52], [shade(c1, -.45), .6], [c3, .66]].forEach(([col, th]) => { const f = this.clouds(w, h, [3, 6, 12, 24]), im = x.getImageData(0, 0, w, h), [r, g2, b] = hexToRgb(col); for (let i = 0; i < f.length; i++) if (f[i] > th) { im.data[i * 4] = r; im.data[i * 4 + 1] = g2; im.data[i * 4 + 2] = b; } x.putImageData(im, 0, 0); });
      }
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
  ['Shock · resin digital', { head: 'shock', display: 'digital', lcd: 'pos', strapColor: '#141516', dial: '#141516', index: '#d9dde2', accent: '#d2452b', caseMat: 'steel', hands: 'baton', movement: 'Digital quartz module · 10-yr battery', wr: '20 ATM' }],
  ['Shock · ana-digi', { head: 'shock', display: 'anadigi', lcd: 'neg', strapColor: '#3a4537', dial: '#252c23', index: '#ebe5d0', accent: '#e07b2a', caseMat: 'dlc', hands: 'baton', movement: 'Ana-digi quartz module', wr: '20 ATM' }],
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
    if (skel) over(() => { x.fillStyle = dial; x.beginPath(); x.arc(c, c, c, 0, Math.PI * 2); x.arc(c, c, R * .76, 0, Math.PI * 2, true); x.fill(); });
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
// Shader patches chain on one material (fabric FX, sock zones…): each adds a fn(shader) + a cache-key part
function addPatch(mat, key, fn) {
  const P = (mat.userData.patches ||= []); P.push([key, fn]);
  mat.onBeforeCompile = sh => P.forEach(([, f]) => f(sh)); mat.customProgramCacheKey = () => P.map(([k]) => k).join('|'); mat.needsUpdate = true;
}
// Geodesic distance from each vertex to the nearest open edge (hems, cuffs, neck and face openings), across all
// meshes of a model. Vertices are welded by position so UV seams don't count, and open edges that have another open
// edge right beside them (in any mesh) are construction seams between panels, not raw edges.
function edgeDistance(meshes, Dw) {
  const ws = o => new THREE.Vector3().setFromMatrixScale(o.matrixWorld).x;
  if (meshes.every(o => o.geometry.userData.edgeD === Dw / ws(o))) return;
  const v3 = new THREE.Vector3(), parts = meshes.map(o => {
    const geo = o.geometry, P = geo.attributes.position, n = P.count, key = new Map(), id = new Int32Array(n), up = [];
    geo.computeBoundingBox(); const q = 1 / (geo.boundingBox.getSize(new THREE.Vector3()).length() * 4e-4);
    for (let i = 0; i < n; i++) { const k = Math.round(P.getX(i) * q) + ',' + Math.round(P.getY(i) * q) + ',' + Math.round(P.getZ(i) * q); let v = key.get(k); if (v === undefined) { v = up.length / 3; key.set(k, v); up.push(P.getX(i), P.getY(i), P.getZ(i)); } id[i] = v; }
    const u = up.length / 3, idx = geo.index ? geo.index.array : null, T = idx ? idx.length : n, cnt = new Map();
    for (let t = 0; t < T; t += 3) for (let e = 0; e < 3; e++) { const a = id[idx ? idx[t + e] : t + e], b = id[idx ? idx[t + (e + 1) % 3] : t + (e + 1) % 3]; if (a === b) continue; const k = a < b ? a * u + b : b * u + a; cnt.set(k, (cnt.get(k) || 0) + 1); }
    const ea = [], eb = [], el = [], bnb = new Map(), ble = new Map(), s = ws(o);
    cnt.forEach((c, k) => { const a = Math.floor(k / u), b = k - a * u, l = Math.hypot(up[a * 3] - up[b * 3], up[a * 3 + 1] - up[b * 3 + 1], up[a * 3 + 2] - up[b * 3 + 2]); ea.push(a); eb.push(b); el.push(l);
      if (c === 1) [[a, b], [b, a]].forEach(([p, w]) => { if (!bnb.has(p)) bnb.set(p, []); bnb.get(p).push(w); ble.set(p, Math.max(ble.get(p) || 0, l * s)); }); });
    const wp = new Map(); bnb.forEach((_, v) => { v3.set(up[v * 3], up[v * 3 + 1], up[v * 3 + 2]).applyMatrix4(o.matrixWorld); wp.set(v, v3.toArray()); });
    return { geo, n, id, u, ea, eb, el, bnb, ble, wp, D: Dw / s };
  });
  let sum = 0, cntB = 0; parts.forEach(p => p.ble.forEach(l => { sum += l; cntB++; }));
  const cell = sum / (cntB || 1) * 2 || 1, grid = new Map(), ck = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  parts.forEach((p, pi) => p.wp.forEach((w, v) => { const k = ck(...w); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(pi, v); }));
  parts.forEach((p, pi) => {
    const dist = new Float32Array(p.u).fill(p.D);
    p.bnb.forEach((nb, v) => {
      const [x, y, z] = p.wp.get(v), lim = p.ble.get(v) * 3, ring = new Set([v, ...nb, ...nb.flatMap(o => p.bnb.get(o) || [])]); let seam = false;
      for (let i = -1; i <= 1 && !seam; i++) for (let j = -1; j <= 1 && !seam; j++) for (let m = -1; m <= 1 && !seam; m++) { const g = grid.get(ck(x + i * cell, y + j * cell, z + m * cell)) || [];
        for (let e = 0; e < g.length; e += 2) { const qi = g[e], w = g[e + 1]; if (qi === pi && ring.has(w)) continue; const b = parts[qi].wp.get(w); if (Math.hypot(b[0] - x, b[1] - y, b[2] - z) < lim) { seam = true; break; } } }
      if (!seam) dist[v] = 0;
    });
    for (let pass = 0, ch = true; ch && pass < 60; pass++) { ch = false; for (let i = 0; i < p.ea.length; i++) { const a = p.ea[i], b = p.eb[i], l = p.el[i]; if (dist[a] + l < dist[b]) { dist[b] = dist[a] + l; ch = true; } else if (dist[b] + l < dist[a]) { dist[a] = dist[b] + l; ch = true; } } }
    const out = new Float32Array(p.n); for (let i = 0; i < p.n; i++) out[i] = Math.min(1, dist[p.id[i]] / p.D);
    p.geo.setAttribute('aEdge', new THREE.BufferAttribute(out, 1)); p.geo.userData.edgeD = p.D;
  });
}
const GLSL_NOISE = `
vec3 m289(vec3 x){return x-floor(x*(1./289.))*289.;} vec4 m289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 prm(vec4 x){return m289(((x*34.)+1.)*x);} vec4 tis(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;i=m289(i);
vec4 p=prm(prm(prm(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);
vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
vec4 nm=tis(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=nm.x;p1*=nm.y;p2*=nm.z;p3*=nm.w;vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}
float fbm(vec3 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*snoise(p);p=p*2.03+17.1;a*=.5;}return s*.5+.5;}`;
// Real-garment surface: knit/weave relief projected in world space (true scale, no UV seams), procedural washes,
// and distressing (abrasion, rips with surviving weft threads, frayed raw edges) placed where real wear happens.
const FIN_CODE = { none: 0, acid: 1, mineral: 2, stone: 3, vintage: 4, bleach: 5 };
function fabricFX(mat, o) {
  const U = { uTile: { value: o.tile }, uFin: { value: FIN_CODE[o.finish] || 0 }, uDis: { value: o.distress === 'heavy' ? 2 : o.distress === 'light' ? 1 : 0 }, uSeed: { value: o.seed || 0 }, uCat: { value: o.cat }, uWoven: { value: o.woven ? 1 : 0 },
    uBleach: { value: new THREE.Color(o.bleach) }, uThread: { value: new THREE.Color('#ebe7dc') }, uBoxMin: { value: o.box.min.clone() }, uBoxMax: { value: o.box.max.clone() } };
  if (o.edge) mat.defines = { ...(mat.defines || {}), FAB_EDGE: '' };
  addPatch(mat, 'fab' + (o.edge ? 'E' : ''), sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFP; varying vec3 vFN; varying float vEdge;\n#ifdef FAB_EDGE\nattribute float aEdge;\n#endif')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFP = (modelMatrix * vec4(transformed, 1.0)).xyz; vFN = normalize(mat3(modelMatrix) * objectNormal);\n#ifdef FAB_EDGE\nvEdge = aEdge;\n#else\nvEdge = 1.0;\n#endif');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFP; varying vec3 vFN; varying float vEdge; uniform float uTile, uFin, uDis, uSeed, uCat, uWoven; uniform vec3 uBleach, uThread, uBoxMin, uBoxMax;' + GLSL_NOISE)
      .replace('#include <bumpmap_pars_fragment>', THREE.ShaderChunk.bumpmap_pars_fragment.replace(/vec2 dHdxy_fwd\(\) \{[\s\S]*?return vec2\( dBx, dBy \);\s*\}/, `
        float triH(vec3 p) { vec3 w = pow(abs(normalize(vFN)), vec3(4.)); w /= w.x + w.y + w.z; p *= uTile;
          return texture2D(bumpMap, p.zy).x * w.x + texture2D(bumpMap, p.xz).x * w.y + texture2D(bumpMap, p.xy).x * w.z; }
        vec2 dHdxy_fwd() { float H = triH(vFP); return bumpScale * vec2(triH(vFP + dFdx(vFP)) - H, triH(vFP + dFdy(vFP)) - H); }`))
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 P = vFP + uSeed; float k = 0.;
        if (uFin == 1.) { float wp = fbm(P * 1.8) * 1.3; // acid: bleached clouds + fine crinkle veins where the cloth was knotted
          float m = fbm(P * 2.1 + wp); k = smoothstep(.49, .6, m) * .72 + exp(-pow((m - .47) / .018, 2.)) * .28 + pow(1. - abs(snoise(P * 7. + wp * 2.)), 12.) * .22 + smoothstep(.7, .95, fbm(P * 18.)) * .1; }
        else if (uFin == 2.) { k = smoothstep(.35, .85, fbm(P * .8)) * .42 + smoothstep(.62, .9, fbm(P * 3.5)) * .1; }
        else if (uFin == 3.) { k = .06 + fbm(P * 1.1) * .2 + smoothstep(.6, .86, fbm(P * 9.)) * .12; }
        else if (uFin == 4.) { k = .12 + (fbm(P * .7) - .5) * .18 + max(normalize(vFN).y, 0.) * .14; }
        else if (uFin == 5.) { float s = smoothstep(.6, .63, snoise(P * 2.4 + 3. + fbm(P * 7.) * .35)) + smoothstep(.8, .82, snoise(P * 9. + 11.)) + smoothstep(.9, .91, snoise(P * 24.)); k = min(s, 1.) * .9; }
        if (uFin > .5) k += (1. - vEdge) * .2;
        if (uFin > .5 && uFin < 5. && uCat == 1.) { // bottoms wear on the high points: thigh + knee fade, whiskers either side of the fly
          vec3 b0 = clamp((vFP - uBoxMin) / max(uBoxMax - uBoxMin, vec3(1e-3)), 0., 1.); float fr = smoothstep(.45, .65, b0.z), ax = abs(b0.x - .5);
          k += fr * (exp(-pow((b0.y - .62) / .14, 2.)) * .18 + exp(-pow((b0.y - .33) / .08, 2.)) * .12);
          k += pow(1. - abs(snoise(vec3(vFP.x * 1.4, vFP.y * 24., vFP.z * 1.4) + uSeed)), 10.) * smoothstep(.64, .72, b0.y) * (1. - smoothstep(.8, .86, b0.y)) * smoothstep(.04, .1, ax) * (1. - smoothstep(.22, .3, ax)) * fr * .5;
        }
        vec3 col = mix(diffuseColor.rgb, uBleach, clamp(k, 0., .95));
        if (uFin == 4.) col = mix(col, vec3(dot(col, vec3(.333))), .2);
        if (uDis > .5) {
          vec3 Q = vFP + uSeed * 1.7, bn = clamp((vFP - uBoxMin) / max(uBoxMax - uBoxMin, vec3(1e-3)), 0., 1.);
          float sc = smoothstep(.55, .9, fbm(Q * vec3(3., 5., 3.))) * ((1. - vEdge) * .9 + (uCat == 1. ? smoothstep(.45, .65, bn.z) * (exp(-pow((bn.y - .33) / .09, 2.)) + .5 * exp(-pow((bn.y - .6) / .1, 2.))) : .08)); // wear concentrates at knees, thighs, hems and cuffs
          col = mix(col, uBleach, sc * (uDis > 1.5 ? .42 : .28));
          float jag = (.1 + .55 * fbm(Q * 38.)) * (uDis > 1.5 ? .7 : .35);
          if (vEdge < jag) discard;
          if (vEdge < jag + .12) col = mix(col, uThread, (1. - (vEdge - jag) / .12) * (uWoven > .5 ? .75 : .35));
          if (uDis > 1.5) {
            float m = uCat == 1. ? (exp(-pow((bn.y - .33) / .07, 2.)) + .75 * exp(-pow((bn.y - .62) / .06, 2.))) * step(.52, bn.z) : uCat == 0. ? .18 + .6 * exp(-pow((bn.y - .14) / .1, 2.)) : .15;
            float h = snoise(Q * vec3(2.4, 8., 2.4) + 5.) * .5 + .5, th = 1. - .3 * m;
            if (h > th) { if (uWoven > .5 && fract(Q.y * 60.) > .45 && fbm(Q * 25.) > .3) col = uThread * (.85 + .15 * fbm(Q * 90.)); else discard; }
            else if (h > th - .035) col = mix(col, uThread, uWoven > .5 ? .75 : .3);
          }
        }
        diffuseColor.rgb = gl_FrontFacing ? col : col * .58; // inside of the garment reads as shadowed (neck, eye and leg openings)`);
  });
}
// Seven-segment LCD digit, italic like a real module; unlit segments stay faintly visible
const SEG7 = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
function seg7(x, ch, X, Y, h, on, ghost) {
  const w = h * .5, t = h * .12, sk = .1, S = { a: [0, 0, w, 0], b: [w, 0, w, h / 2], c: [w, h / 2, w, h], d: [0, h, w, h], e: [0, h / 2, 0, h], f: [0, 0, 0, h / 2], g: [0, h / 2, w, h / 2] };
  for (const k in S) {
    const [x1, y1, x2, y2] = S[k], L = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / L, uy = (y2 - y1) / L, nx = -uy * t / 2, ny = ux * t / 2, gp = t * .62;
    const a = [x1 + ux * gp, y1 + uy * gp], b = [x2 - ux * gp, y2 - uy * gp];
    x.fillStyle = (SEG7[ch] || '').includes(k) ? on : ghost; x.beginPath();
    [[a[0] - ux * t / 2, a[1] - uy * t / 2], [a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] + ux * t / 2, b[1] + uy * t / 2], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]].forEach(([px, py], j) => { const qx = X + px + (h - py) * sk, qy = Y + py; j ? x.lineTo(qx, qy) : x.moveTo(qx, qy); });
    x.fill();
  }
}
// Shock watch face: minute track, pusher labels, mark, and the LCD (full digital or ana-digi window)
function shockFace(x, W, now, ana) {
  const w = 1024, c = w / 2, R = c, ink = W.index, acc = W.accent, neg = W.lcd === 'neg';
  x.fillStyle = W.dial; x.fillRect(0, 0, w, w);
  const vg = x.createRadialGradient(c, c * .8, 60, c, c, c); vg.addColorStop(0, 'rgba(255,255,255,.06)'); vg.addColorStop(1, 'rgba(0,0,0,.25)'); x.fillStyle = vg; x.fillRect(0, 0, w, w);
  x.strokeStyle = ink; for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2, r0 = R * (i % 5 ? .91 : .85); x.lineWidth = i % 15 ? (i % 5 ? 3 : 8) : 12; x.beginPath(); x.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0); x.lineTo(c + Math.sin(a) * R * .97, c - Math.cos(a) * R * .97); x.stroke(); }
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '700 30px "JetBrains Mono"'; x.letterSpacing = '3px';
  [['START', -.36, 1], ['RESET', .36, 1], ['ADJUST', -.36, -1], ['MODE', .36, -1]].forEach(([s, a, side]) => { x.save(); x.translate(c, c); x.rotate((side > 0 ? Math.PI / 2 : -Math.PI / 2) + a * side); x.fillStyle = s === 'START' ? acc : ink; x.fillText(s, 0, -R * .76); x.restore(); });
  Mark.draw(x, c, c - R * .5, 120, 100, ink);
  x.fillStyle = acc; x.font = '700 24px "JetBrains Mono"'; x.fillText('IMPACT RESIST', c, c - R * .3); x.fillStyle = ink; x.font = '600 22px "JetBrains Mono"'; x.fillText(`${String(W.wr || '20 ATM').replace(' ATM', '')}0M · N° ${String(W.editionNo).padStart(3, '0')}/150`, c, c + R * .72);
  const on = neg ? '#eaf2f6' : '#191b17', ghost = neg ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.075)';
  const lcd = (X, Y, Wd, Ht) => { x.fillStyle = '#060607'; x.beginPath(); x.roundRect(X - 10, Y - 10, Wd + 20, Ht + 20, 18); x.fill(); const g = x.createLinearGradient(0, Y, 0, Y + Ht); g.addColorStop(0, neg ? '#1c2023' : '#c9d0be'); g.addColorStop(1, neg ? '#08090a' : '#a7af9c'); x.fillStyle = g; x.beginPath(); x.roundRect(X, Y, Wd, Ht, 10); x.fill(); };
  const h12 = now.getHours() % 12 || 12, mm = String(now.getMinutes()).padStart(2, '0'), ss = String(now.getSeconds()).padStart(2, '0'), day = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][now.getDay()];
  const digits = (str, X, Y, h, gap) => { [...str].forEach((ch, i) => { if (ch === ':') { x.fillStyle = now.getSeconds() % 2 ? on : ghost; [.3, .7].forEach(k => x.fillRect(X + h * .12, Y + h * k - h * .05, h * .1, h * .1)); X += h * .38; return; } seg7(x, ch, X, Y, h, ch === ' ' ? ghost : on, ghost); X += h * .5 + gap; }); };
  if (!ana) {
    const X = c - R * .62, Y = c - R * .16, Wd = R * 1.24, Ht = R * .62; lcd(X, Y, Wd, Ht);
    x.fillStyle = on; x.font = '700 40px "JetBrains Mono"'; x.textAlign = 'left'; x.fillText(day, X + 26, Y + 42); x.textAlign = 'right'; x.fillText(`${now.getMonth() + 1}-${now.getDate()}`, X + Wd - 26, Y + 42);
    x.font = '700 22px "JetBrains Mono"'; x.textAlign = 'left'; x.fillText(now.getHours() >= 12 ? 'PM' : 'AM', X + 26, Y + 92);
    for (let i = 0; i < 12; i++) { x.fillStyle = i < Math.round(now.getSeconds() / 5) ? on : ghost; x.fillRect(X + Wd * .28 + i * 30, Y + 70, 22, 10); }
    digits((h12 < 10 ? ' ' : '') + h12 + ':' + mm, X + 70, Y + 110, 170, 18);
    digits(ss, X + Wd - 150, Y + 190, 90, 12);
  } else {
    x.strokeStyle = ink; [1, 2, 4, 5, 7, 8, 10, 11].forEach(hh => { const a = hh / 12 * Math.PI * 2; x.lineWidth = 16; x.beginPath(); x.moveTo(c + Math.sin(a) * R * .6, c - Math.cos(a) * R * .6); x.lineTo(c + Math.sin(a) * R * .8, c - Math.cos(a) * R * .8); x.stroke(); });
    const X = c - R * .34, Y = c + R * .2, Wd = R * .68, Ht = R * .34; lcd(X, Y, Wd, Ht);
    digits((h12 < 10 ? ' ' : '') + h12 + ':' + mm, X + 22, Y + 40, 92, 10); digits(ss, X + Wd - 74, Y + 76, 52, 6);
    const X2 = c + R * .2, Y2 = c - R * .14, W2 = R * .4, H2 = R * .2; lcd(X2, Y2, W2, H2); x.fillStyle = on; x.font = '700 34px "JetBrains Mono"'; x.textAlign = 'center'; x.fillText(`${day} ${now.getDate()}`, X2 + W2 / 2, Y2 + H2 / 2 + 2);
  }
  x.letterSpacing = '0px'; x.textAlign = 'center';
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
    this.root.clear(); this.decals = []; this.dial = null; this.hands = null; this.lcd = null; this.wheels = null; this.torso = null; this.modelMeshes = null;
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
    const bump = TEX.repeat(rib || f.knit === 'rib' ? TEX.rib() : f.weave ? TEX.weave(f.weave) : TEX.knit(f.knit || (fabric === 'waffle' ? 'waffle' : fabric === 'fleece' ? 'fleece' : 'jersey')), rib ? rx * 3 : rx * kk, rib ? 1 : ry * kk);
    bump.userData.own = true;
    const tint = !rib && f.tint && !surf ? TEX.repeat(TEX.weaveTint(f.weave), rx * kk / 6, ry * kk / 6) : null; if (tint) tint.userData.own = true;
    return new THREE.MeshPhysicalMaterial({ color: hex, roughness: f.rough, sheen: f.sheen, sheenRoughness: .75, sheenColor: new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), .3), side: THREE.DoubleSide, bumpMap: bump, bumpScale: (rib ? 1.4 : f.bump), ...(tint ? { map: tint } : {}),
      ...(surf ? { color: '#ffffff', sheenColor: new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), .3), map: surf.map, ...(surf.alpha ? { alphaMap: surf.alpha, alphaTest: .5 } : {}) } : {}) });
  },
  add(geo, mat, cast = true) { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; this.root.add(m); return m; },
  // Real garment meshes (CLO / Marvelous / marketplace GLB) take priority over the procedural fallback.
  buildGarment(d) {
    if (d.category === 'duffle') return this.buildDuffle(d);
    const model = Models.peek(d);
    if (model === undefined) { Models.load(d).then(() => { if (S.current === d && S.view === 'studio') { this.build(); Panels.studio(); } }); if (isBottom(d.category)) return; } // bottoms have no fallback shape: wait for the model
    if (model) return this.buildFromModel(d, model);
    return this.buildProcedural(d);
  },
  buildFromModel(d, gltfScene) {
    const g = d.garment, fit = FITS[g.fit] || FITS.boxy;
    const fin = g.finish || 'none', dis = g.distress || 'none', washed = fin !== 'none' || dis !== 'none';
    const surf = g.pattern && g.pattern !== 'solid' ? { map: TEX.pattern(g.pattern, g.plaid1, g.plaid2, g.plaid3, num(g.plaidScale) || 1) } : null; // washes + distress run in the fabric shader
    const obj = SkeletonUtils.clone(gltfScene); obj.rotation.y = (num(g.modelRot) || (g.model ? 0 : MODEL_ROT[Models.file(d)] || 0)) * Math.PI / 180;
    // bake rigged (skinned) meshes into static geometry so measuring, decals and the waist trace see the posed shape
    obj.updateMatrixWorld(true); { const sk = []; obj.traverse(o => { if (o.isSkinnedMesh) sk.push(o); }); sk.forEach(o => { const geo = o.geometry.clone(), p = geo.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); o.applyBoneTransform(i, v); p.setXYZ(i, v.x, v.y, v.z); } geo.deleteAttribute('skinIndex'); geo.deleteAttribute('skinWeight'); geo.computeVertexNormals(); geo.computeBoundingBox(); geo.computeBoundingSphere(); const m = new THREE.Mesh(geo, o.material); m.name = o.name; m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale); o.parent.add(m); o.parent.remove(m === o ? null : o); }); }
    const keep = !g.model && MODEL_KEEP[Models.file(d)]; if (keep) { const drop = []; obj.traverse(o => { if (o.isMesh && !keep.includes(o.name)) drop.push(o); }); drop.forEach(o => o.parent.remove(o)); }
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
    const fab = FABRICS[g.fabric] || FABRICS.jersey, L = lum(g.color);
    const fx = { tile: (fab.weave ? 7 : 5) * (fab.k || 1), finish: fin, distress: dis, seed: [...String(d.id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 9973, 7) / 97, cat: isTop(d.category) ? 0 : isBottom(d.category) ? 1 : 2, woven: !!fab.weave, box,
      bleach: fin === 'bleach' && L < .35 ? '#c47e56' : fin === 'acid' || fin === 'stone' ? '#ced0d4' : L > .8 ? '#bdb8ac' : '#eeece6' }; // light garments wear darker (grime), not lighter
    if (dis !== 'none') { const ms = []; obj.traverse(o => { if (o.isMesh) ms.push(o); }); edgeDistance(ms, .14); } // fray band ≈ 1.4 in
    obj.traverse(o => {
      if (!o.isMesh) return;
      const orig = Array.isArray(o.material) ? o.material[0] : o.material;
      const m = this.fabricMat(g.color, g.fabric, false, 30, 18, surf);
      fabricFX(m, { ...fx, edge: dis !== 'none' && !!o.geometry.attributes.aEdge });
      if (orig?.normalMap && !(MODEL_NO_NORMAL.includes(Models.file(d)) && !g.model)) { m.normalMap = orig.normalMap; m.normalScale = orig.normalScale?.clone() || new THREE.Vector2(1, 1); m.bumpScale *= .35; } // keep baked folds
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
      const mat = m.material;
      addPatch(mat, 'sockzones', sh => {
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
      });
    });
  },
  // Double waistband: a second (plaid by default) band stacked above the main one, like boxers worn high under the waist.
  // Traced per angle from the model's own waist line (height + radius), tucked just inside, with a rolled bound top edge.
  addSecondWaistband(d, box) {
    const g = d.garment, top = box.max.y, bins = 72, Y = new Float32Array(bins).fill(-1e9), R = new Float32Array(bins), v = new THREE.Vector3(), pts = [];
    const bin = (x, z) => ((Math.round((Math.atan2(z, x) / (Math.PI * 2) + .5) * bins)) % bins + bins) % bins;
    this.modelMeshes.forEach(m => { const p = m.geometry.attributes.position; m.updateMatrixWorld(true); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); if (v.y < top - .3) continue; const b = bin(v.x, v.z); pts.push(b, v.y, Math.hypot(v.x, v.z)); if (v.y > Y[b]) Y[b] = v.y; } });
    for (let i = 0; i < pts.length; i += 3) { const b = pts[i]; if (pts[i + 1] > Y[b] - .05) R[b] = Math.max(R[b], pts[i + 2]); }
    for (let k = 0; k < 4; k++) for (let b = 0; b < bins; b++) { const p = (b + bins - 1) % bins, n = (b + 1) % bins; if (!R[b]) R[b] = Math.max(R[p], R[n]); if (Y[b] < -1e8) Y[b] = Math.max(Y[p], Y[n]); }
    const smooth = A => { let s = Array.from(A); for (let k = 0; k < 3; k++) s = s.map((r, b) => (s[(b + bins - 1) % bins] + 2 * r + s[(b + 1) % bins]) / 4); return s; };
    const sr = smooth(R), sy = smooth(Y), at = (A, u) => { const f = u * bins, i0 = Math.floor(f) % bins; return lerp(A[i0], A[(i0 + 1) % bins], f - Math.floor(f)); };
    const h = num(g.wb2H || 1.75) / 10, tuck = .08, per = sr.reduce((s, r) => s + r, 0) / bins * Math.PI * 2;
    // profile: starts inside the main band, rises to the exposed height, eases in toward the body at the top
    const geo = new ParametricGeometry((u, w, t) => { const a = (u - .5) * Math.PI * 2, r = at(sr, u) * lerp(.985, .962, w * w); t.set(Math.cos(a) * r, at(sy, u) - tuck + w * (h + tuck), Math.sin(a) * r); }, bins * 2, 8);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * per * 2.2, uv.getY(i) * (h + tuck) * 2.2);
    geo.computeVertexNormals();
    const plaid = (g.wb2Pattern || 'plaid') === 'plaid', map = plaid ? TEX.pattern('plaid', g.plaid1, g.plaid2, g.plaid3, num(g.plaidScale) || 1, true) : null;
    const mat = this.fabricMat(plaid ? '#ffffff' : g.wb2Color, 'twill', false, 6, 2, map ? { map } : null);
    const band = this.add(geo, mat); this.modelMeshes.push(band);
    const ring = (dy, k) => new THREE.CatmullRomCurve3(Array.from({ length: bins }, (_, b) => { const a = (b / bins - .5) * Math.PI * 2, r = sr[b] * k; return new THREE.Vector3(Math.cos(a) * r, sy[b] + dy, Math.sin(a) * r); }), true);
    this.add(new THREE.TubeGeometry(ring(h, .962), 160, .014, 8, true), this.fabricMat(plaid ? g.plaid1 : shade(g.wb2Color, -.25), 'twill', false, 6, 2)); // rolled binding
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
      const puff = /Puff|embroider|Chenille|patch/i.test(P.tech), press = pressMode(P.tech) && TEX.press(art, d.garment.color, pressMode(P.tech));
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
        if (press) { m.material.dispose(); m.material = new THREE.MeshPhysicalMaterial({ map: press.map, alphaMap: press.alpha, bumpMap: press.bump, bumpScale: 5, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: (FABRICS[d.garment.fabric]?.rough ?? .5) * (press.mode === 'deboss' ? .8 : 1), clearcoat: FABRICS[d.garment.fabric]?.coat || 0, ...(press.metal ? { metalness: 1, metalnessMap: press.metal } : {}) }); }
        this.decals.push(m);
      });
    });
  },
  /* ---------- duffle (hard good: procedural like the watch, prints like a garment) ---------- */
  // 1 unit = 10 in. Barrel weekender: superellipse section with a flatter base, piped end panels, wrap-under handle straps.
  buildDuffle(d) {
    const g = d.garment, fab = FABRICS[g.fabric] ? g.fabric : 'pebble', f = FABRICS[fab];
    const L = { mini: 1.6, weekender: 2.2, large: 2.6 }[g.bagSize] || 2.2, H = L * .5, D = L * .48;
    const leather = f.leather;
    const surf = g.pattern && g.pattern !== 'solid' ? { map: TEX.pattern(g.pattern, g.plaid1, g.plaid2, g.plaid3, num(g.plaidScale) || 1) } : null;
    const shell = leather ? new THREE.MeshPhysicalMaterial({ color: g.color, roughness: f.rough, sheen: f.sheen, sheenRoughness: .6, sheenColor: new THREE.Color(g.color).lerp(new THREE.Color('#ffffff'), .2), clearcoat: f.coat || 0, clearcoatRoughness: .5, bumpMap: TEX.repeat(TEX.grain(fab), 5, 3), bumpScale: f.bump, side: THREE.DoubleSide, ...(surf ? { color: '#ffffff', map: surf.map } : {}) })
      : this.fabricMat(g.color, fab, false, 22, 14, surf);
    const trim = leather ? shell.clone() : new THREE.MeshPhysicalMaterial({ color: shade(g.color, -.08), roughness: .5, sheen: .2, bumpMap: TEX.repeat(TEX.grain('smooth'), 3, 1), bumpScale: .3 });
    trim.map = null; trim.color.set(g.trim && g.trim !== '#EEF1F9' ? g.trim : g.color);
    const HW = { gunmetal: ['#5b5f66', .32], steel: ['#d2d4d8', .22], gold: ['#c9a24a', .26], black: ['#26272b', .45] }[g.hardware || 'gunmetal'];
    const metal = new THREE.MeshStandardMaterial({ color: HW[0], metalness: 1, roughness: HW[1] });
    const add = (geo, mat) => this.add(geo, mat);
    // cross-section (y up, z toward camera); v = 0 sits under the bag so the UV seam hides
    const sec = (v, s = 1) => { const a = v - Math.PI / 2, c = Math.cos(a), sn = Math.sin(a), n = sn < 0 ? 4.2 : 2.3;
      const y = H / 2 * Math.sign(sn) * Math.abs(sn) ** (2 / n), z = D / 2 * Math.sign(c) * Math.abs(c) ** (2 / n) * (1 - .14 * Math.max(0, sn));
      return [y * s, z * s]; };
    const taper = u => 1 - .08 * Math.abs(2 * u - 1) ** 5, end = taper(0);
    const body = add(new ParametricGeometry((u, v, t) => { const [y, z] = sec(v * Math.PI * 2, taper(u)); t.set((u - .5) * L, y, z); }, 96, 96), shell);
    [-1, 1].forEach(sx => {
      const cap = add(new ParametricGeometry((r, v, t) => { const [y, z] = sec(v * Math.PI * 2, end * r); t.set(sx * (L / 2 + .045 * (1 - r * r)), y, z); }, 24, 96), trim);
      const ring = []; for (let i = 0; i < 96; i++) { const [y, z] = sec(i / 96 * Math.PI * 2, end * 1.004); ring.push(new THREE.Vector3(sx * L / 2, y, z)); }
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring, true), 192, .017, 8, true), trim); // piping
      // shoulder-strap D-ring + snap hook on each end panel
      const dr = add(new THREE.TorusGeometry(.055, .011, 10, 28, Math.PI * 1.15), metal); dr.position.set(sx * (L / 2 + .05), H * .18, 0); dr.rotation.set(0, sx * Math.PI / 2, Math.PI * .43);
      const hook = add(new RoundedBoxGeometry(.03, .16, .06, 2, .01), metal); hook.position.set(sx * (L / 2 + .085), H * .05, .02); hook.rotation.z = sx * .35;
      cap.castShadow = true;
    });
    // flat band helper: centres + outward normals + width axis → box-section strap
    const band = (pts, nrm, ax, w, t, mat) => {
      const pos = [], idx = [], n = pts.length;
      pts.forEach((p, i) => { const o = nrm[i].clone().multiplyScalar(t / 2), a = ax[i].clone().multiplyScalar(w / 2);
        [[1, 1], [-1, 1], [-1, -1], [1, -1]].forEach(([sa, so]) => { const q = p.clone().addScaledVector(a, sa).addScaledVector(o, so); pos.push(q.x, q.y, q.z); }); });
      for (let i = 0; i < n - 1; i++) for (let k = 0; k < 4; k++) { const a = i * 4 + k, b = i * 4 + (k + 1) % 4, c = a + 4, e = b + 4; idx.push(a, c, b, b, c, e); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals(); return add(geo, mat);
    };
    // handle straps wrap under the bag; they stop short of the zip
    const xs = L * .19, gap = .42, top = [];
    [-1, 1].forEach(sx => {
      const pts = [], nrm = [], ax = [], u = .5 + sx * xs / L;
      for (let i = 0; i <= 120; i++) { const v = Math.PI + gap + i / 120 * (Math.PI * 2 - gap * 2), [y, z] = sec(v, taper(u)), [y2, z2] = sec(v + .01, taper(u));
        const tg = new THREE.Vector3(0, y2 - y, z2 - z).normalize(), nn = new THREE.Vector3(0, -tg.z, tg.y); // outward (curve runs counter-clockwise seen from +x)
        if (nn.y * y + nn.z * z < 0) nn.negate(); pts.push(new THREE.Vector3(sx * xs, y, z).addScaledVector(nn, .014)); nrm.push(nn); ax.push(new THREE.Vector3(1, 0, 0)); }
      band(pts, nrm, ax, .15, .022, trim);
      top.push(pts[0], pts[pts.length - 1]);
    });
    // zip track + pull along the crown
    { const pts = [], nrm = [], ax = []; for (let i = 0; i <= 60; i++) { const u = .04 + i / 60 * .92, [y] = sec(Math.PI, taper(u)); pts.push(new THREE.Vector3((u - .5) * L, y + .006, 0)); nrm.push(new THREE.Vector3(0, 1, 0)); ax.push(new THREE.Vector3(0, 0, 1)); }
      band(pts, nrm, ax, .09, .012, new THREE.MeshStandardMaterial({ color: '#1b1c20', roughness: .7 }));
      band(pts, nrm, ax, .03, .02, metal);
      const pull = add(new RoundedBoxGeometry(.05, .016, .16, 2, .008), metal); pull.position.set(L * .3, H / 2 + .02, .06); pull.rotation.x = -.4;
      const pt = add(new RoundedBoxGeometry(.06, .012, .22, 2, .006), trim); pt.position.set(L * .3, H / 2 + .015, .2); pt.rotation.x = -.6; }
    // rolled handles: front and back arches meet under a snap wrap
    const apexY = H / 2 + H * .64;
    [[top[0], top[2]], [top[1], top[3]]].forEach(([a, b]) => {
      const zs = Math.sign(a.z), mid = new THREE.Vector3(0, apexY, zs * .045);
      const curve = new THREE.CatmullRomCurve3([a.clone().add(new THREE.Vector3(0, -.02, 0)), a.clone().add(new THREE.Vector3(0, .16, -zs * .03)), new THREE.Vector3(a.x * .78, apexY - .22, zs * .1), mid, new THREE.Vector3(b.x * .78, apexY - .22, zs * .1), b.clone().add(new THREE.Vector3(0, .16, -zs * .03)), b.clone().add(new THREE.Vector3(0, -.02, 0))]);
      add(new THREE.TubeGeometry(curve, 120, .036, 14, false), trim);
      [a, b].forEach(p => { const ring = add(new THREE.TorusGeometry(.05, .011, 10, 24), metal); ring.position.copy(p).add(new THREE.Vector3(0, .05, 0)); ring.rotation.y = Math.PI / 2;
        [-1, 1].forEach(k => { const rv = add(new THREE.CylinderGeometry(.014, .014, .012, 16), metal); rv.position.copy(p).add(new THREE.Vector3(0, -.05 - k * .045, 0)).addScaledVector(new THREE.Vector3(0, p.y, p.z).normalize(), .013); rv.lookAt(rv.position.clone().add(new THREE.Vector3(0, p.y, p.z))); rv.rotateX(Math.PI / 2); }); });
    });
    { const wrap = add(new THREE.CapsuleGeometry(.06, H * .42, 6, 16), trim); wrap.position.set(0, apexY, 0); wrap.rotation.z = Math.PI / 2; wrap.scale.set(1, 1, 1.25);
      const snap = add(new THREE.CylinderGeometry(.026, .026, .012, 24), metal); snap.position.set(0, apexY + .066, 0); }
    // shoulder strap: ring to ring, draped across the front with a pad
    { const c = new THREE.CatmullRomCurve3([[-1, .18, 0], [-1.09, -.08, .22], [-.85, -.5, .62], [-.3, -.66, .78], [.3, -.62, .8], [.85, -.45, .62], [1.09, -.06, .22], [1, .18, 0]].map(([x, y, z]) => new THREE.Vector3(x * (L / 2 + .06), y * H, z * D)));
      const pts = c.getSpacedPoints(160), nrm = [], ax = []; pts.forEach((p, i) => { const tg = c.getTangentAt(i / 160), a = new THREE.Vector3().crossVectors(tg, new THREE.Vector3(0, 0, 1)).normalize(); ax.push(a); nrm.push(new THREE.Vector3().crossVectors(a, tg).normalize()); });
      band(pts, nrm, ax, .13, .018, trim);
      const k = 80, pad = add(new RoundedBoxGeometry(.6, .19, .045, 3, .02), trim); pad.position.copy(pts[k]).addScaledVector(nrm[k], .02); pad.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(c.getTangentAt(.5), ax[k].clone().negate(), nrm[k]));
      const bk = add(new THREE.TorusGeometry(.07, .009, 6, 4), metal); bk.position.copy(pts[118]).addScaledVector(nrm[118], .015); bk.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(c.getTangentAt(118 / 160), ax[118].clone().negate(), nrm[118])); bk.rotateZ(Math.PI / 4); bk.scale.set(1.3, 1, 1); }
    // luggage tag off the front-right handle ring
    { const p = top[3], tag = add(new RoundedBoxGeometry(.24, .36, .025, 3, .012), trim); tag.position.set(p.x + .17, p.y - .32, p.z + .08); tag.rotation.set(-.12, .25, -.18);
      const lp = add(new RoundedBoxGeometry(.045, .26, .014, 2, .006), trim); lp.position.set(p.x + .09, p.y - .07, p.z + .05); lp.rotation.z = .55; }
    // base studs
    [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([a, b]) => { const s = add(new THREE.CylinderGeometry(.03, .034, .03, 20), metal); s.position.set(a * L * .36, -H / 2 - .005, b * D * .3); });
    this.modelMeshes = [body]; this.torso = body;
    this.P = { w: L / 4, d: D / 2, h: H, rise: 0, neckR: .3, side: false };
    this.updateDecals();
  },
  /* ---------- watch ---------- */
  buildWatch(d) {
    // Real proportions at 42 mm (1 unit ≈ 20 mm): case ≈ 10.5 mm tall, dial recessed under a machined bezel, domed sapphire
    // model heads (debranded marketplace cases) replace only the case; dial, hands, crystal and straps stay ours
    const head = W0 => W0.head && W0.head !== 'built' && W0.head !== 'shock' ? this.loadHead(W0.head) : null, hd = head(watchSpec(d)); this.lcd = null;
    const W = hd ? { ...watchSpec(d), shape: 'round', bezelStyle: 'none' } : watchSpec(d), sc = W.dia / 42, grp = new THREE.Group(); this.root.add(grp);
    const mk = (geo, mat, parent = grp) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
    const V2 = a => a.map(([x, y]) => new THREE.Vector2(x, y));
    if (W.head === 'shock') { this.balance = null; this.wheels = []; this.buildShock(d, W, grp, mk); grp.scale.setScalar(sc); grp.rotation.x = .62; return; }
    const caseMat = watchMat(W.caseMat, W.caseWood);
    const cm = CASE_MATS[W.caseMat] || CASE_MATS.steel;
    const metal = cm.kind === 'metal' ? caseMat : W.caseMat === 'wood' ? (BEZELS[W.bezel]?.m ? watchMat('_bz', null, BEZELS[W.bezel]) : watchMat('wood', W.caseWood)) : watchMat('steel');
    const polished = metal.clone(); polished.roughness = Math.min(.16, metal.roughness); polished.envMapIntensity = 1.3;
    const steel = watchMat('steel');
    const G = WATCH_GEOM[W.shape] || WATCH_GEOM.round;
    const TOP = .17, DIAL_Y = .14, BZ_TOP = .255, CRY_Y = .262, MID = -.055;
    // case
    if (hd) {
      const h = hd.clone(true), dark = new THREE.MeshStandardMaterial({ color: '#17181b', metalness: .4, roughness: .35 }), hm = cm.kind === 'metal' ? caseMat : steel;
      h.scale.setScalar(G.dialR); h.position.y = DIAL_Y + HEAD_LIFT; h.traverse(o => { if (o.isMesh) { o.material = o.name.startsWith('dark') ? dark : hm; o.castShadow = o.receiveShadow = true; } }); grp.add(h);
    } else if (W.shape === 'round') {
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
    const dial = mk(dialGeo(), new THREE.MeshPhysicalMaterial({ map: dialTex, roughness: finish.rough, metalness: finish.metal, clearcoat: W.dialStyle === 'enamel' ? 1 : .2, envMapIntensity: .55, alphaTest: open ? .4 : 0, side: THREE.DoubleSide }));
    dial.rotation.x = -Math.PI / 2; dial.position.y = DIAL_Y;
    // rehaut: the angled chapter ring between dial and crystal (round cases)
    if (!hd && (W.shape === 'round' || W.shape === 'cushion')) mk(new THREE.LatheGeometry(V2([[dialR - .005, DIAL_Y + .002], [dialR + .05, TOP + .03]]), 160), new THREE.MeshStandardMaterial({ color: shade(W.dial, lum(W.dial) > .5 ? -.08 : .1), roughness: .6, metalness: .2, side: THREE.DoubleSide }));
    this.balance = null; this.wheels = [];
    if (open) {
      // dial well: dark walls + floor under the open dial
      const well = new THREE.ExtrudeGeometry(new THREE.Shape(dialShape ? shapePts(W.shape, G.dialScale * 1.01) : circlePts(dialR + .01, 128).reverse()), { depth: .21, bevelEnabled: false, curveSegments: 64 });
      well.rotateX(-Math.PI / 2); mk(well, new THREE.MeshStandardMaterial({ color: '#0d0e11', metalness: .5, roughness: .55, side: THREE.BackSide })).position.y = DIAL_Y - .21;
      const k = dialShape ? .69 / .76 : dialR / .76, mv = this.buildMovement(W, grp, mk, k, DIAL_Y - .2, steel);
      if (W.dialStyle === 'openheart') { mv.rotation.y = -Math.PI / 2; mv.position.x = -.54 * G.fit * dialR + .36 * k; } // balance under the dial aperture
      else { const ri = dialR * .76 * G.fit - .001; mk(new THREE.LatheGeometry(V2([[ri, DIAL_Y - .03], [ri, DIAL_Y + .001]]), 128), polished.clone()).material.side = THREE.DoubleSide; } // chapter-ring edge
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
    } else if (W.bezelStyle !== 'none' && !hd) {
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
    const cR = hd ? dialR * 1.01 : insert ? .825 : W.shape === 'round' ? .81 : dialR, dome = .025, sR = (cR * cR + dome * dome) / (2 * dome);
    const cry = mk(W.shape === 'round' || W.shape === 'cushion' || W.shape === 'octagon' ? new THREE.SphereGeometry(sR, 128, 12, 0, Math.PI * 2, 0, Math.asin(cR / sR)) : dialGeo(),
      new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: 1, thickness: .04, ior: 1.77, roughness: 0, metalness: 0, clearcoat: 1, envMapIntensity: 1.6, transparent: true, opacity: 1 }));
    if (hd) cry.position.y = DIAL_Y + HEAD_LIFT + (hd.userData.glass || 0) * dialR + .012 + dome - sR;
    else if (W.shape === 'round' || W.shape === 'cushion' || W.shape === 'octagon') cry.position.y = CRY_Y + dome - sR; else { cry.rotation.x = -Math.PI / 2; cry.position.y = CRY_Y; }
    cry.castShadow = false;
    // knurled crown + stem + guards
    const crownMat = cm.kind === 'metal' ? metal : steel;
    const gear = new THREE.Shape(); for (let i = 0; i <= 64; i++) { const a = i / 64 * Math.PI * 2, r = i % 2 ? .08 : .088; i ? gear.lineTo(Math.cos(a) * r, Math.sin(a) * r) : gear.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    const cg2 = new THREE.ExtrudeGeometry(gear, { depth: .11, bevelEnabled: true, bevelThickness: .015, bevelSize: .012, bevelSegments: 3, curveSegments: 8 }); cg2.rotateY(Math.PI / 2);
    if (!hd) {
    const crown = mk(cg2, crownMat); crown.position.set(G.halfX + .05, MID, 0);
    const stem = mk(new THREE.CylinderGeometry(.04, .04, .08, 24), crownMat); stem.rotation.z = Math.PI / 2; stem.position.set(G.halfX + .01, MID, 0);
    if (W.crownGuards) [-1, 1].forEach(s => { const gd = mk(new RoundedBoxGeometry(.13, .16, .08, 4, .035), caseMat); gd.position.set(G.halfX + .02, MID, s * .15); });
    // lugs (integrated octagon has none)
    }
    if (W.shape !== 'octagon' && !hd) { const lg = lugGeo(); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => { const l = mk(lg, caseMat); l.position.set(sx * .63, 0, sz * (G.halfZ - .34)); if (sz < 0) l.rotation.y = Math.PI; }); }
    const bm = cm.kind === 'metal' ? metal : steel, bp = bm.clone(); bp.roughness = .17; bp.envMapIntensity = 1.35; // polished, not a perfect mirror
    this.buildStrap(W, grp, mk, { metal: bm, polished: bp, steel }, hd ? { ...G, halfZ: (hd.userData.lugZ || 1.3) * dialR - .2 } : G);
    grp.scale.setScalar(sc); grp.rotation.x = .62;
  },
  // Shock-resistant resin sports watch: rounded-square resin body over a steel caseback, lug shoulders, raised bezel with
  // exposed screws and grip ribs, guarded pushers, recessed face with a live LCD (digital or ana-digi), integrated resin strap.
  buildShock(d, W, grp, mk) {
    const resin = new THREE.MeshPhysicalMaterial({ color: W.strapColor, roughness: .6, clearcoat: .15, clearcoatRoughness: .55, sheen: .3, sheenRoughness: .6, sheenColor: new THREE.Color(W.strapColor).lerp(new THREE.Color('#fff'), .3) });
    const cm = CASE_MATS[W.caseMat] || CASE_MATS.steel, metal = cm.kind === 'metal' ? watchMat(W.caseMat) : watchMat('steel'), polished = metal.clone(); polished.roughness = .18;
    const ext = (shape, depth, bevel) => { const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * .9, bevelSegments: 6, curveSegments: 64 }); g.rotateX(-Math.PI / 2); return g; };
    const sq = (hx, hz, p = 3.4, n = 128) => Array.from({ length: n }, (_, i) => { const a = -i / n * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); return new THREE.Vector2(Math.sign(c) * Math.abs(c) ** (2 / p) * hx, Math.sign(s) * Math.abs(s) ** (2 / p) * hz); });
    const at = (m, x, y, z) => { m.position.set(x, y, z); return m; };
    const TOP = .3, R = .72, ana = W.display === 'anadigi';
    at(mk(ext(new THREE.Shape(sq(1.08, 1.02)), .5, .11), resin), 0, TOP - .61, 0);                       // body
    at(mk(new THREE.CylinderGeometry(.82, .86, .06, 72), metal), 0, TOP - .74, 0);                         // steel caseback
    [-1, 1].forEach(sz => {                                                                                 // lug shoulders
      at(mk(new RoundedBoxGeometry(1.02, .46, .46, 5, .13), resin), 0, TOP - .34, sz * 1.04);
      for (let i = -1; i <= 1; i++) at(mk(new RoundedBoxGeometry(.14, .05, .3, 2, .02), resin), i * .3, TOP - .1, sz * 1.05);
    });
    const bz = new THREE.Shape(sq(1, .94)); bz.holes.push(new THREE.Path(circlePts(R + .02, 128).reverse()));
    at(mk(ext(bz, .06, .03), resin), 0, TOP, 0);                                                            // raised bezel
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; if (i % 4 === 2) continue; const rb = mk(new RoundedBoxGeometry(.035, .03, .12, 2, .012), resin); rb.position.set(Math.cos(a) * .86, TOP + .095, Math.sin(a) * .86); rb.rotation.y = -a + Math.PI / 2; }
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sz]) => {                                            // bezel screws
      at(mk(new THREE.CylinderGeometry(.06, .062, .03, 6), polished), sx * .69, TOP + .1, sz * .65);
      const sl = at(mk(new THREE.BoxGeometry(.08, .012, .014), new THREE.MeshStandardMaterial({ color: '#1a1a1c', roughness: .6 })), sx * .69, TOP + .112, sz * .65); sl.rotation.y = .6 * sx * sz;
    });
    [[1, -.46], [1, .46], [-1, -.46], [-1, .46]].forEach(([sx, z]) => {                                      // guarded pushers
      at(mk(new RoundedBoxGeometry(.16, .24, .3, 3, .07), resin), sx * 1.16, TOP - .3, z);
      const p = at(mk(new THREE.CylinderGeometry(.055, .055, .16, 24), polished), sx * 1.25, TOP - .3, z); p.rotation.z = Math.PI / 2;
    });
    { const lb = at(mk(new RoundedBoxGeometry(.3, .1, .1, 3, .04), polished), 0, TOP - .28, 1.24); lb.visible = !ana; } // front light button (digital)
    // face: one canvas holds printed ring, labels and the LCD; redrawn each second
    const cv = document.createElement('canvas'); cv.width = cv.height = 1024; const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 16; tex.userData.own = true;
    let last = -1; const draw = () => { const n = new Date(), s = n.getSeconds(); if (s === last) return; last = s; shockFace(cv.getContext('2d'), W, n, ana); tex.needsUpdate = true; }; draw(); this.lcd = draw;
    const face = mk(new THREE.CircleGeometry(R + .02, 96), new THREE.MeshPhysicalMaterial({ map: tex, roughness: .55, metalness: .05 })); face.rotation.x = -Math.PI / 2; face.position.y = TOP + .004;
    mk(new THREE.CylinderGeometry(R + .02, R + .02, .08, 96, 1, true), new THREE.MeshStandardMaterial({ color: shade(W.dial, -.3), roughness: .7, side: THREE.BackSide })).position.y = TOP + .04;
    const glass = mk(new THREE.CircleGeometry(R + .02, 96), new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: 1, thickness: .03, ior: 1.52, roughness: 0, clearcoat: 1, envMapIntensity: 1.4 })); glass.rotation.x = -Math.PI / 2; glass.position.y = TOP + .07; glass.castShadow = false;
    if (ana) {
      const hm = c => new THREE.MeshPhysicalMaterial({ color: c, metalness: .5, roughness: .3, clearcoat: .4 }), hand = (len, wid, col, y, st) => { const m = mk(handGeo(st, len, wid), hm(col)); m.position.y = y; return m; };
      this.hands = { h: hand(.42, .07, W.index, TOP + .012, W.hands), m: hand(.62, .05, W.index, TOP + .024, W.hands), s: hand(.68, .014, W.accent, TOP + .036, 'baton') };
      mk(new THREE.CylinderGeometry(.03, .03, .05, 24), hm(W.index)).position.y = TOP + .03;
    }
    this.buildStrap({ ...W, strap: 'rubber', shape: 'round' }, grp, mk, { metal, polished, steel: metal }, { halfZ: 1.12, strapW: 1.14 });
  },
  // Openworked calibre for skeleton / open-heart dials: plate ring, gear train, bridges with Geneva stripes,
  // jewels, blued screws, pallet fork and a beating balance. Layout in dial units (r .76), -z = 12 o'clock.
  buildMovement(W, grp, mk, k, y0, steel) {
    const gold = /gold|rose|bronze/.test(W.caseMat), mv = new THREE.Group(); mv.scale.setScalar(k); mv.position.y = y0; grp.add(mv);
    const M = (c, r, m = 1) => new THREE.MeshPhysicalMaterial({ color: c, metalness: m, roughness: r });
    if (!TEX._c.geneva) { const t = new THREE.CanvasTexture(TEX.canvas(64, 8, (x) => { for (let i = 0; i < 64; i++) { const v = 128 + 120 * Math.sin(i / 64 * Math.PI * 2); x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(i, 0, 1, 8); } })); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(34, 1); t.rotation = .5; TEX._c.geneva = t; }
    const plateM = M(gold ? '#6f5a36' : '#2f3237', .45), bridgeM = M(gold ? '#dcc089' : W.caseMat !== 'wood' && lum(caseHex(W)) < .2 ? '#3b3e44' : '#cfd2d7', .28), wheelM = M(gold ? '#e6e8ec' : '#d9b46c', .22), pinM = M('#9ea2a8', .18), dark = M('#4b4e54', .3);
    bridgeM.bumpMap = TEX._c.geneva; bridgeM.bumpScale = .45; bridgeM.clearcoat = .3;
    const blue = new THREE.MeshPhysicalMaterial({ color: '#1f45b0', metalness: .85, roughness: .22, clearcoat: .6 }), ruby = new THREE.MeshPhysicalMaterial({ color: '#c0152f', roughness: .04, clearcoat: 1, sheen: .4, sheenColor: new THREE.Color('#ff6a7a') }), chaton = M('#e6cc92', .18);
    const P = (x, z) => new THREE.Vector2(x, -z), add = (geo, mat, x = 0, y = 0, z = 0) => { const m = mk(geo, mat, mv); m.position.set(x, y, z); return m; };
    const ext = (shape, depth, bevel = .005) => { const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 40 }); g.rotateX(-Math.PI / 2); return g; };
    const arm = (pts, w) => { const c = new THREE.SplineCurve(pts), L = [], R = [], N = 60; for (let i = 0; i <= N; i++) { const p = c.getPoint(i / N), t = c.getTangent(i / N), n = new THREE.Vector2(-t.y, t.x), hw = w / 2 * (1 - .25 * Math.sin(i / N * Math.PI)); L.push(p.clone().addScaledVector(n, hw)); R.unshift(p.clone().addScaledVector(n, -hw)); } return new THREE.Shape(L.concat(R)); };
    const disc = r => { const s = new THREE.Shape(); s.absarc(0, 0, r, 0, Math.PI * 2, false); return s; };
    const gearShape = (r, teeth, spokes, esc = false) => {
      const s = new THREE.Shape(), rr = r * (esc ? .78 : .93), d = Math.PI * 2 / teeth;
      for (let i = 0; i < teeth; i++) { const a = i * d; (esc ? [[rr, 0], [r, .55], [r * .96, .72], [rr, .76]] : [[rr, 0], [r, .28], [r, .5], [rr, .78]]).forEach(([q, f], j) => { const b = a + f * d; i || j ? s.lineTo(Math.cos(b) * q, Math.sin(b) * q) : s.moveTo(Math.cos(b) * q, Math.sin(b) * q); }); }
      s.closePath();
      const rin = rr - r * .13, hub = r * .26, hw = r * .05;
      for (let j = 0; j < spokes; j++) { const a0 = j / spokes * Math.PI * 2, a1 = a0 + Math.PI * 2 / spokes, o1 = Math.asin(hw / rin), o2 = Math.asin(Math.min(.95, hw / hub)), h = new THREE.Path(); h.absarc(0, 0, rin, a0 + o1, a1 - o1, false); h.absarc(0, 0, hub, a1 - o2, a0 + o2, true); h.closePath(); s.holes.push(h); }
      return s;
    };
    const jewel = (x, y, z, r = .022) => { add(new THREE.CylinderGeometry(r, r * 1.1, .008, 24), chaton, x, y + .004, z); add(new THREE.CylinderGeometry(r * .5, r * .55, .006, 20), ruby, x, y + .009, z); add(new THREE.SphereGeometry(r * .14, 8, 6), pinM, x, y + .012, z); };
    const screw = (x, y, z, r = .019) => { add(new THREE.CylinderGeometry(r, r, .01, 20), blue, x, y + .005, z); const sl = add(new THREE.BoxGeometry(r * 1.8, .004, r * .3), M('#0b1640', .4), x, y + .01, z); sl.rotation.y = Math.random() * 3; };
    // plate: skeletonised ring + three supporting arms
    const ring = disc(.76); ring.holes.push(new THREE.Path().absarc(0, 0, .655, 0, Math.PI * 2, true)); add(ext(ring, .02), plateM, 0, .012);
    [[[P(-.7, .22), P(-.34, .16), P(0, 0)], .075], [[P(.69, -.24), P(.32, -.33), P(0, -.4)], .075], [[P(-.52, .5), P(-.2, .5), P(0, .36)], .06]].forEach(([p, w]) => add(ext(arm(p, w), .02), plateM, 0, .012));
    // gear train: barrel → centre → third → fourth → escape
    add(new THREE.CylinderGeometry(.2, .2, .004, 48), M('#141518', .5), 0, .04, -.4);
    const spring = []; for (let a = 0; a < Math.PI * 2 * 9; a += .12) { const r = .045 + a / (Math.PI * 2 * 9) * .15; spring.push(new THREE.Vector3(Math.cos(a) * r, .055, -.4 + Math.sin(a) * r)); }
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(spring), 900, .0035, 4), M('#b9bcc2', .3));
    const wheel = (x, z, y, r, teeth, spokes, spin, esc, depth = .012) => { const m = add(ext(gearShape(r, teeth, spokes, esc), depth, .002), wheelM, x, y, z); add(new THREE.CylinderGeometry(r * .2, r * .2, .05, 16), pinM, x, y, z); this.wheels.push({ m, spin, esc }); return m; };
    wheel(0, -.4, .045, .25, 72, 5, -.002, false, .03);
    wheel(0, 0, .06, .17, 60, 4, .0167);
    wheel(.28, -.1, .075, .13, 54, 5, -.03);
    wheel(.36, .18, .06, .11, 48, 4, .105);
    wheel(.22, .44, .07, .075, 15, 5, -6, true);
    // pallet fork with ruby pallets
    add(ext(arm([P(.2, .4), P(.12, .37), P(.045, .36)], .02), .008, .002), dark, 0, .086);
    [[.25, .39], [.18, .47]].forEach(([x, z]) => add(new THREE.BoxGeometry(.012, .01, .02), ruby, x, .09, z));
    // balance: rim with timing screws, cross arms, hairspring, roller
    const bw = new THREE.Group(); bw.position.set(0, .095, .36); mv.add(bw);
    const bal = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; bw.add(m); return m; };
    bal(new THREE.TorusGeometry(.13, .011, 12, 72), wheelM).rotation.x = Math.PI / 2;
    for (let i = 0; i < 2; i++) bal(new THREE.BoxGeometry(.26, .008, .014), wheelM).rotation.y = i * Math.PI / 2;
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, s = bal(new THREE.CylinderGeometry(.009, .009, .016, 10), i % 2 ? chaton : pinM); s.rotation.z = Math.PI / 2; s.rotation.y = -a; s.position.set(Math.cos(a) * .143, 0, Math.sin(a) * .143); }
    const coil = []; for (let a = 0; a < Math.PI * 2 * 11; a += .15) { const r = .018 + a * .0013; coil.push(new THREE.Vector3(Math.cos(a) * r, .012, Math.sin(a) * r)); }
    bal(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coil), 600, .0016, 4), M('#2b55c8', .25));
    bal(new THREE.CylinderGeometry(.03, .03, .01, 24), pinM);
    this.balance = bw;
    // bridges: Geneva-striped, chamfered, jewelled at every pivot
    const BY = .1, by = BY + .026;
    [[[P(-.71, -.2), P(-.36, -.43), P(0, -.4), P(.36, -.43), P(.71, -.2)], .08], [[P(.71, -.1), P(.28, -.1), P(.36, .18), P(.22, .44), P(.34, .6)], .06], [[P(-.71, .05), P(-.36, .1), P(0, 0)], .065]].forEach(([p, w]) => {
      add(ext(arm(p, w), .022), bridgeM, 0, BY);
      [p[0], p[p.length - 1]].forEach(e => { if (e.length() > .6) { add(ext(disc(.04), .022), bridgeM, e.x, BY, -e.y); screw(e.x, by, -e.y); } });
    });
    add(ext(disc(.075), .026), bridgeM, 0, BY, -.4); screw(0, by + .004, -.4, .034); // barrel screw
    [[0, 0, .05], [.28, -.1, .036], [.36, .18, .034], [.22, .44, .03]].forEach(([x, z, r]) => { add(ext(disc(r), .022), bridgeM, x, BY, z); if (x || z) jewel(x, by, z, r * .62); });
    // balance cock + shock setting
    const CY = .13; add(ext(arm([P(-.6, .44), P(-.32, .52), P(-.08, .42), P(0, .36)], .08), .02), bridgeM, 0, CY); add(ext(disc(.048), .02), bridgeM, 0, CY, .36);
    add(ext(disc(.04), .02), bridgeM, -.6, CY, .44); screw(-.6, CY + .024, .44); jewel(0, CY + .024, .36, .028);
    add(new THREE.TorusGeometry(.03, .0035, 6, 24, Math.PI * 1.4), chaton, 0, CY + .036, .36).rotation.x = Math.PI / 2;
    return mv;
  },
  loadHead(name) {
    this.heads ??= {}; this.headWait ??= {};
    if (this.heads[name]) return this.heads[name];
    this.headWait[name] ??= new GLTFLoader().loadAsync(`assets/models/watch-${name}.glb`).then(g => { this.heads[name] = g.scene.children[0] || g.scene; this.heads[name].userData = { ...(g.scene.userData || {}), ...(g.scene.children[0]?.userData || {}) }; if (S.current?.category === 'watch' && S.view === 'studio') this.build(); }).catch(e => console.warn('watch head', name, e));
    return null;
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
      const curve = new THREE.CatmullRomCurve3(tuck), w0 = G.strapW || (integ ? 1.15 : 1.02), th = t === 'mesh' ? .06 : t === 'rubber' ? .13 : .11;
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
    // link frame: width axis stays on x so neighbouring links never roll against each other (shortest-arc rotation drifts and bands the reflections)
    const SIDE = new THREE.Vector3(1, 0, 0), frame = T => { const fz = T.clone().normalize(), fy = new THREE.Vector3().crossVectors(fz, SIDE).normalize(); return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(fy, fz), fy, fz)); };
    // machined links: flat tops, tight chamfer, rows nearly touching (wood links keep a softer edge)
    // crowned tops: tilt top-face normals outward so each link sweeps a gradient of the softbox instead of flipping light/dark row by row
    const crown = (geo, kx = .32, kz = .2) => { geo.computeBoundingBox(); const bb = geo.boundingBox, hx = (bb.max.x - bb.min.x) / 2, hz = (bb.max.z - bb.min.z) / 2, P = geo.attributes.position, N = geo.attributes.normal, v = new THREE.Vector3();
      for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(N, i); if (Math.abs(v.y) < .6) continue; const sy = Math.sign(v.y); v.x += P.getX(i) / hx * kx; v.z += P.getZ(i) / hz * kz; v.y = sy; v.normalize(); N.setXYZ(i, v.x, v.y, v.z); } N.needsUpdate = true; return geo; };
    const wood = t === 'woodlinks', geos = L.p.map(([, w]) => (g => wood ? g : crown(g))(new RoundedBoxGeometry(L.lw * w, L.th, L.pitch * (wood ? .95 : .99), wood ? 5 : 3, wood ? Math.min(.05, L.th * .35) : Math.min(.022, L.th * .18))));
    [0, 1].forEach(u => { const p = curve.getPointAt(u), T = curve.getTangentAt(u), q = frame(T); const e = mk(crown(new RoundedBoxGeometry(L.lw * (integ ? 1 : .98), L.th * 1.15, .34, 4, .05), .25, .35), t === 'woodlinks' ? mats.A : M.polished); e.position.copy(p).addScaledVector(T, u ? .12 : -.12).add(new THREE.Vector3(0, -.02, 0)); e.quaternion.copy(q); }); // solid end links
    for (let i = 0; i < n; i++) {
      const u = (i + .5) / n, p = curve.getPointAt(u), q = frame(curve.getTangentAt(u));
      const taper = lerp(1, t === 'integrated' ? .84 : .88, 1 - Math.abs(u - .5) * 2);
      if (Math.abs(u - .5) < .55 / n) { const c = mk(crown(new RoundedBoxGeometry(L.lw * taper, L.th * .8, L.pitch * 1.8, 3, .03), .25, .5), M.polished); c.position.copy(p); c.quaternion.copy(q); continue; }
      const link = new THREE.Group(); link.position.copy(p); link.quaternion.copy(q); link.scale.set(taper, 1, 1); grp.add(link);
      L.p.forEach(([x, , m], j) => { const pc = mk(geos[j], mats[m], link); pc.position.x = x * L.lw; if (t === 'jubilee' && m === 'P' && i % 2) { if (x < 0) pc.position.x = 0; else pc.visible = false; } }); // jubilee: staggered centre links
    }
  },
  tickHands() {
    if (this.lcd) this.lcd();
    if (!this.hands) return;
    const t = new Date(), s = t.getSeconds() + t.getMilliseconds() / 1000, m = t.getMinutes() + s / 60, h = (t.getHours() % 12) + m / 60;
    const quartz = /quartz/i.test(S.current?.watch?.movement || '') && !/meca/i.test(S.current?.watch?.movement || '');
    const ss = quartz ? Math.floor(s) : s; // quartz ticks, mechanical sweeps
    this.hands.s.rotation.y = -ss / 60 * Math.PI * 2; this.hands.m.rotation.y = -m / 60 * Math.PI * 2; this.hands.h.rotation.y = -h / 12 * Math.PI * 2;
    if (this.balance) this.balance.rotation.y = Math.sin(performance.now() / 1000 * Math.PI * 2 * 4) * 1.9; // 4 Hz / 28,800 vph
    const now = performance.now() / 1000; (this.wheels || []).forEach(w => { w.m.rotation.y = w.esc ? -Math.floor(now * 8) * Math.PI / 15 : now * w.spin; }); // escape wheel steps half a tooth per beat
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
      const band = ['leather', 'rubber', 'nato'].includes(W.strap), shock = W.head === 'shock', hide = shock ? ' style="display:none"' : '';
      L.innerHTML = `<div class="sec"><h4><em>A</em>Style presets</h4><div class="grid2">${WATCH_PRESETS.map(([n], i) => `<button class="btn sm" style="white-space:normal;text-align:left;justify-content:flex-start;line-height:1.25" data-wpreset="${i}">${n}</button>`).join('')}</div>
          <p class="hint" style="margin-top:8px">Starting points. Every field below stays editable.</p></div>
        <div class="sec"><h4><em>B</em>Case</h4>
          <div class="fld"${hide}><label>Shape</label><div class="seg" data-segbind="watch.shape">${Object.entries(CASE_SHAPES).map(([k, v]) => `<button data-v="${k}" style="padding:7px 2px;font-size:10.5px" class="${k === W.shape ? 'on' : ''}">${v === 'Rectangle' ? 'Rect' : v}</button>`).join('')}</div></div>
          <div class="fld" style="margin-top:10px"><label>Case build<b>${W.head === 'sport' ? 'Modelled head' : 'Parametric'}</b></label><div class="seg" data-segbind="watch.head">${[['built', 'Parametric'], ['sport', 'Sport · modelled'], ['shock', 'Shock · resin']].map(([k, v]) => `<button data-v="${k}" class="${k === (W.head || 'built') ? 'on' : ''}">${v}</button>`).join('')}</div>${W.head === 'sport' ? '<p class="hint" style="margin-top:6px">Round titanium sport case with long curved lugs. Shape and bezel style are fixed; metal, dial, hands and strap stay editable.</p>' : ''}</div>
          ${shock ? `<div class="grid2" style="margin-top:10px"><div class="fld"><label>Display</label><div class="seg" data-segbind="watch.display">${[['digital', 'Digital'], ['anadigi', 'Ana-digi']].map(([k, v]) => `<button data-v="${k}" class="${k === (W.display || 'digital') ? 'on' : ''}">${v}</button>`).join('')}</div></div><div class="fld"><label>LCD</label><div class="seg" data-segbind="watch.lcd">${[['pos', 'Positive'], ['neg', 'Negative']].map(([k, v]) => `<button data-v="${k}" class="${k === (W.lcd || 'pos') ? 'on' : ''}">${v}</button>`).join('')}</div></div></div>
          <div class="grid2" style="margin-top:10px">${cp('watch.strapColor', 'Resin (case + strap)', W.strapColor)}${cp('watch.accent', 'Accent print', W.accent)}</div><p class="hint" style="margin-top:6px">Shock-resistant resin case with a live LCD. Material below sets the screws, pushers and caseback.</p>` : ''}
          <div style="margin-top:10px">${this.select('watch.caseMat', 'Material', W.caseMat, kv(CASE_MATS))}</div>
          ${W.caseMat === 'wood' ? `<div class="grid2" style="margin-top:10px">${this.select('watch.caseWood', 'Species', W.caseWood, woods)}${this.select('watch.bezel', 'Bezel metal', W.bezel, kv(BEZELS))}</div>` : ''}
          <div style="margin-top:10px">${this.range('watch.dia', 'Case size', W.dia, 34, 46, 1, v => v + ' mm')}</div>
          <div class="grid2" style="margin-top:10px">${this.select('watch.crownGuards', 'Crown guards', W.crownGuards, [['', 'No'], ['1', 'Yes']])}${this.select('watch.crystal', 'Crystal', W.crystal, [['Sapphire', 'Sapphire'], ['Domed sapphire', 'Domed sapphire'], ['Mineral', 'Hardened mineral']])}</div></div>
        <div class="sec"${hide}><h4><em>C</em>Bezel</h4>${this.select('watch.bezelStyle', 'Style', W.bezelStyle, kv(BEZEL_STYLES))}
          ${/diver|gmt|tachy/.test(W.bezelStyle) ? `<div class="grid2" style="margin-top:10px">${cp('watch.bezelColor', W.bezelStyle === 'gmt' ? 'Day half' : 'Insert', W.bezelColor)}${W.bezelStyle === 'gmt' ? cp('watch.bezelColor2', 'Night half', W.bezelColor2) : ''}</div>` : ''}
          ${W.shape !== 'round' ? '<p class="hint" style="margin-top:8px">Inserts and gem-setting render on round cases. Shaped cases use a fitted frame.</p>' : ''}</div>
        <div class="sec"><h4><em>D</em>Dial</h4>${this.select('watch.dialStyle', 'Dial style', W.dialStyle, kv(DIAL_STYLES))}
          <div style="margin-top:10px">${this.colorField('watch.dial', 'Dial color', W.dial)}</div>
          <div class="grid2" style="margin-top:12px">${cp('watch.index', 'Indices / hands', W.index)}${cp('watch.accent', 'Seconds hand', W.accent)}</div>
          <div class="grid2" style="margin-top:10px">${this.select('watch.numerals', 'Numerals', W.numerals, kv(NUMERALS))}${this.select('watch.hands', 'Hands', W.hands, kv(HANDS))}</div>
          <div class="grid3" style="margin-top:10px">${this.select('watch.date', 'Date', W.date, [['none', 'None'], ['3', '3 o\'clock'], ['6', '6 o\'clock']])}<div class="fld"><label>Edition N°</label><input class="in mono" type="number" min="1" max="${d.edition || 150}" data-bind="watch.editionNo" data-num value="${W.editionNo}"></div><div class="fld"><label>Cap</label><input class="in mono" type="number" min="1" data-bind="edition" data-num value="${d.edition || 150}"></div></div></div>
        <div class="sec"${hide}><h4><em>E</em>Bracelet / strap</h4>${this.select('watch.strap', 'Type', W.strap, kv(STRAPS))}
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
          ${g.sockStyle === 'noshow' ? '' : `<div class="grid2" style="margin-top:10px">${this.select('garment.stripes', 'Cuff stripes', String(g.stripes || 0), [['0', 'None'], ['1', '1 stripe'], ['2', '2 stripes'], ['3', '3 stripes'], ['4', '4 stripes']])}<div class="fld"><label>Stripe color</label><div class="row"><input type="color" data-bind="garment.stripeCol" value="${g.stripeCol || '#B98A4A'}"><span class="mono">${(g.stripeCol || '#B98A4A').toUpperCase()}</span></div></div></div>`}` : d.category === 'duffle' ? `<div class="fld" style="margin-top:10px"><label>Size</label><div class="seg" data-segbind="garment.bagSize">${[['mini', 'Mini 16"'], ['weekender', 'Weekender 22"'], ['large', 'Large 26"']].map(([k, v]) => `<button data-v="${k}" class="${k === (g.bagSize || 'weekender') ? 'on' : ''}">${v}</button>`).join('')}</div></div>
          <div class="fld" style="margin-top:10px"><label>Hardware</label><div class="seg" data-segbind="garment.hardware">${[['gunmetal', 'Gunmetal'], ['steel', 'Steel'], ['gold', 'Brass'], ['black', 'Matte black']].map(([k, v]) => `<button data-v="${k}" class="${k === (g.hardware || 'gunmetal') ? 'on' : ''}">${v}</button>`).join('')}</div></div>
          <div class="fld" style="margin-top:10px"><label>Trim leather (handles, straps, piping)</label><div class="row"><input type="color" data-bind="garment.trim" value="${g.trim && g.trim !== '#EEF1F9' ? g.trim : g.color}"><span class="mono">${(g.trim && g.trim !== '#EEF1F9' ? g.trim : g.color).toUpperCase()}</span></div></div>` : `<div class="fld" style="margin-top:10px"><label>Fit</label><div class="seg" data-segbind="garment.fit">${Object.entries(FITS).map(([k, v]) => `<button data-v="${k}" class="${k === g.fit ? 'on' : ''}">${v.label}</button>`).join('')}</div></div>`}
        ${d.category === 'pants' ? `<div class="fld" style="margin-top:10px"><label>Cut</label><div class="seg" data-segbind="garment.pantStyle">${[['straight', 'Straight'], ['slim', 'Slim']].map(([k, v]) => `<button data-v="${k}" class="${k === (g.pantStyle || 'straight') ? 'on' : ''}">${v}</button>`).join('')}</div></div>` : ''}
        <div style="margin-top:10px">${this.select('garment.fabric', 'Fabric', g.fabric, Object.entries(FABRICS).filter(([k, v]) => k === g.fabric || (v.for === 'any' && d.category !== 'duffle') || (isAcc(d.category) && d.category !== 'duffle' && v.for === 'acc') || v.for === (d.category === 'duffle' ? 'bag' : isTop(d.category) || isAcc(d.category) ? 'top' : d.category === 'socks' ? 'socks' : d.category === 'boxers' ? 'boxers' : 'bottom')).map(([k, v]) => [k, v.label]))}</div>
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
    $$('[data-wpreset]', L).forEach(b => b.onclick = () => { const pre = WATCH_PRESETS[b.dataset.wpreset][1]; if (d.watch.head === 'shock' && !pre.head) d.watch.head = 'built'; Object.assign(d.watch, pre); touch(); Studio.build(); this.studio(); toast(WATCH_PRESETS[b.dataset.wpreset][0] + ' applied'); });
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
  if (/^watch\.(caseMat|bezelStyle|strap|dialStyle|head)$|^garment\.(pattern|doubleWB|wb2Pattern|sockStyle|pantStyle|bagSize|hardware)$/.test(path)) { Studio.build(); Panels.studio(); return; }
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
        ['Case', W.head === 'shock' ? `Shock-resistant resin, ${W.display === 'anadigi' ? 'ana-digi' : 'digital'} ${W.lcd === 'neg' ? 'negative' : 'positive'} LCD · ${W.dia} mm · ${CASE_MATS[W.caseMat]?.label || 'steel'} hardware` : `${CASE_SHAPES[W.shape]} · ${W.dia} mm · ${W.caseMat === 'wood' ? WOODS[W.caseWood].label : CASE_MATS[W.caseMat].label}`],
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
    if (W.head === 'shock') return `a chunky shock-resistant sports wristwatch in matte ${colorName(W.strapColor)} (${W.strapColor}) resin with an integrated resin strap, rounded-square raised bezel with four exposed ${CASE_MATS[W.caseMat]?.label.toLowerCase() || 'steel'} screws and moulded grip ribs, four guarded pushers; recessed ${colorName(W.dial)} face with ${W.display === 'anadigi' ? 'analog hands over a small' : 'a large'} ${W.lcd === 'neg' ? 'negative (dark) ' : ''}seven-segment LCD, ${colorName(W.accent)} accent print, small DPP mark. No other brand names or logos. Flat mineral glass, rugged and technical`;
    return `a ${W.dia} mm ${CASE_SHAPES[W.shape].toLowerCase()} wristwatch in ${mat}${bez}${W.crownGuards ? ', crown guards' : ''}; ${colorName(W.dial)} (${W.dial}) ${dialTxt}, ${NUMERALS[W.numerals].toLowerCase()}, ${HANDS[W.hands].toLowerCase()} hands in ${colorName(W.index)}, ${colorName(W.accent)} seconds hand${W.date !== 'none' ? `, date window at ${W.date} o'clock` : ''}; ${strapTxt}. Small text "N° ${String(W.editionNo).padStart(3, '0')}/${d.edition || 150}" on the dial. Sapphire crystal with crisp reflections, precise machining, realistic metal finishing`;
  }
  const noun = { tee: 'T-shirt', longsleeve: 'long-sleeve T-shirt', crewneck: 'crewneck sweatshirt', hoodie: 'pullover hoodie', pants: 'pair of straight-leg pants', shorts: 'pair of shorts', boxers: 'pair of boxer briefs', socks: d.garment.sockStyle === 'noshow' ? 'pair of no-show socks' : 'pair of crew socks', scarf: 'wrap scarf with hood', balaclava: 'knit balaclava', duffle: 'barrel weekender duffle bag' }[d.category];
  const f = FABRICS[g.fabric], fit = FITS[g.fit].label.toLowerCase();
  const build = { tee: 'ribbed crew neck, dropped shoulders, twin-needle hems', longsleeve: 'ribbed crew neck, ribbed cuffs', crewneck: 'ribbed crew neck, ribbed cuffs and waistband', hoodie: 'lined hood with flat drawcords and metal aglets, kangaroo pocket, ribbed cuffs and waistband', pants: 'five-pocket construction, belt loops, shank button' + (d.garment.doubleWB === '1' ? ', a second exposed waistband stacked above the main waistband' : ''), shorts: 'elastic waistband with drawcords, side pockets' + (d.garment.doubleWB === '1' ? ', a second exposed waistband above the main band' : ''), boxers: 'jacquard elastic waistband, contoured pouch, button fly', scarf: 'soft drape, rolled edges', duffle: 'rolled leather handles joined by a snap wrap, wrap-under handle straps, piped end panels, metal zip, detachable shoulder strap with pad, luggage tag', balaclava: 'single eye opening, flatlock seams, bib hem', socks: 'ribbed cuff, Y-heel, terry footbed' + (d.garment.sockAccent === '1' ? ', contrast heel and toe' : '') + (num(d.garment.stripes) ? `, ${d.garment.stripes} athletic stripes below the cuff` : '') }[d.category];
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
