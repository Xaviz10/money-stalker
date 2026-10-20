import { checkedGoogleMapsURL, parseGoogleMapsLink } from '../domain/location';
import { DomainError } from '../domain/model';
/** Resolve redirects only. Never fetch arbitrary URLs or scrape Google place pages. */
export async function resolveGoogleMapsLink(input: string, request: typeof fetch = fetch) {
  try {
    let url = checkedGoogleMapsURL(input);
    const direct = parseGoogleMapsLink(url.href);
    if (direct) return direct;
    const signal = AbortSignal.timeout(6000);
    for (let hop = 0; hop < 5; hop++) {
      const response = await request(url.href, { redirect: 'manual', signal, headers: { Accept: 'text/html' } });
      await response.body?.cancel();
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const next = response.headers.get('location');
      if (!next) break;
      url = checkedGoogleMapsURL(new URL(next, url).href);
      const location = parseGoogleMapsLink(url.href);
      if (location) return location;
    }
    throw new Error('No pudimos leer coordenadas de ese enlace. Ábrelo en Google Maps y copia la URL completa del lugar, o escribe las coordenadas.');
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new DomainError('El enlace tardó demasiado. Abre Google Maps y copia la URL completa del lugar.');
    throw new DomainError(error instanceof Error && error.name === 'Error' ? error.message : 'No pudimos leer ese enlace. Usa la URL completa del lugar o sus coordenadas.');
  }
}
