const $ = (s) => document.querySelector(s);
const eur = (n) => n.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' });
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const img = (u) => (!u ? '' : u.startsWith('/') ? u : `/api/img?u=${encodeURIComponent(u)}`);
const SOURCE = { '2dehands': '2dehands', marktplaats: 'Marktplaats', vinted: 'Vinted' };

// Nettere namen voor familie (zonder technische details)
const NICE = {
  'wd-black-c50': { title: 'Opslaguitbreiding voor de Xbox', sub: 'WD_BLACK C50 · 512 GB' },
  'gamesir-g7-he': { title: 'Xbox-controller', sub: 'GameSir G7 HE · zwart' },
  'amazon-item': { title: 'Gaming-toetsenbord', sub: 'DAREU EK60 HE · zwart' },
  'ami-paris': { title: 'Ami Paris-trui', sub: 'Zwart of grijs met hartlogo · maat L of XL' },
  'stone-island': { title: 'Stone Island-trui', sub: 'Grijs met badge · maat L of XL' },
  'essentials-hoodie': { title: 'Essentials-hoodie', sub: 'Fear of God · lichtgrijs · maat L of XL' },
};

document.addEventListener('error', (e) => {
  const t = e.target;
  if (t.tagName === 'IMG' && !t.dataset.fallback && t.dataset.alt) {
    t.dataset.fallback = '1';
    t.src = t.dataset.alt;
  } else if (t.tagName === 'IMG' && !t.dataset.failed) {
    t.dataset.failed = '1';
    t.replaceWith(Object.assign(document.createElement('div'), { className: 'noimg', textContent: '🎁' }));
  }
}, true);

function countdown() {
  const now = new Date();
  const xmas = new Date(now.getFullYear(), 11, 25);
  if (now > new Date(now.getFullYear(), 11, 26)) xmas.setFullYear(xmas.getFullYear() + 1);
  const days = Math.ceil((xmas - now) / 864e5);
  $('#countdown').textContent = days > 1 ? `Nog ${days} nachtjes slapen` : days === 1 ? 'Morgen is het Kerstmis!' : 'Vrolijk kerstfeest! 🎄';
}

function card(item) {
  const nice = NICE[item.id] || { title: item.name, sub: '' };
  const r = item.result || {};
  const b = r.best;
  const isSh = item.type === 'secondhand';
  const photo = isSh ? b?.photos?.[0] || item.referenceImage : item.image || r.image;
  const fallback = isSh ? item.referenceImage : '';

  let deal;
  if (b && b.total != null) {
    const where = isSh ? SOURCE[b.source] || 'tweedehands' : (b.shop || '').replace(/^Laagste prijs op Tweakers.*$/, 'Tweakers (beste winkel)');
    const extra = isSh ? [b.sizeLetter ? `maat ${b.sizeLetter}` : '', b.conditionLabel ? `staat: ${b.conditionLabel.toLowerCase()}` : ''].filter(Boolean).join(' · ') : '';
    deal = `
      <div class="price-row">
        <div>
          <span class="label">Beste prijs</span>
          <span class="price">${eur(b.total)}</span>
          <span class="where">bij ${esc(where)}${extra ? ` · ${esc(extra)}` : ''}</span>
        </div>
        <a class="buy" href="${esc(b.url)}" target="_blank" rel="noopener">Bekijk <span aria-hidden="true">→</span></a>
      </div>`;
  } else {
    deal = `<p class="searching">${isSh ? 'Nog geen mooi exemplaar gevonden. Wordt elke ochtend opnieuw gezocht.' : 'Prijs volgt binnenkort.'}</p>`;
  }

  return `
    <article class="card ${b ? '' : 'pending'}">
      <div class="photo">
        ${photo ? `<img src="${esc(img(photo))}" ${fallback ? `data-alt="${esc(fallback)}"` : ''} alt="${esc(nice.title)}" loading="lazy">` : '<div class="noimg">🎁</div>'}
        ${isSh ? '<span class="ribbon">Tweedehands</span>' : ''}
      </div>
      <div class="body">
        <h2>${esc(nice.title)}</h2>
        <p class="sub">${esc(nice.sub)}</p>
        ${deal}
      </div>
    </article>`;
}

async function load() {
  try {
    const res = await fetch('/api/wishlist');
    const { items } = await res.json();
    // Items met een deal eerst
    items.sort((a, b) => Number(Boolean(b.result?.best)) - Number(Boolean(a.result?.best)));
    $('#list').innerHTML = items.map(card).join('');
  } catch {
    $('#list').innerHTML = '<p class="loading">Even geduld, de lijst wordt wakker gemaakt… Vernieuw de pagina binnen een minuutje.</p>';
  }
}

countdown();
load();
