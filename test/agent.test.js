import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parsePrice } from '../src/agent/util.js';
import { normalize, searchUrl } from '../src/agent/sources/marketplace.js';
import { normalizeCondition, textCheck, verdict } from '../src/agent/condition.js';
import { secondhandCost } from '../src/agent/costs.js';
import { scoreFromRating, assessShop } from '../src/agent/trust.js';
import { shopDomainFromName } from '../src/agent/sources/tweakers.js';

test('parsePrice', () => {
  assert.equal(parsePrice('€ 45,34'), 45.34);
  assert.equal(parsePrice('54,-'), 54);
  assert.equal(parsePrice('€ 1.045,99'), 1045.99);
  assert.equal(parsePrice('Gratis'), 0);
  assert.equal(parsePrice('104,99 €'), 104.99);
  assert.equal(parsePrice(12.5), 12.5);
  assert.equal(parsePrice('onbekend'), null);
});

test('2dehands normaliseren', () => {
  const { listings } = JSON.parse(fs.readFileSync(new URL('./fixtures/2dehands.json', import.meta.url)));
  const [a, b, c] = listings.map((l) => normalize('2dehands', l));
  assert.equal(a.price, 200);
  assert.equal(a.condition, 'Zo goed als nieuw');
  assert.equal(a.size, 'Maat 48/50 (M)');
  assert.equal(a.canShip, true);
  assert.equal(a.photos[0].endsWith('_85.jpg'), true);
  assert.equal(a.url, 'https://www.2dehands.be/v/kleding-heren/truien-en-vesten/m2466587122-ami');
  assert.equal(b.sellerShipping, 5);
  assert.equal(c.price, null);
  assert.equal(c.pickupOnly, true);
  assert.match(searchUrl('2dehands', 'ami paris trui', 23), /PriceCents%3A0%3A2300/);
});

test('staat normaliseren', () => {
  assert.equal(normalizeCondition('Zo goed als nieuw'), 'very_good');
  assert.equal(normalizeCondition('Nieuw met prijskaartje'), 'new_tags');
  assert.equal(normalizeCondition('Neuf sans étiquette'), 'new');
  assert.equal(normalizeCondition('Très bon état'), 'very_good');
  assert.equal(normalizeCondition('Goed'), 'good');
  assert.equal(normalizeCondition('Heel goed'), 'very_good');
  assert.equal(normalizeCondition('Gebruikt'), 'good');
  assert.equal(normalizeCondition(null), 'unknown');
});

test('tekstcheck: gebreken, kindermaat, namaak', () => {
  const t = (title, description = '') => textCheck({ title, description }).map((f) => f.type);
  assert.deepEqual(t('Stone island trui', 'klein vlekje op de mouw'), ['defect']);
  assert.deepEqual(t('Stone island trui', 'geen vlekken of gaatjes'), []);
  assert.deepEqual(t('Stone Island trui maat 128'), ['kids']);
  assert.deepEqual(t('Pull stone island junior'), ['kids']);
  assert.deepEqual(t('Stone island grijs sweater', 'zonder badge maat small'), ['fake']);
  assert.deepEqual(t('Essentials hoodie maat M', 'perfecte staat'), []);
});

test('verdict combineert alles', () => {
  const item = { minCondition: 'very_good' };
  const base = { title: 'x', condition: 'Zeer goed' };
  const ok = verdict(item, base, [], { sameModel: true, condition: 'very_good', defects: [], fakeRisk: 'low', kidsSize: false });
  assert.equal(ok.approved, true);
  const other = verdict(item, base, [], { sameModel: false, condition: 'excellent', defects: [], fakeRisk: 'low' });
  assert.equal(other.approved, false);
  const stain = verdict(item, base, [], { sameModel: true, condition: 'very_good', defects: ['vlek op borst'], fakeRisk: 'low' });
  assert.equal(stain.approved, false);
  const fake = verdict(item, base, [], { sameModel: true, condition: 'excellent', defects: [], fakeRisk: 'high' });
  assert.equal(fake.approved, false);
  const low = verdict(item, { ...base, condition: 'Goed' }, [], { sameModel: true, condition: 'excellent', defects: [], fakeRisk: 'low' });
  assert.equal(low.approved, false);
});

test('kosten tweedehands', () => {
  const v = secondhandCost({ source: 'vinted', price: 20, priceInclProtection: 21.7 });
  assert.equal(v.breakdown[1].amount, 1.7);
  assert.equal(v.total, 25.2);
  assert.equal(v.estimated, true); // verzending geschat
  const p = secondhandCost({ source: '2dehands', price: 15, pickupOnly: true, location: 'Gent' });
  assert.equal(p.total, 15);
  const s = secondhandCost({ source: '2dehands', price: 10, sellerShipping: 5 });
  assert.equal(s.total, 15);
  assert.equal(s.estimated, false);
});

test('betrouwbaarheid', async () => {
  assert.equal(scoreFromRating(4.8, 1724) >= 94, true);
  assert.equal(scoreFromRating(2.0, 3) < 50, true);
  const db = { trustCache: {} };
  const meg = await assessShop('https://www.megekko.nl/product/x', db, { rating: 4.8, reviews: 1724 });
  assert.equal(meg.score >= 90, true);
  const ali = await assessShop('aliexpress.com', db);
  assert.equal(ali.score < 65, true);
  assert.equal(shopDomainFromName('Amazon.nl Marketplace'), 'amazon.nl');
  assert.equal(shopDomainFromName('Proshop.nl'), 'proshop.nl');
});

import { normalizeSize } from '../src/agent/condition.js';
test('maat en nep-woorden', () => {
  assert.equal(normalizeSize('Maat 52/54 (L)'), 'L');
  assert.equal(normalizeSize('Maat 56/58 (XL)'), 'XL');
  assert.equal(normalizeSize(null, 'stone island trui (L)'), 'L');
  assert.equal(normalizeSize('Overige maten', 'Ami trui maat XL'), 'XL');
  assert.equal(normalizeSize('Overige maten', 'Ami trui'), null);
  const fake = (d) => textCheck({ title: 'x', description: d }).some((f) => f.type === 'fake');
  assert.equal(fake('nep stone island'), true);
  assert.equal(fake('fake ami'), true);
  assert.equal(fake('100% origineel, geen nep'), false);
  assert.equal(fake('niet origineel'), true);
});
