// Opslag: in het geheugen + lokaal JSON-bestand, en (indien ingesteld) gesynchroniseerd met Supabase.
// Zo werkt de app ook op gratis hosting zonder blijvende schijf.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR || path.join(root, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SEED_FILE = path.join(root, 'data', 'db.json');
const CONFIG_FILE = path.join(root, 'config', 'wishlist.json');
const SHOPS_FILE = path.join(root, 'config', 'shops.json');

const empty = () => ({ results: {}, runs: [], trustCache: {}, overrides: {} });
let cache = null;
let pending = Promise.resolve();

const remote = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_KEY && process.env.KL_STORE_SECRET);

async function rpc(fn, args) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Supabase ${fn} ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

function readFileDb() {
  for (const f of [DB_FILE, SEED_FILE]) {
    try {
      return { ...empty(), ...JSON.parse(fs.readFileSync(f, 'utf8')) };
    } catch {}
  }
  return empty();
}

/** Eén keer bij het opstarten: haal de laatste stand op uit Supabase (of het lokale bestand). */
export async function init() {
  if (remote()) {
    try {
      const doc = await rpc('kl_get', { p_secret: process.env.KL_STORE_SECRET });
      if (doc && Object.keys(doc).length) {
        cache = { ...empty(), ...doc };
        console.log('db: geladen uit Supabase');
        return;
      }
      cache = readFileDb();
      await rpc('kl_put', { p_secret: process.env.KL_STORE_SECRET, p_doc: cache });
      console.log('db: Supabase gevuld met startdata');
      return;
    } catch (e) {
      console.error('db: Supabase niet bereikbaar, val terug op bestand:', e.message);
    }
  }
  cache = readFileDb();
}

export function load() {
  if (!cache) cache = readFileDb();
  return structuredClone(cache);
}

export function save(db) {
  cache = structuredClone(db);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    console.error('db: bestand schrijven mislukt:', e.message);
  }
  if (remote()) {
    const snapshot = cache;
    pending = pending
      .then(() => rpc('kl_put', { p_secret: process.env.KL_STORE_SECRET, p_doc: snapshot }))
      .catch((e) => console.error('db: Supabase opslaan mislukt:', e.message));
  }
}

/** Wacht tot alle openstaande Supabase-schrijfacties klaar zijn. */
export const flush = () => pending;

export function update(fn) {
  const db = load();
  const out = fn(db);
  save(db);
  return out;
}

/** Wishlist uit config, aangevuld met aanpassingen uit de UI (overrides). */
export function getItems() {
  const { items } = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const { overrides } = load();
  return items.map((it) => ({ ...it, ...(overrides[it.id] || {}) }));
}

export function getShops() {
  return JSON.parse(fs.readFileSync(SHOPS_FILE, 'utf8')).shops;
}
