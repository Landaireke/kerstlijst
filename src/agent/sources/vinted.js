// Vinted (BE + NL). Vinted heeft geen publieke API; we lezen de zoekpagina via Firecrawl.
import * as fc from '../firecrawl.js';
import { parsePrice, log } from '../util.js';

const DOMAINS = ['www.vinted.be', 'www.vinted.nl'];
// Vinted-statussen: 6 = nieuw met prijskaartje, 1 = nieuw zonder, 2 = zeer goed
const STATUS = ['6', '1', '2'];

export function catalogUrl(domain, query, maxPrice) {
  const p = new URLSearchParams({ search_text: query, price_to: String(maxPrice), currency: 'EUR', order: 'newest_first' });
  STATUS.forEach((s) => p.append('status_ids[]', s));
  // catalog 5 = heren; essentials-hoodies zijn unisex maar staan vrijwel altijd bij heren
  return `https://${domain}/catalog/5-men?${p.toString()}`;
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

export async function search(item) {
  if (!fc.hasFirecrawl()) return [];
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
