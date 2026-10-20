import { Parser } from 'htmlparser2';
import { checkedGoogleMapsURL, parseGoogleMapsLink, type GoogleLinkLocation } from '../domain/location';
import { DomainError } from '../domain/model';

const MAX_HEAD_BYTES = 256 * 1024;
const unreadable = 'No pudimos leer coordenadas de ese enlace. Ábrelo en Google Maps y copia la URL completa del lugar, o escribe las coordenadas.';

/** Read preview metadata only: never execute scripts or request referenced resources. */
async function readPreview(response: Response, url: URL): Promise<GoogleLinkLocation | undefined> {
  if (!response.ok || !/^text\/html(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel();
    return;
  }
  const reader = response.body?.getReader();
  if (!reader) return;
  const canonical: string[] = [], images: string[] = [];
  let headComplete = false;
  const parser = new Parser({
    onopentag(tag, attrs) {
      if (tag === 'body') headComplete = true;
      if (headComplete) return;
      if (tag === 'link' && attrs.rel?.split(/\s+/).includes('canonical') && attrs.href) canonical.push(attrs.href);
      if (tag === 'meta' && attrs.content) {
        if (attrs.property === 'og:url') canonical.push(attrs.content);
        if (attrs.property === 'og:image' || attrs.itemprop === 'image') images.push(attrs.content);
      }
    },
    onclosetag(tag) { if (tag === 'head') headComplete = true; },
  }, { decodeEntities: true });
  const decoder = new TextDecoder();
  let bytes = 0;
  try {
    while (!headComplete) {
      const { done, value } = await reader.read();
      if (done) { parser.end(decoder.decode()); break; }
      bytes += value.byteLength;
      if (bytes > MAX_HEAD_BYTES) throw new Error(unreadable);
      parser.write(decoder.decode(value, { stream: true }));
    }
  } finally { await reader.cancel(); }

  // Only a Google Maps canonical URL may provide an exact point. Never guess
  // from coordinate-looking script arrays or unrelated links on the page.
  const exact: GoogleLinkLocation[] = [];
  for (const href of canonical) {
    try {
      const point = parseGoogleMapsLink(new URL(href, url).href);
      if (point && !point.approximate) exact.push(point);
    } catch { /* Non-Maps metadata is not evidence. */ }
  }
  const distinct = (points: GoogleLinkLocation[]) => new Set(points.map(p => `${p.latitude},${p.longitude}`)).size;
  if (distinct(exact) > 1) throw new Error(unreadable);
  if (exact[0]) return { ...exact[0], url: url.href };

  // The static preview exposes a viewport center, not guaranteed merchant
  // coordinates. Show it in MapLibre but require the owner's acknowledgment.
  const centers: GoogleLinkLocation[] = [];
  for (const image of images) {
    try {
      const preview = new URL(image);
      if (preview.protocol !== 'https:' || preview.username || preview.password || preview.port ||
        !['maps.google.com', 'www.google.com', 'maps.googleapis.com'].includes(preview.hostname) ||
        preview.pathname !== '/maps/api/staticmap') continue;
      const center = preview.searchParams.get('center');
      if (!center) continue;
      const point = parseGoogleMapsLink(`https://www.google.com/maps?query=${encodeURIComponent(center)}`);
      if (point) centers.push({ ...point, url: url.href, approximate: true });
    } catch { /* Invalid or untrusted image metadata cannot establish a point. */ }
  }
  if (distinct(centers) > 1) throw new Error(unreadable);
  return centers[0];
}

/** Resolve allowlisted redirects, then bounded Google Maps preview metadata. */
export async function resolveGoogleMapsLink(input: string, request: typeof fetch = fetch) {
  try {
    let url = checkedGoogleMapsURL(input);
    const direct = parseGoogleMapsLink(url.href);
    if (direct) return direct;
    const signal = AbortSignal.timeout(8000);
    for (let hop = 0; hop < 5; hop++) {
      const response = await request(url.href, { redirect: 'manual', signal, headers: { Accept: 'text/html' } });
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        const isPlacePage = !['maps.app.goo.gl', 'goo.gl'].includes(url.hostname);
        if (isPlacePage) {
          const preview = await readPreview(response, url);
          if (preview) return preview;
        } else await response.body?.cancel();
        break;
      }
      await response.body?.cancel();
      const next = response.headers.get('location');
      if (!next) break;
      url = checkedGoogleMapsURL(new URL(next, url).href);
      const location = parseGoogleMapsLink(url.href);
      if (location) return location;
    }
    throw new Error(unreadable);
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new DomainError('El enlace tardó demasiado. Abre Google Maps y copia la URL completa del lugar.');
    throw new DomainError(error instanceof Error && error.name === 'Error' ? error.message : 'No pudimos leer ese enlace. Usa la URL completa del lugar o sus coordenadas.');
  }
}
