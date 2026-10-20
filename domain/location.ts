import type { Capture } from './model';
export type CapturedLocation = NonNullable<Capture['location']>;
export function googleMapsURL(latitude: number, longitude: number, placeId?: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}${placeId ? `&query_place_id=${encodeURIComponent(placeId)}` : ''}`;
}
export function appleMapsURL(latitude: number, longitude: number) {
  return `https://maps.apple.com/place?coordinate=${encodeURIComponent(`${latitude},${longitude}`)}`;
}
export function capturedAddress(location: CapturedLocation) {
  return location.fullAddress || [...new Set([
    [location.street, location.streetNumber].filter(Boolean).join(' '),
    location.city, location.state, location.postalCode, location.region, location.country,
  ].filter(Boolean))].join(', ');
}

export type GoogleLinkLocation = { latitude: number; longitude: number; name?: string; url: string; approximate: boolean };
export function checkedGoogleMapsURL(input: string) {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error('Pega un enlace HTTPS de Google Maps.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Pega un enlace HTTPS de Google Maps sin credenciales.');
  const hosts = ['google.com', 'www.google.com', 'maps.google.com', 'google.com.co', 'www.google.com.co'];
  if (url.hostname === 'maps.app.goo.gl' && url.pathname.length > 1) return url;
  if (url.hostname === 'goo.gl' && url.pathname.startsWith('/maps/')) return url;
  if (hosts.includes(url.hostname) && (url.pathname === '/maps' || url.pathname.startsWith('/maps/') || (url.hostname === 'maps.google.com' && url.pathname === '/'))) return url;
  throw new Error('Este enlace no corresponde a Google Maps.');
}
export function parseGoogleMapsLink(input: string): GoogleLinkLocation | undefined {
  const url = checkedGoogleMapsURL(input);
  if (url.pathname.startsWith('/maps/dir')) throw new Error('Pega el enlace de un lugar, no una ruta con varios destinos.');
  const pair = (value: string | null) => {
    if (!value) return undefined;
    const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (!match) return undefined;
    const latitude = Number(match[1]), longitude = Number(match[2]);
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error('Las coordenadas del enlace no son válidas.');
    return { latitude, longitude };
  };
  let decoded = url.href;
  try { decoded = decodeURIComponent(decoded); } catch { /* Malformed optional encodings do not establish a location. */ }
  const matches = [...decoded.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)].map(match => pair(`${match[1]},${match[2]}`)!);
  if (new Set(matches.map(point => `${point.latitude},${point.longitude}`)).size > 1) throw new Error('El enlace contiene varios lugares. Copia el enlace de uno solo.');
  const nameMatch = url.pathname.match(/\/maps\/place\/([^/]+)/);
  let name: string | undefined;
  try { name = nameMatch ? decodeURIComponent(nameMatch[1].replace(/\+/g, ' ')).slice(0, 200) : undefined; } catch { /* The coordinates remain usable without a name. */ }
  const exact = matches[0] ?? pair(url.searchParams.get('query')) ?? pair(url.searchParams.get('q')?.replace(/^loc:/i, '') ?? null);
  if (exact) return { ...exact, name, url: url.href, approximate: false };
  const camera = url.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const center = camera ? pair(`${camera[1]},${camera[2]}`) : pair(url.searchParams.get('ll')) ?? pair(url.searchParams.get('center'));
  return center ? { ...center, name, url: url.href, approximate: true } : undefined;
}
