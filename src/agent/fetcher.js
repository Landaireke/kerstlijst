// Gratis ophalen van pagina's: rechtstreeks met een gewone browser-header.
// Is er toch een FIRECRAWL_API_KEY ingesteld, dan wordt die als reserve gebruikt.
import * as fc from './firecrawl.js';
import { log } from './util.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

// Tweakers (DPG Media) toont anders een cookiemuur; dit zijn de functionele toestemmingscookies.
const SITE_COOKIES = { 'tweakers.net': 'pwv=2; pws=functional' };

export async function fetchText(url, { headers = {}, accept = 'text/html,application/xhtml+xml,*/*' } = {}) {
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  if (SITE_COOKIES[host] && !headers.Cookie) headers = { ...headers, Cookie: SITE_COOKIES[host] };
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'nl-BE,nl;q=0.9,fr;q=0.8,en;q=0.7', ...headers },
      redirect: 'follow',
      signal: AbortSignal.timeout(25_000),
    });
    if (res.ok) {
      const text = await res.text();
      // Cookiemuur of robotcheck = niet echt gelukt → via Firecrawl proberen
      if (!/Privacy Gate|Robot Check|validateCaptcha|api-services-support@amazon/i.test(text.slice(0, 20000))) return { text, status: res.status, headers: res.headers };
      log(`geblokkeerd (muur/captcha) ${url.slice(0, 90)}`);
    } else log(`fetch ${res.status} ${url.slice(0, 90)}`);
  } catch (e) {
    log(`fetch fout ${url.slice(0, 90)}: ${e.message}`);
  }
  if (fc.hasFirecrawl()) {
    try {
      return { text: await fc.scrapeRaw(url), status: 200, headers: new Headers() };
    } catch (e) {
      log('firecrawl reserve faalde:', e.message);
    }
  }
  return { text: '', status: 0, headers: new Headers() };
}

/** Alle schema.org-blokken (JSON-LD) uit een HTML-pagina, platgeslagen. */
export function jsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim());
      const walk = (n) => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (n && typeof n === 'object') {
          out.push(n);
          if (n['@graph']) walk(n['@graph']);
        }
      };
      walk(data);
    } catch {}
  }
  return out;
}

export function metaContent(html, prop) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i');
  return (html.match(re) || html.match(re2))?.[1] || null;
}
