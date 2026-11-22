// Korte Amazon-links (amzn.eu/d/...) omzetten naar een product met naam, ASIN en foto.
import * as fc from './firecrawl.js';
import { log } from './util.js';

export async function resolveAmazon(shortUrl) {
  let finalUrl = shortUrl;
  try {
    for (let i = 0; i < 5; i++) {
      const res = await fetch(finalUrl, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000) });
      const loc = res.headers.get('location');
      if (!loc) break;
      finalUrl = new URL(loc, finalUrl).toString();
    }
  } catch (e) {
    log('amazon: redirect volgen mislukt', e.message);
  }
  const asin = finalUrl.match(/\/(?:dp|gp\/product|d)\/([A-Z0-9]{10})/)?.[1] || null;
  let name = null;
  let image = null;
  const slug = finalUrl.match(/amazon\.[a-z.]+\/([^/]+)\/dp\//)?.[1];
  if (slug) name = decodeURIComponent(slug).replace(/-/g, ' ');

  if (fc.hasFirecrawl()) {
    try {
      const { data } = await fc.scrapeJson(finalUrl, {
        type: 'object',
        properties: { productName: { type: 'string' }, brand: { type: 'string' }, ean: { type: 'string' }, imageUrl: { type: 'string' } },
      }, 'Exacte productnaam, merk, EAN en de URL van de hoofdafbeelding.');
      if (data?.productName) name = data.productName;
      image = data?.imageUrl || null;
      if (data?.ean) return { url: finalUrl, asin, name, image, ean: data.ean };
    } catch (e) {
      log('amazon: pagina lezen mislukt, zoek op ASIN', e.message);
      if (asin && !name) {
        const hits = await fc.search(`${asin}`, { limit: 5 }).catch(() => []);
        name = hits[0]?.title?.replace(/\s*[:|–-]\s*Amazon.*$/i, '') || null;
      }
    }
  }
  return { url: finalUrl, asin, name, image };
}
