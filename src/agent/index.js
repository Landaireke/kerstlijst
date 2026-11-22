// De dagelijkse agent: zoekt per item alle aanbiedingen, controleert ze en kiest de beste deal.
import { load, save, flush, getItems } from '../db.js';
import * as tweakers from './sources/tweakers.js';
import * as webshops from './sources/webshops.js';
import * as marketplace from './sources/marketplace.js';
import * as vinted from './sources/vinted.js';
import * as direct from './sources/direct.js';
import { assessShop } from './trust.js';
import { textCheck, visionCheck, verdict, normalizeCondition, CONDITION_LABEL, ruleCheck } from './condition.js';
import { secondhandCost } from './costs.js';
import { resolveAmazon } from './resolve.js';
import { hasFirecrawl } from './firecrawl.js';
import { hasClaude } from './claude.js';
import { log, round2 } from './util.js';

let running = false;
export const isRunning = () => running;

const minTrust = () => Number(process.env.MIN_TRUST_SCORE || 65);
const maxVision = () => Number(process.env.MAX_VISION_CHECKS_PER_ITEM || 8);

// ---------- Nieuwe producten ----------
async function runNew(item, db) {
  const warnings = [];
  if (item.needsResolve && item.sourceUrl) {
    const r = await resolveAmazon(item.sourceUrl);
    if (r.name) {
      Object.assign(item, { name: r.name, searchQuery: r.name.split(/[,|(]/)[0].slice(0, 80), image: item.image || r.image, ean: item.ean || r.ean, asin: r.asin, needsResolve: false });
      db.overrides[item.id] = { ...(db.overrides[item.id] || {}), name: item.name, searchQuery: item.searchQuery, image: item.image, ean: item.ean, asin: r.asin, needsResolve: false, resolvedUrl: r.url };
    } else {
      return { warnings: ['Amazon-link kon niet herkend worden. Vul de productnaam in via "Aanpassen".'], offers: [] };
    }
  }

  let tw, ws;
  if (hasFirecrawl()) {
    [tw, ws] = await Promise.all([
      tweakers.getOffers(item).catch((e) => (warnings.push(`Tweakers: ${e.message}`), { offers: [] })),
      webshops.getOffers(item, [item.sourceUrl, item.resolvedUrl]).catch((e) => (warnings.push(`Webshops: ${e.message}`), { offers: [] })),
    ]);
  } else {
    // Gratis modus: Tweakers + vaste shoppagina's rechtstreeks uitlezen
    tw = { offers: [] };
    ws = await direct.getOffers(item).catch((e) => (warnings.push(`Shops: ${e.message}`), { offers: [] }));
    if (ws.failed?.length) warnings.push(`Niet bereikbaar vandaag: ${ws.failed.join(', ')}`);
  }

  // Dubbels (zelfde shop via Tweakers én rechtstreeks) samenvoegen: rechtstreekse pagina wint, reviews van Tweakers blijven
  const byShop = new Map();
  for (const o of [...tw.offers, ...ws.offers]) {
    const key = (o.domain || o.shop).toLowerCase() + (o.marketplace ? ':mp' : '');
    const prev = byShop.get(key);
    if (!prev || (o.source === 'webshop' && prev.source === 'tweakers')) byShop.set(key, { ...o, rating: o.rating ?? prev?.rating, reviews: o.reviews ?? prev?.reviews });
  }

  const offers = [];
  for (const o of byShop.values()) {
    const trust = await assessShop(o.domain || o.url, db, { rating: o.rating, reviews: o.reviews });
    if (o.marketplace) {
      trust.score = Math.min(trust.score, 60);
      trust.notes = [...(trust.notes || []), 'Verkoop via marketplace-partner'];
    }
    offers.push({ ...o, trust });
  }
  offers.sort((a, b) => (a.total ?? 1e9) - (b.total ?? 1e9));

  const eligible = offers.filter((o) => o.inStock && o.total != null && o.trust.score >= minTrust());
  const best = eligible[0] || null;
  if (!best && offers.length) warnings.push('Geen aanbieding voldoet aan voorraad + betrouwbaarheid; zie alle aanbiedingen.');
  for (const o of offers) {
    o.status = o === best ? 'best' : !o.inStock ? 'niet op voorraad' : o.trust.score < minTrust() ? 'te weinig betrouwbaar' : 'alternatief';
  }
  return { best, offers, warnings, image: item.image || tw.image || offers.find((o) => o.image)?.image };
}

// ---------- Tweedehands ----------
async function runSecondhand(item, db) {
  const warnings = [];
  const [mp, vt] = await Promise.all([
    marketplace.search(item).catch((e) => (warnings.push(`2dehands/Marktplaats: ${e.message}`), [])),
    vinted.search(item).catch((e) => (warnings.push(`Vinted: ${e.message}`), [])),
  ]);
  let listings = [...mp, ...vt];
  log(`  ${item.id}: ${listings.length} advertenties onder €${item.maxPrice}`);

  // Stap 1: snelle tekstfilter (staat, kindermaat, gebreken, merk in titel)
  const brandWords = item.brandMatch || [item.searchQueries[0].split(' ').slice(0, 2).join(' ')];
  const rejected = [];
  const candidates = [];
  for (const l of listings) {
    const flags = textCheck(l);
    const norm = normalizeCondition(l.condition);
    const hay = `${l.title} ${l.brand || ''} ${l.description}`.toLowerCase();
    const brandOk = brandWords.some((w) => hay.includes(w.toLowerCase()));
    const hardFlags = flags.filter((f) => f.type !== 'fake');
    const ruleFail = ruleCheck(item, l);
    if (!brandOk) rejected.push({ ...l, reasons: ['Ander merk'] });
    else if (ruleFail) rejected.push({ ...l, reasons: [ruleFail] });
    else if (['good', 'fair'].includes(norm)) rejected.push({ ...l, reasons: [`Staat: ${l.condition}`] });
    else if (hardFlags.length) rejected.push({ ...l, reasons: hardFlags.map((f) => f.text) });
    else if (l.price == null) rejected.push({ ...l, reasons: ['Geen vaste prijs (bieden)'], biddable: true });
    else candidates.push({ ...l, flags });
  }

  // Stap 2: goedkoopste kandidaten verrijken (Vinted-detail) en met foto's laten controleren
  candidates.sort((a, b) => a.price - b.price);
  const toCheck = candidates.slice(0, maxVision());
  const checked = [];
  for (let l of toCheck) {
    try {
      if (l.needsDetail) l = { ...(await vinted.enrich(l)), flags: l.flags };
      const flags = textCheck(l);
      const vision = await visionCheck(item, l).catch((e) => (log('vision fout', e.message), null));
      const v = verdict(item, l, flags, vision);
      const cost = secondhandCost(l);
      const trust = await assessShop(l.url, db);
      checked.push({ ...l, flags, vision, ...v, cost, total: cost.total, trust, conditionLabel: CONDITION_LABEL[v.conditionNorm] });
    } catch (e) {
      warnings.push(`Controle mislukt voor ${l.url}: ${e.message}`);
    }
  }
  if (!hasClaude()) warnings.push('Gratis modus: de agent filtert op opgegeven staat en beschrijving. Kijk zelf de foto’s na op model, vlekken en echtheid.');

  const approved = checked.filter((l) => l.approved).sort((a, b) => a.total - b.total);
  const best = approved.find((l) => l.fakeRisk !== 'medium') || approved[0] || null;
  for (const l of checked) l.status = l === best ? 'best' : l.approved ? 'alternatief' : 'afgekeurd';
  if (!best) warnings.push(`Vandaag geen exemplaar gevonden dat aan alles voldoet (model, staat zeer goed+, ≤ €${item.maxPrice}).`);

  return {
    best,
    offers: [...approved, ...checked.filter((l) => !l.approved)].map(slim),
    rejected: rejected.slice(0, 40).map(slim),
    stats: { found: listings.length, textPassed: candidates.length, photoChecked: checked.length, approved: approved.length },
    warnings,
    image: item.referenceImage,
  };
}

const slim = (l) => {
  const { description, ...rest } = l;
  return { ...rest, description: (description || '').slice(0, 300) };
};

// ---------- Hoofdlus ----------
export async function runAll({ only } = {}) {
  if (running) throw new Error('Agent draait al');
  running = true;
  const started = new Date();
  const db = load();
  const log_ = [];
  try {
    const items = getItems().filter((i) => !only || i.id === only);
    for (const item of items) {
      log(`▶ ${item.name}`);
      try {
        const r = item.type === 'secondhand' ? await runSecondhand(item, db) : await runNew(item, db);
        const prev = db.results[item.id];
        const today = started.toISOString().slice(0, 10);
        const history = (prev?.history || []).filter((h) => h.date !== today);
        if (r.best?.total != null) history.push({ date: today, total: r.best.total, shop: r.best.shop || r.best.source });
        db.results[item.id] = { ...r, best: r.best ? slim(r.best) : null, checkedAt: new Date().toISOString(), history: history.slice(-60) };
        log_.push({ item: item.id, ok: true, best: r.best?.total ?? null });
        log(`  ✓ beste: ${r.best ? '€' + round2(r.best.total) + ' @ ' + (r.best.shop || r.best.source) : 'geen'}`);
      } catch (e) {
        log(`  ✗ ${e.message}`);
        log_.push({ item: item.id, ok: false, error: e.message });
      }
      save(db); // tussentijds opslaan
    }
  } finally {
    db.runs = [{ startedAt: started.toISOString(), finishedAt: new Date().toISOString(), items: log_ }, ...(db.runs || [])].slice(0, 30);
    save(db);
    await flush();
    running = false;
  }
  return log_;
}
