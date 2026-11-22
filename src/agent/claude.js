// Claude via de Anthropic Messages API (zonder SDK, puur fetch).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const hasClaude = () => Boolean(process.env.ANTHROPIC_API_KEY);

/** Afbeelding uit /public als base64-blok, of een URL-blok voor externe foto's. */
export function imageBlock(src) {
  if (src.startsWith('/')) {
    const file = path.join(root, 'public', src);
    const ext = path.extname(file).slice(1).replace('jpg', 'jpeg');
    return {
      type: 'image',
      source: { type: 'base64', media_type: `image/${ext}`, data: fs.readFileSync(file).toString('base64') },
    };
  }
  return { type: 'image', source: { type: 'url', url: src } };
}

/** Stuurt content naar Claude en parst het JSON-antwoord. */
export async function askJson(content, { system, maxTokens = 1200 } = {}) {
  if (!hasClaude()) throw new Error('ANTHROPIC_API_KEY ontbreekt');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Claude ${res.status}: ${json.error?.message || res.statusText}`);
  const text = json.content?.map((c) => c.text || '').join('') || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Geen JSON in antwoord van Claude');
  return JSON.parse(match[0]);
}
