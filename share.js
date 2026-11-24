// DPP supplier packet viewer. Reads one packet (shares/{token}) from the studio's Firestore with no sign-in: the token
// in the URL hash is the key, and firestore.rules only allow reading a packet that is live (not revoked, not expired)
// and adding one view. The hash never reaches a server log or a referrer.
// #preview: the studio opens this page and posts a packet straight in (no cloud needed: device-only studios, testing).
const FB_V = '12.6.0';
const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const state = (title, body) => { app.innerHTML = `<div class="state"><div><span class="mark" style="display:inline-block;background:#14172B;width:64px;height:54px"></span><h1>${esc(title)}</h1><p>${esc(body)}</p></div></div>`; };
const fmtSize = n => n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';
const dataSize = s => Math.round((s.length - s.indexOf(',') - 1) * .75);
function save(name, data, mime) {
  const blob = data.startsWith('data:') ? null : new Blob([data], { type: mime });
  const url = blob ? URL.createObjectURL(blob) : data;
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  if (blob) setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function render(head, get) {
  const files = head.files || [], renders = files.filter(f => f.kind === 'render'), tp = files.find(f => f.kind === 'tp'), other = files.filter(f => f.kind !== 'render');
  document.title = `DPP · ${head.styleNo} ${head.name} · Supplier packet`;
  const exp = head.exp?.toMillis ? head.exp.toMillis() : head.exp;
  if (exp) document.getElementById('exp').textContent = 'Link valid until ' + new Date(exp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  app.innerHTML = `
  <div class="hero"><div class="wrap">
    <span class="cap">Prepared for ${esc(head.to || 'you')} · from ${esc(head.from || 'DPP')}, DPP (Don't Postpone Passion)</span>
    <h1>${esc(head.name)}</h1>
    <div class="meta"><div><span class="cap">Style</span><b>${esc(head.styleNo)}</b></div><div><span class="cap">Category</span><b>${esc(head.category)}</b></div><div><span class="cap">Request</span><b>Quote + sample</b></div></div>
  </div></div>
  ${renders.length ? `<section><div class="wrap"><h2>Renders <span class="cap">${renders.length} views · full resolution on download</span></h2>
    <div class="gal"><div class="stage"><img id="big" alt=""><a class="btn dl" id="bigDl" href="#">Download</a></div>
    <div class="thumbs">${renders.map((f, i) => `<button data-k="${esc(f.key)}" class="${i ? '' : 'on'}" aria-label="${esc(f.label)}"><img alt=""><span>${esc(f.label)}</span></button>`).join('')}</div></div></div></section>` : ''}
  ${tp ? `<section><div class="wrap"><h2>Tech pack <span class="cap">measurements · BOM · construction · artwork</span></h2>
    <div class="tp-tools"><button class="btn" id="tpPrint" disabled>Print / save PDF</button><button class="btn ghost" id="tpDl" disabled>Download</button></div>
    <iframe class="tp-frame" id="tp" title="Tech pack" sandbox="allow-same-origin allow-modals allow-popups"></iframe></div></section>` : ''}
  <section><div class="wrap"><h2>Files <span class="cap">${files.length}</span></h2><div class="files">${files.map(f => `<div class="file"><div><b>${esc(f.label)}</b><span class="cap">${esc(f.name)} · ${fmtSize(f.kind === 'tp' ? f.len : Math.round(f.len * .75))}</span></div><span class="cap">${esc(f.mime.split('/')[1] || '')}</span><button class="btn ghost" data-dl="${esc(f.key)}">Download</button></div>`).join('')}</div></div></section>
  <footer><div class="wrap"><p>Confidential. Shared by DPP for quoting and sampling only: please don't forward or reuse these designs.</p><p>Questions? Reply to the message this link came with.</p></div></footer>`;

  // renders: thumbnails first (the stage loads the first one), each fetched once
  const cache = new Map(), load = k => { if (!cache.has(k)) cache.set(k, get(k)); return cache.get(k); };
  const big = document.getElementById('big'), bigDl = document.getElementById('bigDl');
  const show = async k => { const f = renders.find(x => x.key === k); const d = await load(k); big.src = d; big.alt = `${head.name}, ${f.label}`; bigDl.onclick = e => { e.preventDefault(); save(f.name, d, f.mime); };
    document.querySelectorAll('.thumbs button').forEach(b => b.classList.toggle('on', b.dataset.k === k)); };
  document.querySelectorAll('.thumbs button').forEach(b => { b.onclick = () => show(b.dataset.k); load(b.dataset.k).then(d => { b.querySelector('img').src = d; }).catch(() => { }); });
  if (renders[0]) show(renders[0].key);

  if (tp) load(tp.key).then(html => {
    const fr = document.getElementById('tp');
    // the tech pack pages are 11 × 8.5 in: scale them to the frame so phones see whole pages (the frame runs no scripts)
    fr.srcdoc = html.replace('</head>', '<style>#tpScroll{zoom:var(--z,1)}</style></head>');
    const fit = () => { try { fr.contentDocument.documentElement.style.setProperty('--z', Math.min(1, (fr.clientWidth - 24) / 1056)); } catch { /* not loaded */ } };
    fr.onload = fit; addEventListener('resize', fit);
    document.getElementById('tpPrint').disabled = false; document.getElementById('tpDl').disabled = false;
    document.getElementById('tpPrint').onclick = () => { const de = fr.contentDocument.documentElement; de.style.setProperty('--z', 1); fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(fit, 500); };
    document.getElementById('tpDl').onclick = () => save(tp.name, html, 'text/html');
  }).catch(() => { });
  document.querySelectorAll('[data-dl]').forEach(b => b.onclick = async () => { const f = files.find(x => x.key === b.dataset.dl); b.disabled = true; const t = b.textContent; b.textContent = 'Preparing…'; try { save(f.name, await load(f.key), f.mime); } finally { b.disabled = false; b.textContent = t; } });
}

async function fromCloud(token) {
  const cfg = await fetch('cloud-config.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
  if (!cfg) return state('Packet unavailable', 'This studio is not connected to the cloud.');
  const u = m => `https://www.gstatic.com/firebasejs/${FB_V}/firebase-${m}.js`;
  const [{ initializeApp }, F] = await Promise.all([import(u('app')), import(u('firestore-lite'))]);
  const db = F.getFirestore(initializeApp(cfg));
  let head;
  try { const h = await F.getDoc(F.doc(db, 'shares', token)); if (!h.exists()) throw new Error('missing'); head = h.data(); }
  catch { return state('This link has expired', 'Packets stay live for a limited time and can be withdrawn. Ask your DPP contact for a fresh link.'); }
  const get = async key => { const f = head.files.find(x => x.key === key), parts = await Promise.all(Array.from({ length: f.n }, (_, i) => F.getDoc(F.doc(db, 'shares', token, 'b', key, 'c', String(i).padStart(3, '0'))).then(s => s.data().d))); const s = parts.join(''); if (s.length !== f.len) throw new Error('incomplete'); return s; };
  render(head, get);
  F.updateDoc(F.doc(db, 'shares', token), { views: F.increment(1), seen: F.serverTimestamp() }).catch(() => { }); // count the view; rules allow exactly this
}

function fromPreview() {
  state('Preview', 'Waiting for the studio…');
  addEventListener('message', e => {
    if (e.origin !== location.origin || e.data?.type !== 'dpp-packet') return;
    const { head, files } = e.data, by = new Map(files.map(f => [f.key, f.data]));
    render({ ...head, files: files.map(({ data, ...f }) => ({ ...f, len: data.length, n: 1 })) }, async k => by.get(k));
  });
  window.opener?.postMessage({ type: 'dpp-packet-ready' }, location.origin);
}

const tok = decodeURIComponent(location.hash.slice(1));
if (tok === 'preview') fromPreview();
else if (/^[\w-]{16,64}$/.test(tok)) fromCloud(tok).catch(e => { console.error(e); state('Packet unavailable', 'Something went wrong loading this packet. Try again in a minute.'); });
else state('No packet here', 'Open the full link from your DPP message.');
