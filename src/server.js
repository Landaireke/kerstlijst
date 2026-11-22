import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init, load, update, getItems } from './db.js';
import { runAll, isRunning } from './agent/index.js';
import { log } from './agent/util.js';
import { fetchText, jsonLd } from './agent/fetcher.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
app.use(express.json());
app.use(express.static(path.join(root, 'public'), { maxAge: '1h' }));

const requireAdmin = (req, res, next) => {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return res.status(500).json({ error: 'ADMIN_TOKEN is niet ingesteld op de server' });
  if (req.get('x-admin-token') !== token) return res.status(401).json({ error: 'Verkeerd wachtwoord' });
  next();
};

app.get('/api/wishlist', (_req, res) => {
  const db = load();
  res.json({
    items: getItems().map((item) => ({ ...item, result: db.results[item.id] || null })),
    lastRun: db.runs?.[0] || null,
    running: isRunning(),
    schedule: process.env.CRON_SCHEDULE || '0 7 * * *',
    config: { minTrust: Number(process.env.MIN_TRUST_SCORE || 65) },
  });
});

app.post('/api/run', requireAdmin, (req, res) => {
  if (isRunning()) return res.status(409).json({ error: 'De agent is al bezig' });
  runAll({ only: req.body?.only }).catch((e) => log('run fout:', e.message));
  res.status(202).json({ ok: true, message: 'Agent gestart' });
});

app.patch('/api/items/:id', requireAdmin, (req, res) => {
  const allowed = ['name', 'searchQuery', 'searchQueries', 'maxPrice', 'image', 'ean', 'tweakersUrl', 'needsResolve'];
  const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
  if (patch.maxPrice != null) patch.maxPrice = Number(patch.maxPrice);
  update((db) => (db.overrides[req.params.id] = { ...(db.overrides[req.params.id] || {}), ...patch }));
  res.json({ ok: true });
});

// Beeldproxy: sommige shops blokkeren hotlinken van hun productfoto's.
app.get('/api/img', async (req, res) => {
  try {
    const u = new URL(String(req.query.u || ''));
    if (u.protocol !== 'https:' || /^(localhost|[\d.]+|\[.*\])$/i.test(u.hostname) || u.hostname.endsWith('.internal')) return res.status(400).end();
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: u.origin + '/' }, signal: AbortSignal.timeout(15_000) });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) return res.status(404).end();
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 5_000_000) return res.status(413).end();
    res.set({ 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' }).send(buf);
  } catch {
    res.status(400).end();
  }
});

// Diagnose: kan de server deze pagina gratis ophalen? (alleen met ADMIN_TOKEN)
app.get('/api/debug/probe', async (req, res) => {
  if (!process.env.ADMIN_TOKEN || req.query.token !== process.env.ADMIN_TOKEN) return res.status(401).end();
  const u = String(req.query.u || '');
  const { text, status } = await fetchText(u);
  const snips = [...text.matchAll(/€\s?\d{1,4}[,.]\d{2}/g)].slice(0, 12).map((m) => text.slice(Math.max(0, m.index - 260), m.index + 40).replace(/\s+/g, ' '));
  const out = { u, status, len: text.length, title: text.match(/<title>([^<]*)/i)?.[1] || null, ld: jsonLd(text).map((n) => n['@type']), snips };
  update((db) => ((db.debug = db.debug || {}), (db.debug[u] = out)));
  res.json(out);
});

app.get('/api/health', (_req, res) => res.json({ ok: true, running: isRunning() }));

await init();
const port = Number(process.env.PORT || 3000);
app.listen(port, () => log(`🎄 Kerstlijst draait op http://localhost:${port}`));

if (process.env.ENABLE_INTERNAL_CRON !== 'false') {
  const schedule = process.env.CRON_SCHEDULE || '0 7 * * *';
  cron.schedule(schedule, () => {
    log('⏰ Ochtendronde gestart');
    runAll().catch((e) => log('cron fout:', e.message));
  }, { timezone: process.env.TZ || 'Europe/Brussels' });
  log(`Agent ingepland: "${schedule}" (${process.env.TZ || 'Europe/Brussels'})`);
}
