/** "€ 1.045,99" / "45,34" / "54,-" / 45.34 → 45.34 */
export function parsePrice(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).toLowerCase();
  if (/gratis|free|offert|0,-/.test(s) && !/\d[,.]\d/.test(s.replace('0,-', ''))) return 0;
  const m = s.replace(/\s/g, '').match(/(\d{1,3}(?:[.\s]\d{3})*|\d+)(?:[,.](\d{1,2}|-))?/);
  if (!m) return null;
  const whole = m[1].replace(/[.\s]/g, '');
  const dec = m[2] && m[2] !== '-' ? m[2].padEnd(2, '0') : '00';
  return Number(`${whole}.${dec}`);
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export const round2 = (n) => Math.round(n * 100) / 100;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Voert taken uit met beperkte gelijktijdigheid. */
export async function pool(items, size, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx], idx);
      } catch (e) {
        out[idx] = { error: e.message };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

export function log(...args) {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}
