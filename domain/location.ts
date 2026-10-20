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
