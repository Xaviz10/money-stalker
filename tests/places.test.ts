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

describe('Google Maps HTML previews', () => {
  const page = 'https://maps.google.com/?q=Comercio+de+prueba&ftid=synthetic';
  const html = (head: string) => new Response(`<html><head>${head}</head><body></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  it('resolves a shared place by preview center, requiring confirmation and never fetching the image', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: page } }))
      .mockResolvedValueOnce(html('<meta property="og:image" content="https://maps.google.com/maps/api/staticmap?center=4.6%2C-74.1&amp;zoom=15"><script>throw new Error("must not run")</script>'));
    expect(await resolveGoogleMapsLink('https://maps.app.goo.gl/synthetic?g_st=ic', request)).toEqual({ latitude: 4.6, longitude: -74.1, approximate: true, url: page });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('prefers an exact canonical place URL over the preview camera', async () => {
    const request = vi.fn().mockResolvedValue(html('<META CONTENT="https://maps.google.com/maps/api/staticmap?center=5%2C-75" PROPERTY="og:image"><link rel="canonical" href="https://www.google.com/maps/place/Prueba/data=!3d4.6!4d-74.1">'));
    expect(await resolveGoogleMapsLink(page, request)).toMatchObject({ latitude: 4.6, longitude: -74.1, approximate: false, url: page });
  });
  it('rejects untrusted, invalid, ambiguous and non-HTML previews', async () => {
    for (const metadata of [
      '<meta property="og:image" content="https://evil.invalid/maps/api/staticmap?center=4.6,-74.1">',
      '<meta property="og:image" content="https://maps.google.com/maps/api/staticmap?center=91,-74">',
      '<meta property="og:image" content="https://maps.google.com/maps/api/staticmap?center=4,-74"><meta itemprop="image" content="https://maps.google.com/maps/api/staticmap?center=5,-75">',
      '<script>const x="!3d4.6!4d-74.1"</script>',
      '</head><body><meta property="og:image" content="https://maps.google.com/maps/api/staticmap?center=4,-74">',
    ]) await expect(resolveGoogleMapsLink(page, vi.fn().mockResolvedValue(html(metadata)))).rejects.toThrow(/coordenadas/);
    await expect(resolveGoogleMapsLink(page, vi.fn().mockResolvedValue(new Response('<meta property="og:image" content="https://maps.google.com/maps/api/staticmap?center=4,-74">', { headers: { 'content-type': 'application/json' } })))).rejects.toThrow(/coordenadas/);
  });
  it('cancels the response at the end of head and caps pages that omit it', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('<head><meta property="og:image" content="https://maps.google.com/maps/api/staticmap?center=4,-74"></head>')); }, cancel });
    expect(await resolveGoogleMapsLink(page, vi.fn().mockResolvedValue(new Response(stream, { headers: { 'content-type': 'text/html' } })))).toMatchObject({ latitude: 4, longitude: -74, approximate: true });
    expect(cancel).toHaveBeenCalledOnce();
    await expect(resolveGoogleMapsLink(page, vi.fn().mockResolvedValue(html(' '.repeat(256 * 1024))))).rejects.toThrow(/coordenadas/);
  });
  it('rejects timeout and error pages without accepting their metadata', async () => {
    await expect(resolveGoogleMapsLink(page, vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError')))).rejects.toThrow(/tardó demasiado/);
    const response = new Response('<head><meta property="og:image" content="https://maps.google.com/maps/api/staticmap?center=4,-74"></head>', { status: 429, headers: { 'content-type': 'text/html' } });
    await expect(resolveGoogleMapsLink(page, vi.fn().mockResolvedValue(response))).rejects.toThrow(/coordenadas/);
  });
});
