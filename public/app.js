const $ = (s, el = document) => el.querySelector(s);
const eur = (n) => (n == null ? '—' : n.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' }));
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Externe foto's via eigen proxy (omzeilt hotlink-blokkades); lokale foto's rechtstreeks
const img = (u) => (!u ? '' : u.startsWith('/') ? u : `/api/img?u=${encodeURIComponent(u)}`);
document.addEventListener('error', (e) => {
  const t = e.target;
  if (t.tagName === 'IMG' && !t.dataset.failed) {
    t.dataset.failed = '1';
    t.outerHTML = '<div class="noimg">🎁</div>';
  }
}, true);
const SOURCE = { '2dehands': '2dehands', marktplaats: 'Marktplaats', vinted: 'Vinted', tweakers: 'via Tweakers', webshop: 'webshop' };

let state = { items: [], filter: 'all' };

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

function countdown() {
  const now = new Date();
  const xmas = new Date(now.getFullYear(), 11, 25);
  if (now > xmas) xmas.setFullYear(xmas.getFullYear() + 1);
  const days = Math.ceil((xmas - now) / 864e5);
  $('#countdown').textContent = `Nog ${days} dagen tot Kerstmis`;
}

function trustBadge(t) {
  if (!t) return '';
  const cls = t.score >= 70 ? '' : t.score >= 55 ? 'mid' : 'low';
  const title = [t.source, ...(t.notes || [])].filter(Boolean).join(' · ');
  return `<span class="badge ${cls}" title="${esc(title)}">🛡 ${t.score} · ${esc(t.label)}</span>`;
}

function fakeBadge(risk) {
  if (!risk || risk === 'unknown') return '';
  const map = { low: ['', 'Echtheid: laag risico'], medium: ['mid', 'Echtheid: twijfel'], high: ['low', 'Namaakrisico hoog'] };
  const [cls, txt] = map[risk] || ['neutral', risk];
  return `<span class="badge ${cls}">${txt}</span>`;
}

function sparkline(history = []) {
  if (history.length < 2) return '';
  const v = history.map((h) => h.total);
  const min = Math.min(...v), max = Math.max(...v), w = 120, h = 26;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * w},${h - 3 - ((x - min) / (max - min || 1)) * (h - 6)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-label="prijsverloop"><polyline fill="none" stroke="#1f5a43" stroke-width="2" points="${pts}"/></svg>`;
}

function breakdown(o) {
  if (o.cost?.breakdown) {
    return o.cost.breakdown.map((b) => `${esc(b.label)} ${eur(b.amount)}`).join(' + ') + (o.cost.estimated ? ' <span title="geschat">≈</span>' : '');
  }
  const ship = o.shipping == null ? 'verzending onbekend' : o.shipping === 0 ? 'gratis verzending' : `+ ${eur(o.shipping)} verzending`;
  return `${eur(o.price)} · ${ship}`;
}

function dealBlock(item, r) {
  const b = r?.best;
  if (!b) {
    return `<div class="deal none"><div><div class="label">Nog geen deal die aan alles voldoet</div>
      <div class="breakdown">${item.type === 'secondhand' ? `Gezocht: zeer goede staat of beter, max ${eur(item.maxPrice)}.` : 'De agent zoekt elke ochtend opnieuw.'}</div></div></div>`;
  }
  const isSh = item.type === 'secondhand';
  const name = isSh ? `${esc(b.title)}` : esc(b.shop);
  const photos = isSh && b.photos?.length ? `<div class="deal-photos">${b.photos.slice(0, 4).map((p) => `<a href="${esc(b.url)}" target="_blank" rel="noopener"><img src="${esc(img(p))}" alt="" loading="lazy"></a>`).join('')}</div>` : '';
  return `<div class="deal">
    <div>
      <div class="label">★ Beste deal</div>
      <div class="price">${eur(b.total)}</div>
      <div class="shop">${name} ${isSh ? `<span class="small">· ${SOURCE[b.source] || b.source}${b.size ? ' · ' + esc(b.size) : ''}${b.conditionLabel ? ' · ' + esc(b.conditionLabel) : ''}</span>` : ''}</div>
      <div class="breakdown">${breakdown(b)}${b.delivery ? ' · ' + esc(b.delivery) : ''}</div>
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${trustBadge(b.trust)} ${isSh ? fakeBadge(b.fakeRisk) : ''}</div>
      ${b.vision?.summary ? `<div class="small" style="margin-top:6px">📷 ${esc(b.vision.summary)}</div>` : ''}
      ${photos}
    </div>
    <a class="btn" href="${esc(b.url)}" target="_blank" rel="noopener">Bekijk →</a>
  </div>`;
}

function offersTable(item, r) {
  const offers = r?.offers || [];
  const rejected = r?.rejected || [];
  if (!offers.length && !rejected.length) return '';
  const isSh = item.type === 'secondhand';
  const row = (o, muted = false) => {
    const reasons = o.reasons?.length ? `<div class="small">✗ ${o.reasons.map(esc).join(' · ')}</div>` : '';
    const thumb = isSh && o.photos?.[0] ? `<img class="thumb" src="${esc(img(o.photos[0]))}" alt="" loading="lazy">` : '';
    const name = isSh ? esc(o.title) : esc(o.shop);
    const sub = isSh
      ? `${SOURCE[o.source] || o.source}${o.size ? ' · ' + esc(o.size) : ''}${o.condition ? ' · ' + esc(o.condition) : ''}${o.location ? ' · ' + esc(o.location) : ''}`
      : `${o.delivery ? esc(o.delivery) : ''}${o.seller ? ' · verkoper: ' + esc(o.seller) : ''}`;
    return `<tr class="${o.status === 'best' ? 'is-best' : ''} ${muted || ['afgekeurd', 'te weinig betrouwbaar', 'niet op voorraad'].includes(o.status) ? 'muted' : ''}">
      ${isSh ? `<td style="width:60px">${thumb}</td>` : ''}
      <td><a href="${esc(o.url)}" target="_blank" rel="noopener"><b>${name}</b></a> ${o.status === 'best' ? '★' : ''}
        <div class="small">${sub}</div>${reasons}</td>
      <td class="hide-sm">${trustBadge(o.trust)} ${isSh ? fakeBadge(o.fakeRisk) : ''}</td>
      <td class="num">${o.total != null ? eur(o.total) : o.price != null ? eur(o.price) : 'bieden'}<div class="small">${o.total != null ? breakdown(o) : ''}</div></td>
    </tr>`;
  };
  const stats = r.stats ? `<p class="small">Gevonden onder budget: ${r.stats.found} · na tekstfilter: ${r.stats.textPassed} · met foto's gecontroleerd: ${r.stats.photoChecked} · goedgekeurd: ${r.stats.approved}</p>` : '';
  return `<details>
    <summary>${isSh ? 'Gecontroleerde advertenties' : 'Alle aanbiedingen'} (${offers.length})${rejected.length ? ` · ${rejected.length} afgewezen` : ''}</summary>
    ${stats}
    <table class="offers"><tbody>${offers.map((o) => row(o)).join('')}${rejected.map((o) => row(o, true)).join('')}</tbody></table>
  </details>`;
}

function card(item) {
  const r = item.result;
  const isSh = item.type === 'secondhand';
  const cover = isSh ? (r?.best?.photos?.[0] || item.referenceImage) : (item.image || r?.image);
  const checked = r?.checkedAt ? new Date(r.checkedAt).toLocaleString('nl-BE', { dateStyle: 'medium', timeStyle: 'short' }) : 'nog niet';
  const warnings = (r?.warnings || []).map((w) => `<p class="warn">${esc(w)}</p>`).join('');
  return `<article class="card" data-type="${item.type}">
    <div class="media">
      <span class="tag ${isSh ? 'sh' : ''}">${isSh ? 'Tweedehands' : 'Nieuw'}</span>
      ${cover ? `<img src="${esc(img(cover))}" alt="${esc(item.name)}" loading="lazy">` : '<div class="small">Foto volgt na eerste check</div>'}
      ${isSh && r?.best ? `<div class="ref"><img src="${esc(item.referenceImage)}" alt=""><span>gezocht</span></div>` : ''}
    </div>
    <div class="body">
      <div class="title-row">
        <div>
          <h2>${esc(item.name)}</h2>
          <div class="meta">${isSh ? `Budget ${eur(item.maxPrice)} · staat zeer goed tot uitstekend · ` : ''}Laatste check: ${checked}${r?.seed ? ' (startcheck)' : ''}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">${sparkline(r?.history)}<button class="icon-btn" data-edit="${item.id}">Aanpassen</button></div>
      </div>
      ${dealBlock(item, r)}
      ${item.note ? `<p class="small">ℹ️ ${esc(item.note)}</p>` : ''}
      ${warnings}
      ${offersTable(item, r)}
    </div>
  </article>`;
}

function render() {
  const items = state.items.filter((i) => state.filter === 'all' || i.type === state.filter);
  $('#list').innerHTML = items.map(card).join('');
  const bests = state.items.map((i) => i.result?.best?.total).filter((x) => x != null);
  const found = bests.length;
  $('#summary').innerHTML = `
    <div class="stat"><b>${found}/${state.items.length}</b><small>items met deal</small></div>
    <div class="stat"><b>${eur(bests.reduce((a, b) => a + b, 0))}</b><small>totaal beste deals</small></div>`;
}

async function loadData() {
  const res = await fetch('/api/wishlist');
  const data = await res.json();
  state.items = data.items;
  const last = data.lastRun?.finishedAt ? new Date(data.lastRun.finishedAt).toLocaleString('nl-BE', { dateStyle: 'full', timeStyle: 'short' }) : 'nog nooit';
  $('#status').textContent = data.running ? '⏳ De agent is nu aan het zoeken…' : `Laatste ronde: ${last} · volgende: elke ochtend om 07:00`;
  $('#runBtn').disabled = data.running;
  render();
  if (data.running) setTimeout(loadData, 8000);
}

function token() {
  let t = store.get('adminToken');
  if (!t) {
    t = prompt('Admin-wachtwoord (ADMIN_TOKEN):');
    if (t) store.set('adminToken', t);
  }
  return t;
}

async function api(method, url, body) {
  const t = token();
  if (!t) return null;
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'x-admin-token': t }, body: JSON.stringify(body || {}) });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) store.set('adminToken', '');
  if (!res.ok) alert(json.error || 'Er ging iets mis');
  return res.ok ? json : null;
}

