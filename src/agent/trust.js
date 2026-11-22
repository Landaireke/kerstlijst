// Betrouwbaarheid van shops: bekende lijst + live reviews + Claude-beoordeling voor onbekende domeinen.
import { getShops } from '../db.js';
import { domainOf, log } from './util.js';
import * as fc from './firecrawl.js';
import { askJson, hasClaude } from './claude.js';

const CACHE_DAYS = 30;

export function knownShop(urlOrDomain) {
  const d = urlOrDomain.includes('/') ? domainOf(urlOrDomain) : urlOrDomain.replace(/^www\./, '');
  const shops = getShops();
  return shops.find((s) => d === s.domain || d.endsWith('.' + s.domain)) || null;
}

/** Tweakers shopreview (bv. 4,6 / 5 met 853 reviews) omzetten naar 0-100, gewogen naar aantal reviews. */
export function scoreFromRating(rating, count, scale = 5) {
  if (rating == null) return null;
  const base = (rating / scale) * 100;
  const weight = Math.min(1, Math.log10((count || 1) + 1) / 3); // 1000+ reviews = volle weging
  return Math.round(50 + (base - 50) * weight);
}

/**
 * Geeft {score, label, source, notes} voor een shop.
 * extra.rating/extra.reviews komen bv. rechtstreeks van Tweakers.
 */
export async function assessShop(url, db, extra = {}) {
  const domain = domainOf(url) || url;
  const known = knownShop(domain);
  let score = known?.trust ?? null;
  const notes = [];
  let source = known ? 'bekende shop' : null;
  if (known?.notes) notes.push(known.notes);

  const live = scoreFromRating(extra.rating, extra.reviews);
  if (live != null) {
    score = score == null ? live : Math.round(score * 0.5 + live * 0.5);
    notes.push(`Shopreviews: ${extra.rating}/5 (${extra.reviews || '?'} reviews)`);
    source = known ? 'bekende shop + reviews' : 'reviews';
  }

  if (score == null) {
    const cached = db.trustCache[domain];
    if (cached && Date.now() - cached.at < CACHE_DAYS * 864e5) return cached.result;
    const result = await assessUnknown(domain).catch((e) => {
      log('trust: kon', domain, 'niet beoordelen:', e.message);
      return { score: 35, label: 'onbekend', source: 'niet gecontroleerd', notes: ['Kon niet gecontroleerd worden'] };
    });
    db.trustCache[domain] = { at: Date.now(), result };
    return result;
  }
  return { score, label: label(score), source, notes };
}

async function assessUnknown(domain) {
  if (!fc.hasFirecrawl()) return { score: 35, label: 'onbekend', source: 'niet gecontroleerd', notes: [] };
  const hits = await fc.search(`${domain} reviews trustpilot OR kiyoh OR "webshop trustmark" OR "Safeshops"`, { limit: 8 });
  const snippets = hits.slice(0, 8).map((h) => `- ${h.title} (${h.url}): ${h.description || ''}`).join('\n');
  if (!hasClaude()) {
    const m = snippets.match(/(\d[.,]\d)\s*(?:\/\s*5|out of 5|op 5|sterren|stars)/i);
    const rating = m ? Number(m[1].replace(',', '.')) : null;
    const score = rating ? scoreFromRating(rating, 50) : 35;
    return { score, label: label(score), source: 'zoekresultaten', notes: rating ? [`Gevonden rating ${rating}/5`] : [] };
  }
  const r = await askJson(
    [{ type: 'text', text: `Beoordeel de betrouwbaarheid van webshop "${domain}" voor een koper in België, op basis van deze zoekresultaten:\n${snippets}\n\nLet op: echte reviewscores en aantallen, keurmerken (BeCommerce, Safeshops, Thuiswinkel Waarborg, Trustmark), klachten over niet-levering of oplichting, of het een namaak/dropshipping-site lijkt. Antwoord met JSON: {"score": 0-100, "redenen": ["kort"]}.` }],
    { maxTokens: 400 },
  );
  const score = Math.max(0, Math.min(100, Number(r.score) || 35));
  return { score, label: label(score), source: 'zoekresultaten + Claude', notes: r.redenen || [] };
}

export function label(score) {
  if (score >= 85) return 'zeer betrouwbaar';
  if (score >= 70) return 'betrouwbaar';
  if (score >= 55) return 'redelijk';
  if (score >= 40) return 'twijfelachtig';
  return 'onbekend / risico';
}
