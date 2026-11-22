// 2dehands.be en Marktplaats.nl delen dezelfde zoek-API (Adevinta). Eerst rechtstreeks, anders via Firecrawl.
import * as fc from '../firecrawl.js';
import { log } from '../util.js';

const SITES = {
  '2dehands': { base: 'https://www.2dehands.be', country: 'BE' },
  marktplaats: { base: 'https://www.marktplaats.nl', country: 'NL' },
};

export function searchUrl(site, query, maxPrice, limit = 30) {
  const { base } = SITES[site];
  const p = new URLSearchParams({ query, limit: String(limit), offset: '0', sortBy: 'SORT_INDEX', sortOrder: 'DECREASING' });
  p.append('attributeRanges[]', `PriceCents:0:${Math.round(maxPrice * 100)}`);
  return `${base}/lrp/api/search?${p.toString()}`;
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (kerstlijst-prijsagent)', Accept: 'application/json', 'Accept-Language': 'nl-BE' },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return await res.json();
    log('marketplace: direct', res.status, '→ via Firecrawl');
  } catch (e) {
    log('marketplace: direct mislukt', e.message, '→ via Firecrawl');
  }
  if (!fc.hasFirecrawl()) return null;
  const raw = await fc.scrapeRaw(url);
  const txt = raw.replace(/^[\s\S]*?(\{)/, '$1').replace(/<\/pre>[\s\S]*$/, '');
  return JSON.parse(txt);
}

const attr = (l, key) => (l.extendedAttributes || l.attributes || []).find((a) => a.key === key)?.value || null;

/** Zet een ruwe listing om naar ons standaardformaat. */
export function normalize(site, l) {
  const { base } = SITES[site];
  const cents = l.priceInfo?.priceCents ?? 0;
  const priceType = l.priceInfo?.priceType || 'FIXED';
  const price = cents > 0 ? cents / 100 : null;
  const delivery = attr(l, 'delivery') || '';
  const desc = l.categorySpecificDescription || l.description || '';
  const shipMatch = desc.match(/(?:verzend\w*|envoi|port)[^\d€]{0,20}(?:€\s*)?(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:€|eur)?/i)
    || desc.match(/\(\s*\+\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*€?\s*\)/);
  return {
    id: `${site}:${l.itemId}`,
    source: site,
    title: l.title,
    description: desc,
    price,
    priceType, // FIXED | MIN_BID (vanaf) | FAST_BID (bieden) | NOTK (n.o.t.k.)
    condition: attr(l, 'condition'),
    size: attr(l, 'size'),
    brand: attr(l, 'brand_mens_clothing') || attr(l, 'brand'),
    location: [l.location?.cityName, l.location?.countryName].filter(Boolean).join(', '),
    photos: (l.pictures || []).map((p) => p.extraExtraLargeUrl || p.largeUrl).filter(Boolean).slice(0, 6),
    url: `${base}${l.vipUrl}`,
    canShip: /verzenden/i.test(delivery),
    pickupOnly: /^ophalen$/i.test(delivery.trim()),
    sellerShipping: shipMatch ? Number(shipMatch[1].replace(',', '.')) : null,
    seller: l.sellerInformation?.sellerName || '',
    sellerVerified: Boolean(l.sellerInformation?.isVerified),
    date: l.date || '',
  };
}

export async function search(item) {
  const out = new Map();
  for (const site of Object.keys(SITES)) {
    for (const q of item.searchQueries) {
      try {
        const json = await fetchJson(searchUrl(site, q, item.maxPrice));
        for (const l of json?.listings || []) {
          const n = normalize(site, l);
          if (n.price != null && n.price > item.maxPrice) continue;
          out.set(n.id, n);
        }
      } catch (e) {
        log(`${site}: fout bij "${q}":`, e.message);
      }
    }
  }
  return [...out.values()];
}
