// Staat- en modelcontrole van tweedehandstruien: eerst tekst, dan Claude kijkt naar de foto's.
import { askJson, imageBlock, hasClaude } from './claude.js';

/** Staat normaliseren naar: new_tags | new | very_good | good | fair | unknown */
export function normalizeCondition(c) {
  if (!c) return 'unknown';
  const s = c.toLowerCase();
  if (/(met|avec).*(prijskaart|étiquette|label|tags?)|with tags/.test(s)) return 'new_tags';
  if (/^nieuw|^neuf|^new|zonder prijskaart|sans étiquette/.test(s)) return 'new';
  if (/zo goed als nieuw|zeer goed|très bon|very good|uitstekend|excellent|comme neuf/.test(s)) return 'very_good';
  if (/^goed|^bon|^good|gebruikt|used/.test(s)) return 'good';
  if (/redelijk|satisfaisant|matig|fair|niet werkend/.test(s)) return 'fair';
  return 'unknown';
}

const RANK = { new_tags: 5, new: 4, very_good: 3, good: 2, fair: 1, unknown: 0 };
export const conditionOk = (norm, min = 'very_good') => norm === 'unknown' || RANK[norm] >= RANK[min];

export const CONDITION_LABEL = {
  new_tags: 'Nieuw met labels', new: 'Nieuw', very_good: 'Zeer goed', good: 'Goed (te laag)', fair: 'Redelijk (te laag)', unknown: 'Niet vermeld',
};

const DEFECT_WORDS = /\b(vlek(je|ken)?|scheur(tje)?|gaatje|gat(en)?\b|pilling|pluis|bolletjes|verkleurd|vaal|beschadig\w*|kapot|defect|tache[s]?|trou[s]?|déchir\w*|boulochage|bouloch\w*|délavé|abîm\w*|stain(s|ed)?|hole[s]?|tear|ripped|faded|flecken|loch)\b/i;
const KIDS_WORDS = /\b(junior|kids?|kinder\w*|enfant\w*|jongen\w*|meisje\w*|bimbo|niño|\d{1,2}\s?(jaar|ans|years|anni)|maat\s?(9[28]|1[0-7]\d)\b|(1[0-7]\d|9[28])\s?cm|taille\s?(1[0-6]\d))\b/i;
const FAKE_WORDS = /\b(replica|rep\b|1:1|aaa|inspired|look-?alike|dupe|copie|kopie|namaak|imitatie|zonder badge|sans badge|no badge|zonder logo)\b/i;

export function textCheck(listing) {
  const text = `${listing.title} ${listing.description || ''} ${listing.size || ''}`;
  const flags = [];
  const d = text.match(DEFECT_WORDS);
  // "geen vlekken" / "pas de tache" / "zonder gaatjes" is juist positief
  if (d && !new RegExp(`(geen|zonder|aucune?|pas de|sans|no|keine)\\s+(\\w+\\s+)?${d[0]}`, 'i').test(text)) flags.push({ type: 'defect', text: `Beschrijving vermeldt "${d[0]}"` });
  const k = text.match(KIDS_WORDS);
  if (k) flags.push({ type: 'kids', text: `Lijkt kindermaat ("${k[0]}")` });
  const f = text.match(FAKE_WORDS);
  if (f) flags.push({ type: 'fake', text: `Verdacht: "${f[0]}"` });
  return flags;
}

/**
 * Claude vergelijkt de advertentiefoto's met de referentiefoto.
 * Geeft {sameModel, modelConfidence, condition, defects[], fakeRisk, fakeReasons[], kidsSize, summary}.
 */
