import { describe, expect, it, vi } from 'vitest';
import { parseGoogleMapsLink } from '../domain/location';
import { resolveGoogleMapsLink } from '../server/places';

describe('Google Maps place links', () => {
  it('reads exact query and place coordinates without mistaking the camera center for a business', () => {
    expect(parseGoogleMapsLink('https://www.google.com/maps/search/?api=1&query=4.6%2C-74.1')).toMatchObject({ latitude: 4.6, longitude: -74.1, approximate: false });
    expect(parseGoogleMapsLink('https://www.google.com/maps/place/Comercio+Ejemplo/@4.7,-74.2,17z/data=!8m2!3d4.6!4d-74.1')).toMatchObject({ latitude: 4.6, longitude: -74.1, name: 'Comercio Ejemplo', approximate: false });
    expect(parseGoogleMapsLink('https://www.google.com/maps/place/Ejemplo/@4.7,-74.2,17z')).toMatchObject({ latitude: 4.7, longitude: -74.2, approximate: true });
    expect(parseGoogleMapsLink('https://maps.google.com/?q=loc:4.6,-74.1')).toMatchObject({ latitude: 4.6, longitude: -74.1 });
    expect(parseGoogleMapsLink('https://www.google.com/maps/place/Ejemplo/data=%218m2%213d4.6%214d-74.1')).toMatchObject({ latitude: 4.6, longitude: -74.1 });
  });
  it('rejects routes, ambiguity, invalid coordinates and untrusted links', () => {
    for (const value of ['https://www.google.com/maps/dir/4,-74/5,-75', 'https://www.google.com/maps/place/Demo/data=!3d4!4d-74!3d5!4d-75', 'https://www.google.com/maps?q=91,-74', 'https://google.com.evil.invalid/maps?q=4,-74', 'http://www.google.com/maps?q=4,-74', 'https://user:password@www.google.com/maps?q=4,-74', 'https://www.google.com:8443/maps?q=4,-74', 'javascript:alert(1)']) expect(() => parseGoogleMapsLink(value)).toThrow();
  });
  it('resolves only allowlisted redirects and never downloads place pages', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://www.google.com/maps/place/Ejemplo/data=!3d4.6!4d-74.1' } }));
    expect(await resolveGoogleMapsLink('https://maps.app.goo.gl/synthetic', request)).toMatchObject({ latitude: 4.6, longitude: -74.1 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    request.mockClear();
    await resolveGoogleMapsLink('https://www.google.com/maps?q=4.6,-74.1', request);
    expect(request).not.toHaveBeenCalled();
  });
  it('blocks redirect escapes, loops and pages without coordinates', async () => {
    for (const target of ['http://127.0.0.1/private', 'https://evil.invalid/private', 'https://www.google.com.evil.invalid/maps?q=4,-74']) {
      const request = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: target } }));
      await expect(resolveGoogleMapsLink('https://maps.app.goo.gl/synthetic', request)).rejects.toThrow();
      expect(request).toHaveBeenCalledTimes(1);
    }
    const loop = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://maps.app.goo.gl/synthetic' } }));
    await expect(resolveGoogleMapsLink('https://maps.app.goo.gl/synthetic', loop)).rejects.toThrow(/coordenadas/);
    expect(loop).toHaveBeenCalledTimes(5);
    await expect(resolveGoogleMapsLink('https://maps.app.goo.gl/synthetic', vi.fn().mockResolvedValue(new Response('no coordinates')))).rejects.toThrow(/coordenadas/);
  });
});
