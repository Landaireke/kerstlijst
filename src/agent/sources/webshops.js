// Breed zoeken naar webshops in de Benelux en elke productpagina uitlezen (prijs, voorraad, verzendkosten).
import * as fc from '../firecrawl.js';
import { domainOf, parsePrice, round2, pool, log } from '../util.js';
import { knownShop } from '../trust.js';

const SKIP = /tweakers\.net|reddit\.|youtube\.|facebook\.|instagram\.|tiktok\.|pricespy|idealo|kieskeurig|beslist|vergelijk|techfi|wikipedia|gamesir\.com|sandisk\.com|westerndigital\.com|2dehands|marktplaats|vinted|ebay\./i;
const BENELUX_OK = /\.(be|nl|lu)$|bol\.com|amazon\.(nl|com\.be|de|fr)|thecolorway\.net|galaxus|reichelt\.com/i;

const SCHEMA = {
  type: 'object',
  properties: {
    isProductPage: { type: 'boolean', description: 'Is dit een productpagina van een webshop waar je dit product kunt kopen?' },
    productName: { type: 'string' },
    matchesTarget: { type: 'boolean', description: 'Is dit exact het gezochte product (zelfde model/capaciteit/kleur), niet een variant of accessoire?' },
    price: { type: 'number', description: 'Huidige verkoopprijs in EUR (incl. btw)' },
    inStock: { type: 'boolean' },
    deliveryText: { type: 'string' },
    shippingCostBelgium: { type: 'number', description: 'Verzendkosten naar België in EUR voor dit product. 0 als gratis. Leeg als onbekend.' },
    freeShippingFrom: { type: 'number', description: 'Gratis verzending vanaf dit bedrag (EUR), indien vermeld' },
    seller: { type: 'string', description: 'Verkoper (bv. de shop zelf of een marketplace-partner)' },
    sellerRating: { type: 'string' },
    imageUrl: { type: 'string' },
  },
  required: ['isProductPage'],
};

export async function candidateUrls(item, extra = []) {
  const q = item.searchQuery || item.name;
  const queries = [`${q} prijs`, `${q} kopen België`, item.ean ? item.ean : null, item.mpn ? item.mpn : null].filter(Boolean);
  const urls = new Set(extra.filter(Boolean));
  for (const query of queries) {
    try {
      const hits = await fc.search(query, { limit: 10 });
      for (const h of hits) {
        const d = domainOf(h.url);
        if (!d || SKIP.test(d) || !BENELUX_OK.test(d)) continue;
        urls.add(h.url.split('?')[0].includes('bol.com') ? h.url.split('?')[0] : h.url);
      }
    } catch (e) {
      log('webshops: zoekfout', query, e.message);
    }
  }
  // Maximaal 2 pagina's per domein, max 12 in totaal (kostenbeheersing)
  const perDomain = {};
  return [...urls].filter((u) => (perDomain[domainOf(u)] = (perDomain[domainOf(u)] || 0) + 1) <= 2).slice(0, 12);
}

export async function getOffers(item, extraUrls = []) {
  const urls = await candidateUrls(item, extraUrls);
  const target = `${item.name}${item.ean ? ` (EAN ${item.ean})` : ''}${item.mpn ? ` (MPN ${item.mpn})` : ''}`;
  const results = await pool(urls, 3, async (url) => {
    const { data } = await fc.scrapeJson(url, SCHEMA, `Gezocht product: ${target}. Lees prijs, voorraad en verzendkosten naar België. Zeg eerlijk als het een ander model, een variant of geen productpagina is.`);
    return { url, data };
  });
  const offers = [];
  for (const r of results) {
    if (!r?.data?.isProductPage || r.data.matchesTarget === false || !r.data.price) continue;
    const d = r.data;
    const domain = domainOf(r.url);
    const shop = knownShop(domain);
    let shipping = d.shippingCostBelgium;
    if (shipping == null && d.freeShippingFrom != null && d.price >= d.freeShippingFrom) shipping = 0;
    if (shipping == null && shop?.shippingFallback != null) shipping = shop.shippingFallback;
    offers.push({
      source: 'webshop',
      shop: shop?.name || domain,
      domain,
      url: r.url,
      price: d.price,
      shipping: shipping ?? null,
      shippingKnown: shipping != null,
      total: round2(d.price + (shipping || 0)),
      inStock: d.inStock !== false,
      delivery: d.deliveryText || '',
      seller: d.seller || '',
      marketplace: Boolean(d.seller && shop && !d.seller.toLowerCase().includes((shop.name || '').toLowerCase().split(' ')[0])),
      image: d.imageUrl || null,
      productName: d.productName,
    });
  }
  return { offers, checked: urls.length };
}