export async function visionCheck(item, listing) {
  if (!hasClaude()) return null;
  const photos = (listing.photos || []).slice(0, 4);
  if (!photos.length) return { sameModel: false, condition: 'unknown', defects: [], fakeRisk: 'unknown', summary: 'Geen foto’s in de advertentie' };
  const content = [
    { type: 'text', text: 'REFERENTIEFOTO van het gezochte model:' },
    imageBlock(item.referenceImage),
    { type: 'text', text: `Gezocht model: ${item.modelDescription}\n\nADVERTENTIE: "${listing.title}" – ${listing.price != null ? '€' + listing.price : 'prijs onbekend'} – maat ${listing.size || '?'} – opgegeven staat: ${listing.condition || '?'}\nBeschrijving: ${(listing.description || '').slice(0, 800)}\n\nFOTO'S VAN DE ADVERTENTIE:` },
    ...photos.map((p) => imageBlock(p)),
    {
      type: 'text',
      text: `Beoordeel kritisch, als een ervaren tweedehandskoper:
1. Is dit HETZELFDE model als de referentie (type kledingstuk, kleur, logo/badge en plaats ervan)?
2. Staat van het kledingstuk op de foto's: zoek naar vlekken, scheuren, gaatjes, pilling, verkleuring, uitgerekte boorden, losse naden, beschadigde badge/print.
3. Namaakrisico: let op logo-vorm en -verhoudingen, labels, stiksels, badge-knoopjes (Stone Island), lettertype (Essentials), en een prijs die verdacht laag is voor 'nieuw'.
4. Kindermaat?
Antwoord ALLEEN met JSON:
{"sameModel": true/false, "modelConfidence": 0-1, "condition": "excellent"|"very_good"|"good"|"poor"|"unknown", "defects": ["..."], "fakeRisk": "low"|"medium"|"high", "fakeReasons": ["..."], "kidsSize": true/false, "summary": "max 25 woorden, Nederlands"}`,
    },
  ];
  return askJson(content, { maxTokens: 700 });
}

/** Eindoordeel op basis van opgegeven staat, tekstcheck en fotocheck. */
export function verdict(item, listing, flags, vision) {
  const reasons = [];
  const norm = normalizeCondition(listing.condition);
  if (!conditionOk(norm, item.minCondition)) reasons.push(`Staat "${listing.condition}" is lager dan zeer goed`);
  for (const f of flags) if (f.type !== 'fake') reasons.push(f.text);
  if (vision) {
    if (!vision.sameModel) reasons.push('Ander model dan op de foto');
    if (['good', 'poor'].includes(vision.condition)) reasons.push(`Foto's tonen staat "${vision.condition}"`);
    if (vision.defects?.length) reasons.push(`Gebreken op foto: ${vision.defects.join(', ')}`);
    if (vision.kidsSize) reasons.push('Kindermaat');
    if (vision.condition === 'unknown' && norm === 'unknown') reasons.push('Staat niet te beoordelen');
  } else if (norm === 'unknown') {
    reasons.push('Staat niet vermeld en geen fotocheck mogelijk');
  }
  if (listing.sold) reasons.push('Al verkocht');
  const fakeRisk = vision?.fakeRisk || (flags.some((f) => f.type === 'fake') ? 'high' : 'unknown');
  if (flags.some((f) => f.type === 'fake') || fakeRisk === 'high') reasons.push('Hoog risico op namaak');
  return { approved: reasons.length === 0, reasons, fakeRisk, conditionNorm: norm };
}

/** Titel-/kleurregels uit config: elke groep moet minstens één keer voorkomen, uitsluitingen nooit in de titel. */
export function ruleCheck(item, l) {
  const all = `${l.title} ${l.description || ''} ${l.color || ''} ${l.brand || ''}`.toLowerCase();
  const titleColor = `${l.title} ${l.color || ''}`.toLowerCase();
  const has = (txt, w) => new RegExp(`(^|[^a-zà-ÿ])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\&]/g, '\\$&')}([^a-zà-ÿ]|$)`).test(txt);
  for (const group of item.mustInclude || []) {
    if (!group.some((w) => has(all, w))) return `Mist "${group[0]}"`;
  }
  const bad = (item.titleExclude || []).find((w) => has(titleColor, w));
  return bad ? `Ander model ("${bad}")` : null;
}
