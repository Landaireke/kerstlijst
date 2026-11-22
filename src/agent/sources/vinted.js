// Vinted (BE + NL). Vinted heeft geen publieke API; we lezen de zoekpagina via Firecrawl.
import * as fc from '../firecrawl.js';
import { parsePrice, log } from '../util.js';
import { fetchText } from '../fetcher.js';

const DOMAINS = ['www.vinted.be', 'www.vinted.nl'];
// Vinted-statussen: 6 = nieuw met prijskaartje, 1 = nieuw zonder, 2 = zeer goed
const STATUS = ['6', '1', '2'];

export function catalogUrl(domain, query, maxPrice) {
  const p = new URLSearchParams({ search_text: query, price_to: String(maxPrice), currency: 'EUR', order: 'newest_first' });
  STATUS.forEach((s) => p.append('status_ids[]', s));
  p.append('catalog[]', '5'); // 5 = heren
  return `https://${domain}/catalog?${p.toString()}`;
}

const LIST_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          brand: { type: 'string' },
          size: { type: 'string' },
          condition: { type: 'string' },
          price: { type: 'string', description: 'Prijs van het artikel' },
          priceInclProtection: { type: 'string', description: "Prijs 'incl.' kopersbescherming indien getoond" },
          url: { type: 'string', description: 'Volledige link naar /items/...' },
          photoUrl: { type: 'string' },
        },
        required: ['title', 'url'],
      },
    },
  },
};

const DETAIL_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    condition: { type: 'string' },
    size: { type: 'string' },
    brand: { type: 'string' },
    price: { type: 'string' },
    priceInclProtection: { type: 'string' },
    shippingFrom: { type: 'string', description: "Verzendkosten 'vanaf' indien getoond" },
    photos: { type: 'array', items: { type: 'string' }, description: 'URLs van alle productfoto’s (grote versie)' },
    sellerName: { type: 'string' },
    sellerRating: { type: 'number', description: 'Score op 5' },
    sellerReviews: { type: 'number' },
    location: { type: 'string' },
    isSold: { type: 'boolean' },
  },
};

// ---- Gratis modus: Vinted's eigen zoek-API met een sessiecookie van de homepage ----
const sessions = {};
async function session(domain) {
  if (sessions[domain]) return sessions[domain];
  const { headers } = await fetchText(`https://${domain}/`);
  const cookies = (headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).filter(Boolean);
  sessions[domain] = cookies.join('; ');
  return sessions[domain];
}

export function apiUrl(domain, query, maxPrice) {
  const p = new URLSearchParams({ search_text: query, price_to: String(maxPrice), currency: 'EUR', order: 'newest_first', per_page: '48', catalog_ids: '5' });
  STATUS.forEach((s) => p.append('status_ids[]', s));
  return `https://${domain}/api/v2/catalog/items?${p.toString()}`;
}

const STATUS_LABEL = { 6: 'Nieuw met prijskaartje', 1: 'Nieuw zonder prijskaartje', 2: 'Zeer goed', 3: 'Goed', 4: 'Redelijk' };

export function normalizeApiItem(it, domain) {
  const price = parsePrice(it.price?.amount ?? it.price);
  const total = parsePrice(it.total_item_price?.amount ?? it.total_item_price);
  return {
    id: 'vinted:' + it.id,
    source: 'vinted',
    title: it.title,
    description: it.description || '',
    price,
    priceInclProtection: total ?? null,
    priceType: 'FIXED',
    condition: it.status || STATUS_LABEL[it.status_id] || null,
    size: it.size_title || null,
    brand: it.brand_title || null,
    location: '',
    photos: [it.photo?.full_size_url || it.photo?.url, ...(it.photos || []).map((p) => p.full_size_url || p.url)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 6),
    url: it.url?.startsWith('http') ? it.url : `https://${domain}/items/${it.id}`,
    seller: it.user?.login || '',
    canShip: true,
    pickupOnly: false,
    needsDetail: false,
  };
}

async function searchDirect(item) {
  const out = new Map();
  for (const domain of DOMAINS) {
    try {
      const cookie = await session(domain);
      for (const q of item.searchQueries.slice(0, 2)) {
        const { text, status } = await fetchText(apiUrl(domain, q, item.maxPrice), { headers: { Cookie: cookie }, accept: 'application/json' });
        if (!text) {
          log(`vinted ${domain}: geen antwoord (${status})`);
          break;
        }
        const json = JSON.parse(text);
        for (const it of json.items || []) {
          const n = normalizeApiItem(it, domain);
          if (n.price != null && n.price <= item.maxPrice) out.set(n.id, n);
        }
      }
    } catch (e) {
      log(`vinted ${domain} direct: ${e.message}`);
    }
  }
  return [...out.values()];
}