$('#runBtn').addEventListener('click', async () => {
  if (await api('POST', '/api/run')) setTimeout(loadData, 1500);
});

document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
  document.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === c));
  state.filter = c.dataset.filter;
  render();
}));

$('#list').addEventListener('click', (e) => {
  const id = e.target.closest('[data-edit]')?.dataset.edit;
  if (!id) return;
  const item = state.items.find((i) => i.id === id);
  const isSh = item.type === 'secondhand';
  $('#dlgBody').innerHTML = `
    <label>Naam<input name="name" value="${esc(item.name)}"></label>
    ${isSh
      ? `<label>Zoektermen (komma-gescheiden)<input name="searchQueries" value="${esc((item.searchQueries || []).join(', '))}"></label>
         <label>Maximumprijs (€)<input name="maxPrice" type="number" step="1" value="${item.maxPrice}"></label>`
      : `<label>Zoekterm<input name="searchQuery" value="${esc(item.searchQuery || '')}"></label>
         <label>EAN (optioneel)<input name="ean" value="${esc(item.ean || '')}"></label>`}`;
  const dlg = $('#dlg');
  dlg.returnValue = '';
  dlg.showModal();
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'ok') return;
    const f = new FormData($('#dlgForm'));
    const patch = Object.fromEntries(f.entries());
    if (patch.searchQueries) patch.searchQueries = patch.searchQueries.split(',').map((s) => s.trim()).filter(Boolean);
    if (!isSh && patch.searchQuery) patch.needsResolve = false;
    if (await api('PATCH', `/api/items/${id}`, patch)) loadData();
  };
});

countdown();
loadData();
