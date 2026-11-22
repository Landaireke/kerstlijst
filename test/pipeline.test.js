// Volledige agent-ronde met nagebootste Firecrawl- en Claude-antwoorden (geen netwerk nodig).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-'));
process.env.DATA_DIR = tmp;
process.env.FIRECRAWL_API_KEY = 'test';
process.env.ANTHROPIC_API_KEY = 'test';
process.env.FIRECRAWL_FULL = 'true';
const fixture = fs.readFileSync(new URL('./fixtures/2dehands.json', import.meta.url), 'utf8');

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const body = opts.body ? JSON.parse(opts.body) : {};
  if (url.includes('amzn.eu')) return new Response('', { status: 301, headers: { location: 'https://www.amazon.com.be/Test-Product/dp/B0TEST1234' } });
  if (url.includes('/lrp/api/search')) {
    // goedkope, plausibele listing toevoegen voor stone island
    const f = JSON.parse(fixture);
    f.listings.push({ itemId: 'm1', title: 'Stone Island sweater grijs', description: 'Badge aanwezig, perfecte staat', priceInfo: { priceCents: 2000, priceType: 'FIXED' }, location: { cityName: 'Leuven' }, extendedAttributes: [{ key: 'condition', value: 'Zo goed als nieuw' }, { key: 'delivery', value: 'Ophalen of Verzenden' }, { key: 'size', value: 'Maat 52/54 (L)' }], pictures: [{ largeUrl: 'https://img/1.jpg' }], vipUrl: '/v/x/m1' });
    return json(f);
  }
  if (url.includes('firecrawl.dev/v2/search')) {
    return json({ success: true, data: { web: [
      { url: 'https://www.coolblue.be/nl/product/1/test.html', title: 'Test', description: '' },
      { url: 'https://www.reddit.com/r/x', title: 'r', description: '' },
    ] } });
  }
  if (url.includes('firecrawl.dev/v2/scrape')) {
    const u = body.url;
    if (u.includes('tweakers.net')) return json({ success: true, data: { json: { imageUrl: 'https://tw/img.jpg', offers: [
      { shopName: 'Megekko', price: '€ 49,95', shipping: '€ 5,95', shopRating: 4.8, shopReviews: 1724, link: 'https://tweakers.net/clickout/1' },
      { shopName: 'AliExpress', price: '€ 30,00', shipping: 'Gratis', shopRating: 3.6, shopReviews: 12, link: 'https://tweakers.net/clickout/2' },
    ] } } });
    if (u.includes('vinted') && u.includes('/catalog')) return json({ success: true, data: { html: '<div data-testid="grid-item"><img src="https://images1.vinted.net/t/x.webp" alt="Ami Paris sweat noir, Marque: AMI Paris, État: Très bon état, Taille: L, 22.00 €, 23.80 €" class="c" data-testid="product-item-id-123--image--img"><a href="https://www.vinted.be/items/123-ami?referrer=catalog">x</a></div>' } });
    if (u.includes('vinted') && u.includes('/items/')) return json({ success: true, data: { json: { description: 'Porté 2 fois', condition: 'Très bon état', photos: ['https://img/v1.jpg'], price: '22,00 €', priceInclProtection: '23,80 €' } } });
    if (u.includes('amazon')) return json({ success: true, data: { json: { productName: 'Test Product 1TB', imageUrl: 'https://amz/img.jpg' } } });
    return json({ success: true, data: { json: { isProductPage: true, matchesTarget: true, productName: 'x', price: 52.99, inStock: true, shippingCostBelgium: 0 } } });
  }
  if (url.includes('api.anthropic.com')) {
    const txt = JSON.stringify(body.messages[0].content.filter((c) => c.type === 'text').map((c) => c.text));
    const ok = /Stone Island sweater grijs|Ami Paris sweat noir/.test(txt);
    return json({ content: [{ type: 'text', text: JSON.stringify({ sameModel: ok, modelConfidence: 0.9, condition: 'very_good', defects: [], fakeRisk: 'low', fakeReasons: [], kidsSize: false, summary: ok ? 'Zelfde model, geen gebreken zichtbaar' : 'Ander model' }) }] });
  }
  throw new Error('onverwachte fetch ' + url);
};

test('volledige ronde', async () => {
  const { runAll } = await import('../src/agent/index.js');
  const { load } = await import('../src/db.js');
  const res = await runAll();
  assert.equal(res.every((r) => r.ok), true, JSON.stringify(res));
  const db = load();
  const g7 = db.results['gamesir-g7-he'];
  assert.equal(g7.best.total, 52.99, 'webshop €52,99 gratis < Megekko €55,90; AliExpress (€30) te weinig betrouwbaar');
  assert.equal(g7.offers.find((o) => o.shop === 'AliExpress').status, 'te weinig betrouwbaar');
  const si = db.results['stone-island'];
  assert.equal(si.best.title, 'Stone Island sweater grijs');
  assert.equal(si.best.total, 25); // 20 + geschatte verzending 5
  assert.ok(si.rejected.some((r) => r.reasons.join().includes('bieden') || r.reasons.join().includes('Ander merk')));
  const ami = db.results['ami-paris'];
  assert.equal(ami.best.source, 'vinted');
  assert.equal(ami.best.total, 27.3); // 22 + 1,80 bescherming + 3,50 verzending (geschat)
  assert.equal(db.results['essentials-hoodie'].best, null);
});
