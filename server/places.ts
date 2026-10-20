import { Parser } from 'htmlparser2';
import { checkedGoogleMapsURL, parseGoogleMapsLink, type GoogleLinkLocation } from '../domain/location';
import { DomainError } from '../domain/model';

const MAX_HTML_BYTES = 256 * 1024;
const unreadable = 'No pudimos verificar las coordenadas de ese lugar. Abre Google Maps y copia un enlace con coordenadas, o escríbelas manualmente.';
type PlaceIdentity = { cid: string; featureId?: string };
const featureID = (value: string) => {
  const match = /^0x([\da-f]{1,16}):0x([\da-f]{1,16})$/i.exec(value);
  return match ? { featureId: `0x${BigInt(`0x${match[1]}`).toString(16)}:0x${BigInt(`0x${match[2]}`).toString(16)}`, cid: BigInt(`0x${match[2]}`).toString() } : undefined;
};

function placeIdentity(url: URL): PlaceIdentity | undefined {
  const identities: PlaceIdentity[] = [];
  for (const value of url.searchParams.getAll('ftid')) {
    const identity = featureID(value);
    if (!identity) throw new Error(unreadable);
    identities.push(identity);
  }
  for (const value of url.searchParams.getAll('cid')) {
    if (!/^\d{1,20}$/.test(value) || BigInt(value) === 0n || BigInt(value) > 0xffffffffffffffffn) throw new Error(unreadable);
    identities.push({ cid: BigInt(value).toString() });
  }
  let decodedPath = url.pathname;
  try { decodedPath = decodeURIComponent(url.pathname); } catch { /* Invalid encodings cannot provide a place ID. */ }
  for (const match of decodedPath.matchAll(/!1s(0x[\da-f]+:0x[\da-f]+)/gi)) {
    const identity = featureID(match[1]);
    if (identity) identities.push(identity);
  }
  if (new Set(identities.map(item => item.cid)).size > 1 || new Set(identities.flatMap(item => item.featureId ? [item.featureId] : [])).size > 1) throw new Error(unreadable);
  return identities.find(item => item.featureId) ?? identities[0];
}

/** Extract a JSON array argument, never evaluate the surrounding JavaScript. */
function embedData(script: string): unknown[] {
  const results: unknown[] = [];
  const calls = /\binitEmbed\s*\(\s*(?=\[)/g;
  let callCount = 0;
  for (const call of script.matchAll(calls)) {
    if (++callCount > 4) throw new Error(unreadable);
    const start = call.index! + call[0].length;
    let depth = 0, quoted = false, escaped = false;
    for (let end = start; end < script.length; end++) {
      const character = script[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
      } else if (character === '"') quoted = true;
      else if (character === '[' || character === '{') {
        if (++depth > 128) throw new Error(unreadable);
      }
      else if (character === ']' || character === '}') {
        depth--;
        if (depth === 0) {
          if (/^\s*\)/.test(script.slice(end + 1))) {
            try { results.push(JSON.parse(script.slice(start, end + 1))); } catch { /* Only strict JSON is supported. */ }
          }
          break;
        }
      }
    }
  }
  return results;
}

/** Only read a coordinate tuple attached to the exact requested place identity. */
function entityPoint(data: unknown[], expected: PlaceIdentity, url: string): GoogleLinkLocation | undefined {
  const points: GoogleLinkLocation[] = [];
  const pending: { value: unknown; parent?: unknown[] }[] = data.map(value => ({ value }));
  let visited = 0;
  while (pending.length) {
    if (++visited > 20000) throw new Error(unreadable);
    const { value: entry, parent } = pending.pop()!;
    if (!Array.isArray(entry)) continue;
    const identity = typeof entry[0] === 'string' ? featureID(entry[0]) : undefined;
    if (identity && identity.cid === expected.cid && (!expected.featureId || identity.featureId === expected.featureId) && entry[3] === expected.cid && Array.isArray(entry[2]) && entry[2].length === 2) {
      const [latitude, longitude] = entry[2];
      if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error(unreadable);
      const label = parent?.[0] === entry && typeof parent[1] === 'string' ? parent[1] : entry[1];
      const name = typeof label === 'string' ? label.trim().replace(/\s+/g, ' ').slice(0, 200) : undefined;
      points.push({ latitude, longitude, ...(name ? { name } : {}), url, approximate: false });
    }
    for (const child of entry) if (Array.isArray(child)) pending.push({ value: child, parent: entry });
  }
  if (new Set(points.map(point => `${point.latitude},${point.longitude}`)).size > 1) throw new Error(unreadable);
  return points[0];
}

/** Bounded HTML parsing. Ignore viewport metadata, images and generic map centers. */
async function readEntity(response: Response, expected: PlaceIdentity, url: string) {
  if (!response.ok || !/^text\/html(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel();
    return;
  }
  const reader = response.body?.getReader();
  if (!reader) return;
  let inScript = false, script = '';
  const data: unknown[] = [];
  const parser = new Parser({
    onopentag(tag) { if (tag === 'script') { inScript = true; script = ''; } },
    ontext(text) { if (inScript) script += text; },
    onclosetag(tag) { if (tag === 'script' && inScript) { data.push(...embedData(script)); inScript = false; script = ''; } },
  });
  const decoder = new TextDecoder();
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { parser.end(decoder.decode()); break; }
      bytes += value.byteLength;
      if (bytes > MAX_HTML_BYTES) throw new Error(unreadable);
      parser.write(decoder.decode(value, { stream: true }));
    }
  } finally { await reader.cancel(); }
  return entityPoint(data, expected, url);
}

/** Resolve allowlisted redirects and identity-matched place data, never viewport guesses. */
export async function resolveGoogleMapsLink(input: string, request: typeof fetch = fetch) {
  try {
    let url = checkedGoogleMapsURL(input);
    const direct = parseGoogleMapsLink(url.href);
    if (direct && (!direct.approximate || !placeIdentity(url))) return direct;
    const signal = AbortSignal.timeout(8000);
    let expected: PlaceIdentity | undefined, placeURL = url.href;
    for (let hop = 0; hop < 5; hop++) {
      if (!expected) {
        const location = parseGoogleMapsLink(url.href);
        if (location && !location.approximate) return location;
        expected = placeIdentity(url);
        if (expected) {
          placeURL = url.href;
          url = new URL(`https://www.google.com/maps?cid=${expected.cid}&output=embed`);
        }
      }
      const response = await request(url.href, { redirect: 'manual', signal, headers: { Accept: 'text/html' } });
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        if (expected) {
          const point = await readEntity(response, expected, placeURL);
          if (point) return point;
        } else await response.body?.cancel();
        break;
      }
      await response.body?.cancel();
      const next = response.headers.get('location');
      if (!next) break;
      url = checkedGoogleMapsURL(new URL(next, url).href);
    }
    throw new Error(unreadable);
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new DomainError('El enlace tardó demasiado. Abre Google Maps y copia un enlace con coordenadas.');
    throw new DomainError(error instanceof Error && error.name === 'Error' ? error.message : unreadable);
  }
}
