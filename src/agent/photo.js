// Gratis fotocontrole, volledig lokaal op de server (geen API-sleutel):
// 1. CLIP (open-source beeldmodel) vergelijkt elke advertentiefoto met de referentiefoto
//    en met beschrijvingen ("zwarte sweater met groot hartlogo" vs "hoodie", "knuffel", "badge", ...).
// 2. Kleurcontrole: is het kledingstuk zwart / grijs zoals gezocht?
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { log } from './util.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODEL = process.env.CLIP_MODEL || 'Xenova/clip-vit-base-patch32';
let clip = null; // { processor, vision, tokenizer, text, RawImage }
let clipFailed = false;

async function loadClip() {
  if (clip || clipFailed || process.env.ENABLE_CLIP === 'false') return clip;
  try {
    const t = await import('@huggingface/transformers');
    t.env.cacheDir = process.env.MODEL_CACHE || '/tmp/models';
    const started = Date.now();
    clip = {
      RawImage: t.RawImage,
      processor: await t.AutoProcessor.from_pretrained(MODEL),
      vision: await t.CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: 'q8' }),
      tokenizer: await t.AutoTokenizer.from_pretrained(MODEL),
      text: await t.CLIPTextModelWithProjection.from_pretrained(MODEL, { dtype: 'q8' }),
    };
    log(`CLIP geladen in ${Math.round((Date.now() - started) / 1000)}s`);
  } catch (e) {
    clipFailed = true;
    log('CLIP niet beschikbaar, alleen kleurcontrole:', e.message);
  }
  return clip;
}

const norm = (v) => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

async function imageEmbedding(src) {
  const img = await clip.RawImage.read(src);
  const inputs = await clip.processor(img);
  const { image_embeds } = await clip.vision(inputs);
  return norm(Array.from(image_embeds.data));
}

const textCache = new Map();
async function textEmbeddings(labels) {
  const key = labels.join('|');
  if (textCache.has(key)) return textCache.get(key);
  const inputs = clip.tokenizer(labels, { padding: true, truncation: true });
  const { text_embeds } = await clip.text(inputs);
  const dim = text_embeds.dims[1];
  const data = Array.from(text_embeds.data);
  const out = labels.map((_, i) => norm(data.slice(i * dim, (i + 1) * dim)));
  textCache.set(key, out);
  return out;
}

const refCache = new Map();

/** Kleuranalyse van het midden van de foto (waar het kledingstuk meestal zit). */
export async function colorProfile(buf) {
  const img = sharp(buf).rotate();
  const { width, height } = await img.metadata();
  const crop = { left: Math.round(width * 0.3), top: Math.round(height * 0.3), width: Math.round(width * 0.4), height: Math.round(height * 0.4) };
  const { data, info } = await img.extract(crop).resize(48, 48, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let black = 0, grey = 0, colored = 0, white = 0, warm = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < 55 && (sat < 0.35 || max < 30)) black++;
    else if (lum < 55) colored++;
    else if (sat > 0.28 && max > 60) colored++;
    else if (r - b > 16 && sat > 0.08) warm++; // beige, bruin, crème, camel
    else if (lum > 232 && sat < 0.08) white++;
    else if (sat < 0.12) grey++;
    else colored++;
  }
  const n = data.length / info.channels;
  return { black: black / n, grey: grey / n, white: white / n, colored: colored / n, warm: warm / n };
}

export function colorMatches(profile, want) {
  if (!want || !profile) return null;
  if (want === 'black') return profile.black >= 0.35 && profile.colored < 0.25 && (profile.warm || 0) < 0.25;
  if (want === 'grey') return profile.grey + profile.white * 0.3 >= 0.5 && profile.colored < 0.15 && (profile.warm || 0) < 0.15 && profile.black < 0.4;
  return null;
}

async function fetchImage(url) {
  if (url.startsWith('/')) return sharp(path.join(root, 'public', url)).toBuffer();
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`foto ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Controleert de foto's van een advertentie.
 * Geeft { similarity (0-1, t.o.v. referentie), label, labelProb, isTarget, colorOk, method, summary }.
 */
export async function checkPhotos(item, listing) {
  const photos = (listing.photos || []).slice(0, 3);
  if (!photos.length) return { isTarget: false, summary: 'Geen foto’s', method: 'none' };
  const model = await loadClip();
  const labels = [item.clip?.target, ...(item.clip?.others || [])].filter(Boolean);
  let best = { similarity: 0, labelProb: 0, label: null, colorOk: null };

  for (const url of photos) {
    try {
      const buf = await fetchImage(url);
      const colorOk = colorMatches(await colorProfile(buf), item.color);
      const r = { similarity: null, label: null, labelProb: null, colorOk };
      if (model && labels.length) {
        const tmp = `/tmp/kl-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
        await sharp(buf).rotate().jpeg().toFile(tmp);
        const emb = await imageEmbedding(tmp);
        if (!refCache.has(item.id)) {
          const refTmp = `/tmp/kl-ref-${item.id}.jpg`;
          await sharp(await fetchImage(item.referenceImage)).jpeg().toFile(refTmp);
          refCache.set(item.id, await imageEmbedding(refTmp));
        }
        r.similarity = dot(emb, refCache.get(item.id));
        const te = await textEmbeddings(labels);
        const logits = te.map((t) => 100 * dot(emb, t));
        const m = Math.max(...logits);
        const exps = logits.map((l) => Math.exp(l - m));
        const sum = exps.reduce((a, b) => a + b, 0);
        const probs = exps.map((e) => e / sum);
        const top = probs.indexOf(Math.max(...probs));
        r.label = labels[top];
        r.labelProb = probs[top];
        r.targetProb = probs[0];
      }
      const score = (r.targetProb ?? 0) + (r.similarity ?? 0) + (r.colorOk ? 0.2 : 0);
      const bestScore = (best.targetProb ?? 0) + (best.similarity ?? 0) + (best.colorOk ? 0.2 : 0);
      if (score >= bestScore) best = r;
    } catch (e) {
      log('fotocheck:', e.message);
    }
  }

  const simMin = Number(process.env.CLIP_MIN_SIMILARITY || 0.72);
  let isTarget;
  let summary;
  if (best.similarity != null) {
    const labelOk = best.label === labels[0];
    // Het model moet de foto herkennen als het gezochte model; alleen bij bijna-identieke foto's (≥ 90%) volstaat gelijkenis,
    // en nooit als een expliciet ander model (bv. "zonder badge") duidelijk wint.
    isTarget = (labelOk && best.similarity >= simMin - 0.1) || (best.similarity >= 0.9 && (best.targetProb ?? 0) >= 0.25);
    if (best.colorOk === false) isTarget = false;
    summary = `${Math.round(best.similarity * 100)}% gelijkenis met gezocht model · herkend als “${best.label}”${best.colorOk === false ? ' · verkeerde kleur' : ''}`;
  } else {
    isTarget = best.colorOk !== false;
    summary = best.colorOk === false ? 'Kleur komt niet overeen' : best.colorOk ? 'Kleur komt overeen (geen beeldmodel beschikbaar)' : 'Foto’s niet te beoordelen';
  }
  return { ...best, isTarget, summary, method: best.similarity != null ? 'clip' : 'kleur' };
}
