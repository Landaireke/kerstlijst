import test from 'node:test';
import assert from 'node:assert/strict';
import { offersFromHtml } from '../src/agent/sources/direct.js';
import { normalizeApiItem, apiUrl } from '../src/agent/sources/vinted.js';

test('JSON-LD: shoppagina en Tweakers-aggregaat', () => {
  const shop = `<html><head><meta property="og:image" content="https://x/og.jpg"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"WD C50","image":"https://x/p.jpg","offers":{"@type":"Offer","price":"104.99","priceCurrency":"EUR","availability":"https://schema.org/InStock","seller":{"name":"Colorway"}}}</script></head></html>`;
  const r = offersFromHtml(shop, 'https://thecolorway.net/p');
  assert.equal(r.name, 'WD C50');
  assert.equal(r.image, 'https://x/p.jpg');
  assert.equal(r.offers[0].price, 104.99);
  assert.equal(r.offers[0].inStock, true);
  const tw = `<script type="application/ld+json">{"@graph":[{"@type":"Product","name":"G7","offers":{"@type":"AggregateOffer","lowPrice":"45.34","highPrice":"55.65","offerCount":8}}]}</script>`;
  const t = offersFromHtml(tw, 'https://tweakers.net/x');
  assert.equal(t.offers[0].aggregate, true);
  assert.equal(t.offers[0].price, 45.34);
  assert.equal(t.offers[0].offerCount, 8);
  const oos = offersFromHtml(`<script type="application/ld+json">{"@type":"Product","offers":[{"@type":"Offer","price":50,"availability":"OutOfStock"}]}</script>`, 'u');
  assert.equal(oos.offers[0].inStock, false);
});

test('Vinted API-item normaliseren', () => {
  const n = normalizeApiItem({ id: 42, title: 'Stone Island sweat', price: { amount: '20.0', currency_code: 'EUR' }, total_item_price: { amount: '21.70' }, status: 'Très bon état', size_title: 'M', brand_title: 'Stone Island', photo: { url: 'https://p/1.jpg', full_size_url: 'https://p/1f.jpg' }, url: 'https://www.vinted.be/items/42-stone', user: { login: 'bob' } }, 'www.vinted.be');
  assert.equal(n.price, 20);
  assert.equal(n.priceInclProtection, 21.7);
  assert.equal(n.condition, 'Très bon état');
  assert.equal(n.photos[0], 'https://p/1f.jpg');
  assert.match(apiUrl('www.vinted.be', 'stone island', 23), /status_ids%5B%5D=2/);
});

import fs from 'node:fs';
import { parseCatalogHtml, parseAlt } from '../src/agent/sources/vinted.js';
test('Vinted zoekpagina (echte HTML) uitlezen', () => {
  const html = fs.readFileSync(new URL('./fixtures/vinted-catalog.html', import.meta.url), 'utf8');
  const items = parseCatalogHtml(html, 'www.vinted.be');
  assert.ok(items.length >= 5);
  const first = items[0];
  assert.equal(first.title, 'Trui look a like stone island');
  assert.equal(first.size, 'L');
  assert.equal(first.price, 5);
  assert.equal(first.priceInclProtection, 5.95);
  assert.match(first.url, /^https:\/\/www\.vinted\.be\/items\/\d+/);
  assert.match(first.photos[0], /^https:\/\/images\d?\.vinted\.net/);
  const nl = parseAlt('Ami de coeur sweater, Merk: AMI Paris, Staat: Zeer goed, Maat: XL, 20,00 €, 21,70 €');
  assert.equal(nl.brand, 'AMI Paris');
  assert.equal(nl.condition, 'Zeer goed');
  assert.equal(nl.size, 'XL');
  assert.deepEqual(nl.prices, [20, 21.7]);
});
