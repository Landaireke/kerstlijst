// Tweakers Pricewatch: de beste bron voor NL/BE-webshops, inclusief verzendkosten en shopreviews.
import * as fc from '../firecrawl.js';
import { parsePrice, round2 } from '../util.js';
import { knownShop } from '../trust.js';

const SCHEMA = {
  type: 'object',
  properties: {
    productName: { type: 'string' },
    imageUrl: { type: 'string' },
    offers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          shopName: { type: 'string' },
          price: { type: 'string' },
          shipping: { type: 'string', description: "Verzendkosten zoals getoond, bv. '€ 4,99' of 'Gratis'" },
          delivery: { type: 'string', description: 'Levertijd/voorraadtekst' },
          shopRating: { type: 'number', description: 'Shopreviewscore op 5, bv. 4.6' },
          shopReviews: { type: 'number', description: 'Aantal shopreviews' },
          link: { type: 'string', description: 'Clickout-link naar de shop' },
        },
        required: ['shopName', 'price'],
      },
    },
  },
};

const NAME_TO_DOMAIN = {
  bol: 'bol.com', 'bol.com': 'bol.com', coolblue: 'coolblue.nl', megekko: 'megekko.nl', azerty: 'azerty.nl',
  'proshop.nl': 'proshop.nl', proshop: 'proshop.nl', galaxus: 'galaxus.nl', 'amazon.nl': 'amazon.nl',
  'amazon.nl marketplace': 'amazon.nl', 'amazon.de': 'amazon.de', aliexpress: 'aliexpress.com',
  alternate: 'alternate.nl', mediamarkt: 'mediamarkt.nl', 'game mania': 'gamemania.nl', 'amazon.com.be': 'amazon.com.be',
};

export function shopDomainFromName(name = '') {
  const n = name.toLowerCase().trim();
  if (NAME_TO_DOMAIN[n]) return NAME_TO_DOMAIN[n];
  if (/^[a-z0-9-]+\.[a-z.]+$/.test(n)) return n;
  return null;
}

async function findPage(item) {
  if (item.tweakersUrl) return item.tweakersUrl;
  const hits = await fc.search(`site:tweakers.net pricewatch ${item.searchQuery || item.name}`, { limit: 5 });
  return hits.find((h) => /tweakers\.net\/pricewatch\/\d+/.test(h.url))?.url || null;
}

export async function getOffers(item) {
  const url = await findPage(item);
  if (!url) return { offers: [], note: 'Geen Tweakers-pagina gevonden' };
  const { data } = await fc.scrapeJson(
    url,
    SCHEMA,
    `Lijst ALLE winkels uit het prijsoverzicht voor "${item.name}" met prijs, verzendkosten, levertijd, shopreviewscore (op 5) en aantal reviews, en de clickout-link. Neem geen tweedehands/Vraag & Aanbod mee.`,
  );
  const offers = (data?.offers || [])
    .map((o) => {
      const price = parsePrice(o.price);
      const shipping = parsePrice(o.shipping);
      const domain = shopDomainFromName(o.shopName) || knownShop(o.shopName)?.domain || null;
      return {
        source: 'tweakers',
        shop: o.shopName,
        domain,
        url: o.link?.startsWith('http') ? o.link : url,
        price,
        shipping,
        shippingKnown: shipping != null,
        total: price != null ? round2(price + (shipping || 0)) : null,
        inStock: o.delivery ? !/niet leverbaar|uitverkocht|onbekend/i.test(o.delivery) : true,
        delivery: o.delivery || '',
        rating: o.shopRating ?? null,
        reviews: o.shopReviews ?? null,
        marketplace: /marketplace|partner/i.test(o.shopName),
        image: data?.imageUrl || null,
        note: 'Verzendkosten volgens Tweakers (naar NL); naar BE kan dit afwijken.',
      };
    })
    .filter((o) => o.price != null);
  return { offers, page: url, image: data?.imageUrl || null };
}