// ---- Via Firecrawl (gratis plan volstaat): zoekpagina als HTML, 1 credit per pagina ----
const decode = (t) => t.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** Vinted zet alle info in de alt-tekst: "Titel, Merk: X, Staat: Y, Maat: L, 20.00 €, 21.70 €" (NL/FR/EN). */
export function parseAlt(alt) {
  const parts = decode(alt).split(/,\s+/);
  const out = { title: [], brand: null, condition: null, size: null, prices: [] };
  for (const p of parts) {
    const kv = p.match(/^(Merk|Marque|Brand|Marke|Staat|État|Etat|Condition|Zustand|Maat|Taille|Size|Größe)\s*:\s*(.+)$/i);
    if (kv) {
      const k = kv[1].toLowerCase();
      if (/merk|marque|brand|marke/.test(k)) out.brand = kv[2];
      else if (/staat|état|etat|condition|zustand/.test(k)) out.condition = kv[2];
      else out.size = kv[2];
    } else if (/^€?\s*\d+[.,]\d{2}\s*€?$/.test(p.trim())) out.prices.push(parsePrice(p));
    else if (!out.brand && !out.condition && !out.size) out.title.push(p);
  }
  return { ...out, title: out.title.join(', ') };
}

export function parseCatalogHtml(html, domain) {
  const items = [];
  const re = /<img[^>]+src="([^"]+)"[^>]+alt="([^"]+)"[^>]*data-testid="product-item-id-(\d+)--image--img"/g;
  for (const m of html.matchAll(re)) {
    const [, src, alt, id] = m;
    const a = parseAlt(alt);
    const link = html.match(new RegExp(`href="([^"]*/items/${id}[^"]*)"`))?.[1];
    items.push({
      id: 'vinted:' + id,
      source: 'vinted',
      title: a.title,
      description: '',
      price: a.prices[0] ?? null,
      priceInclProtection: a.prices[1] ?? null,
      priceType: 'FIXED',
      condition: a.condition,
      size: a.size,
      brand: a.brand,
      location: '',
      photos: [decode(src)],
      url: link ? decode(link).split('?')[0] : `https://${domain}/items/${id}`,
      canShip: true,
      pickupOnly: false,
      needsDetail: false,
    });
  }
  return items;
}

async function searchViaFirecrawl(item) {
  const out = new Map();
  for (const domain of DOMAINS) {
    for (const q of item.searchQueries.slice(0, 2)) {
      try {
        const html = await fc.scrapeHtml(catalogUrl(domain, q, item.maxPrice), ['[data-testid=grid-item]']);
        const found = parseCatalogHtml(html, domain);
        log(`  vinted ${domain} "${q}": ${found.length} artikelen`);
        for (const n of found) if (n.price == null || n.price <= item.maxPrice) out.set(n.id, n);
      } catch (e) {
        log(`vinted ${domain} via Firecrawl: ${e.message}`);
      }
    }
  }
  return [...out.values()];
}

export async function search(item) {
  if (!fc.hasFirecrawl()) return searchDirect(item);
  return searchViaFirecrawl(item);
}

export async function searchJsonMode(item) {
  const out = new Map();
  for (const domain of DOMAINS) {
    for (const q of item.searchQueries.slice(0, 2)) {
      try {
        const { data } = await fc.scrapeJson(
          catalogUrl(domain, q, item.maxPrice),
          LIST_SCHEMA,
          'Lijst alle artikelen in het zoekresultaat (niet de gesponsorde/aanbevolen blokken van andere zoekopdrachten).',
          { waitFor: 1500 },
        );
        for (const it of data?.items || []) {
          if (!/\/items\/\d+/.test(it.url || '')) continue;
          const id = 'vinted:' + it.url.match(/\/items\/(\d+)/)[1];
          const price = parsePrice(it.price);
          if (price != null && price > item.maxPrice) continue;
          out.set(id, {
            id,
            source: 'vinted',
            title: it.title,
            description: '',
            price,
            priceInclProtection: parsePrice(it.priceInclProtection),
            priceType: 'FIXED',
            condition: it.condition || null,
            size: it.size || null,
            brand: it.brand || null,
            location: '',
            photos: it.photoUrl ? [it.photoUrl] : [],
            url: it.url.startsWith('http') ? it.url.split('?')[0] : `https://${domain}${it.url.split('?')[0]}`,
            canShip: true,
            pickupOnly: false,
            needsDetail: true,
          });
        }
      } catch (e) {
        log(`vinted ${domain}: fout bij "${q}":`, e.message);
      }
    }
  }
  return [...out.values()];
}

/** Detailpagina ophalen: beschrijving, alle foto's, verkopersscore, verzendkosten. */
export async function enrich(listing) {
  const { data } = await fc.scrapeJson(listing.url, DETAIL_SCHEMA, 'Lees de advertentie volledig uit, inclusief alle foto-URLs en de staat van het artikel.', { waitFor: 1500 });
  if (!data) return listing;
  return {
    ...listing,
    title: data.title || listing.title,
    description: data.description || '',
    condition: data.condition || listing.condition,
    size: data.size || listing.size,
    brand: data.brand || listing.brand,
    price: parsePrice(data.price) ?? listing.price,
    priceInclProtection: parsePrice(data.priceInclProtection) ?? listing.priceInclProtection,
    sellerShipping: parsePrice(data.shippingFrom),
    photos: data.photos?.length ? data.photos.slice(0, 6) : listing.photos,
    seller: data.sellerName || '',
    sellerRating: data.sellerRating ?? null,
    sellerReviews: data.sellerReviews ?? null,
    location: data.location || '',
    sold: Boolean(data.isSold),
    needsDetail: false,
  };
}
