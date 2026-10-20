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
  it('stops fetching as soon as an allowlisted redirect provides coordinates', async () => {
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

describe('identity-verified Google Maps places', () => {
  const featureId = '0x1:0x2';
  const page = `https://maps.google.com/?q=Comercio+de+prueba&ftid=${featureId}`;
  const entity = (coords: unknown = [4.6, -74.1], fid = featureId, cid = '2') => [fid, 'Comercio sintético', coords, cid];
  const html = (payload: unknown, extra = '') => new Response(`<html><head>${extra}</head><body><script>function onEmbedLoad(){initEmbed(${JSON.stringify(payload)});}</script></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  it('ignores an unrelated US viewport and reads the point attached to the shared place ID', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: page } }))
      .mockResolvedValueOnce(html([[[1000, -120, 38]], null, [entity()]], '<meta property="og:image" content="https://maps.google.com/maps/api/staticmap?center=38,-120">'));
    expect(await resolveGoogleMapsLink('https://maps.app.goo.gl/synthetic?g_st=ic', request)).toEqual({ latitude: 4.6, longitude: -74.1, approximate: false, name: 'Comercio sintético', url: page });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0]).toBe('https://www.google.com/maps?cid=2&output=embed');
  });
  it('returns the business label from the matched entity rather than its full address or another place', async () => {
    const record = [featureId, 'Comercio, dirección completa', [4.6, -74.1], '2'];
    const request = vi.fn().mockResolvedValue(html([[[record, '  Nombre  del comercio  ', ['Dirección sintética']]], [[entity([38, -120], '0x3:0x4', '4'), 'Otro lugar']]]));
    expect(await resolveGoogleMapsLink(page, request)).toMatchObject({ name: 'Nombre del comercio', latitude: 4.6, longitude: -74.1 });
  });
  it('never treats generic preview metadata, camera state or another business as place evidence', async () => {
    for (const payload of [[], [[[1000, -120, 38]]], [entity([38, -120], '0x3:0x4', '4')], [entity([4.6, -74.1], featureId, '4')]]) {
      await expect(resolveGoogleMapsLink(page, vi.fn().mockResolvedValue(html(payload, '<meta property="og:image" content="https://maps.google.com/maps/api/staticmap?center=38,-120">')))).rejects.toThrow(/verificar las coordenadas/);
    }
    // An address without a verifiable identity must not fall back to an IP-based center.
    await expect(resolveGoogleMapsLink('https://maps.google.com/?q=Comercio+de+prueba', vi.fn().mockResolvedValue(html([entity()])))).rejects.toThrow(/verificar las coordenadas/);
  });
  it('rejects invalid, mismatched or conflicting place coordinates', async () => {
    for (const payload of [[entity([91, -74])], [entity(['4.6', '-74.1'])], [entity([4.6, -74.1]), entity([38, -120])], [entity([4.6, -74.1], '0x3:0x2')]]) {
      await expect(resolveGoogleMapsLink(page, vi.fn().mockResolvedValue(html(payload)))).rejects.toThrow(/coordenadas/);
    }
  });
  it('preserves full precision of 64-bit IDs and supports CID or feature ID paths', async () => {
    const fid = '0x1:0xffffffffffffffff', cid = '18446744073709551615';
    for (const url of [`https://www.google.com/maps?cid=${cid}`, `https://www.google.com/maps/place/Prueba/data=!1s${fid}`]) {
      const request = vi.fn().mockResolvedValue(html([entity([4.6, -74.1], fid, cid)]));
      expect(await resolveGoogleMapsLink(url, request)).toMatchObject({ latitude: 4.6, longitude: -74.1, approximate: false });
      expect(request.mock.calls[0][0]).toBe(`https://www.google.com/maps?cid=${cid}&output=embed`);
    }
  });
  it('rejects ambiguous and malformed identities without making a request', async () => {
    for (const url of ['https://www.google.com/maps?ftid=invalid', 'https://www.google.com/maps?cid=18446744073709551616', 'https://www.google.com/maps?cid=0', 'https://www.google.com/maps?ftid=0x1:0x2&cid=3', 'https://www.google.com/maps?ftid=0x1:0x2&ftid=0x3:0x2']) {
      const request = vi.fn();
      await expect(resolveGoogleMapsLink(url, request)).rejects.toThrow(/coordenadas/);
      expect(request).not.toHaveBeenCalled();
    }
  });
  it('parses quoted brackets in JSON without executing JavaScript', async () => {
    const payload = [[featureId, 'Comercio \" ] ) [', [4.6, -74.1], '2']];
    expect(await resolveGoogleMapsLink(page, vi.fn().mockResolvedValue(html(payload)))).toMatchObject({ latitude: 4.6, longitude: -74.1 });
    const response = new Response('<script>initEmbed((()=>{throw new Error("must not run")})());</script>', { headers: { 'content-type': 'text/html' } });
    await expect(resolveGoogleMapsLink(page, vi.fn().mockResolvedValue(response))).rejects.toThrow(/coordenadas/);
  });
  it('caps HTML size, ignores incomplete calls, and rejects non-HTML or error pages', async () => {
    for (const response of [
      html(' '.repeat(256 * 1024)),
      html(Array.from({ length: 130 }).reduce<unknown>(value => [value], [])),
      new Response(`<script>${'initEmbed([]);'.repeat(5)}</script>`, { headers: { 'content-type': 'text/html' } }),
      new Response('<script>initEmbed([[', { headers: { 'content-type': 'text/html' } }),
      new Response('not HTML', { headers: { 'content-type': 'application/json' } }),
      new Response('rate limited', { status: 429, headers: { 'content-type': 'text/html' } }),
    ]) await expect(resolveGoogleMapsLink(page, vi.fn().mockResolvedValue(response))).rejects.toThrow(/coordenadas/);
    await expect(resolveGoogleMapsLink(page, vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError')))).rejects.toThrow(/tardó demasiado/);
  });
  it('does not accept a generic camera reached through a shortlink redirect', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://www.google.com/maps/@38,-120,12z' } }))
      .mockResolvedValueOnce(html([[[1000, -120, 38]]]));
    await expect(resolveGoogleMapsLink('https://maps.app.goo.gl/synthetic', request)).rejects.toThrow(/coordenadas/);
  });
  it('blocks redirect escapes even after selecting a place identity', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://evil.invalid/maps' } }));
    await expect(resolveGoogleMapsLink(page, request)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
