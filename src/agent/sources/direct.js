// Gratis prijzen voor nieuwe producten: leest de gestructureerde productdata (schema.org)
// van Tweakers en van de shoppagina's die in config/wishlist.json staan.
import { fetchText, jsonLd, metaContent } from '../fetcher.js';
import { domainOf, parsePrice, round2, pool } from '../util.js';
import { knownShop } from '../trust.js';

const types = (n) => [].concat(n['@type'] || []).map(String);

export function offersFromHtml(html, url) {
  const nodes = jsonLd(html);
  const product = nodes.find((n) => types(n).includes('Product'));
  const image = [].concat(product?.image || [])[0]?.url || [].concat(product?.image || [])[0] || metaContent(html, 'og:image');
  const name = product?.name || metaContent(html, 'og:title');
  const raw = [].concat(product?.offers || nodes.filter((n) => types(n).some((t) => /Offer/.test(t))));
  const offers = [];
  for (const o of raw.flatMap((x) => (x?.offers ? [].concat(x.offers) : [x]))) {
    if (!o) continue;
    const isAgg = types(o).includes('AggregateOffer');
    const price = parsePrice(o.price ?? o.lowPrice ?? o.priceSpecification?.price);
    if (price == null) continue;
    const ship = o.shippingDetails?.shippingRate?.value ?? [].concat(o.shippingDetails || [])[0]?.shippingRate?.value;
    offers.push({
      price,
      aggregate: isAgg,
      offerCount: o.offerCount || null,
      seller: o.seller?.name || null,
      inStock: o.availability ? /InStock|LimitedAvailability|PreOrder/i.test(o.availability) : true,
      shipping: ship != null ? parsePrice(ship) : null,
      url: o.url || url,
    });
  }
  // Amazon heeft geen schema.org-prijs: lees de hoofdprijs en voorraad uit de pagina
  if (!offers.length && /amazon\./.test(url)) {
    const core = html.match(/id="corePrice(?:Display_desktop|_feature|_desktop)_div"[\s\S]{0,4000}?class="a-offscreen">([^<]+)</) || html.match(/class="a-price[^"]*priceToPay[^"]*"[\s\S]{0,600}?class="a-offscreen">([^<]+)</);
    const price = core ? parsePrice(core[1]) : null;
    if (price != null) {
      const avail = html.match(/id="availability"[\s\S]{0,600}?<span[^>]*>\s*([^<]+)</)?.[1]?.trim() || '';
      const seller = html.match(/id="sellerProfileTriggerId"[^>]*>([^<]+)</)?.[1]?.trim() || null;
      offers.push({ price, aggregate: false, seller, inStock: !/niet beschikbaar|currently unavailable|nicht verfügbar|indisponible/i.test(avail), shipping: null, url });
    }
  }
  return { name, image: typeof image === 'string' ? image : null, offers };
}

export async function getOffers(item) {
  const urls = [...new Set([item.tweakersUrl, item.sourceUrl, item.resolvedUrl, ...(item.shopUrls || [])].filter((u) => u && !/amzn\.eu/.test(u)))];
  let image = null;
  const results = await pool(urls, 3, async (url) => {
    const { text } = await fetchText(url);
    if (!text) return { url, offers: [], failed: true };
    const r = offersFromHtml(text, url);
    image = image || r.image;
    return { url, ...r };
  });
  const offers = [];
  const failed = [];
  for (const r of results) {
    if (!r || r.failed || r.error) {
      failed.push(domainOf(r?.url || ''));
      continue;
    }
    const domain = domainOf(r.url);
    const isTweakers = domain === 'tweakers.net';
    const shop = knownShop(domain);
    for (const o of r.offers) {
      if (isTweakers && !o.aggregate && !o.seller) continue;
      let shipping = o.shipping;
      if (shipping == null && !isTweakers && shop?.shippingFallback != null) shipping = shop.shippingFallback;
      offers.push({
        source: isTweakers ? 'tweakers' : 'webshop',
        shop: isTweakers ? (o.seller || `Laagste prijs op Tweakers${o.offerCount ? ` (${o.offerCount} shops)` : ''}`) : shop?.name || domain,
        domain: isTweakers ? (o.seller ? knownShop(o.seller)?.domain || null : 'tweakers.net') : domain,
        url: isTweakers ? r.url : o.url && o.url.startsWith('http') ? o.url : r.url,
        price: o.price,
        shipping,
        shippingKnown: shipping != null,
        total: round2(o.price + (shipping || 0)),
        inStock: o.inStock,
        delivery: '',
        seller: !isTweakers && o.seller && shop && !o.seller.toLowerCase().includes(shop.name.toLowerCase().split(' ')[0]) ? o.seller : '',
        marketplace: false,
        aggregateTweakers: isTweakers && o.aggregate,
        image: r.image,
      });
    }
  }
  for (const o of offers) o.marketplace = Boolean(o.seller);
  return { offers, image, failed };
}
