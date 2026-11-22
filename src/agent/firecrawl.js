// Dunne wrapper rond de Firecrawl v2 API (https://docs.firecrawl.dev).
const BASE = 'https://api.firecrawl.dev/v2';

function key() {
  const k = process.env.FIRECRAWL_API_KEY;
  if (!k) throw new Error('FIRECRAWL_API_KEY ontbreekt');
  return k;
}

async function post(endpoint, body, { retries = 2 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(`${BASE}${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.success === false) {
        throw new Error(`Firecrawl ${endpoint} ${res.status}: ${json.error || res.statusText}`);
      }
      return json;
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

/** Webzoekopdracht vanuit België. Geeft [{url,title,description}] terug. */
export async function search(query, { limit = 10, country = 'BE', location = 'Belgium' } = {}) {
  const json = await post('/search', { query, limit, location, country, sources: ['web'] });
  return json.data?.web || json.data || [];
}

/** Pagina lezen als ruwe tekst (bv. JSON-API's). */
export async function scrapeRaw(url, { maxAge = 0 } = {}) {
  const json = await post('/scrape', { url, formats: ['rawHtml'], maxAge, proxy: 'auto' });
  return json.data?.rawHtml || '';
}

/** Pagina als HTML, beperkt tot bepaalde elementen (goedkoop: 1 credit). */
export async function scrapeHtml(url, includeTags = [], { maxAge = 0 } = {}) {
  const json = await post('/scrape', { url, formats: ['html'], includeTags, onlyMainContent: false, maxAge, location: { country: 'BE', languages: ['nl-BE'] } });
  return json.data?.html || '';
}

/** Pagina lezen en gestructureerde data laten extraheren volgens een JSON-schema. */
export async function scrapeJson(url, schema, prompt, { maxAge = 0, waitFor } = {}) {
  const body = {
    url,
    formats: [{ type: 'json', schema, prompt }],
    maxAge,
    proxy: 'auto',
    location: { country: 'BE', languages: ['nl-BE', 'fr-BE'] },
  };
  if (waitFor) body.waitFor = waitFor;
  const json = await post('/scrape', body);
  return { data: json.data?.json || null, metadata: json.data?.metadata || {} };
}

export const hasFirecrawl = () => Boolean(process.env.FIRECRAWL_API_KEY);
