import { expect, test, type APIRequestContext } from '@playwright/test';
const api = `http://127.0.0.1:${process.env.E2E_API_PORT ?? '8787'}/api`;
async function capturedMovement(request: APIRequestContext, register = true) {
  await request.post(`${api}/test/reset`);
  await request.post(`${api}/accounts`, { data: { id: 'location-bank', name: 'Cuenta de prueba', kind: 'bank', openingMinor: '100000000', openingDate: '2026-01-01', captureAliases: ['1122'] } });
  const device = await (await request.post(`${api}/devices`, { data: { name: 'iPhone sintético' } })).json();
  await request.post(`${api}/capture-events`, { headers: { Authorization: `Bearer ${device.token}` }, data: { eventId: 'location-sms', source: 'sms', observedAt: '2026-10-20T18:00:00Z', message: 'Bancolombia: Compraste $22.000,00 en COMERCIO DE PRUEBA con tu T.Deb *1122, el 18/10/2026 a las 10:55.', location: { latitude: 4.6, longitude: -74.1, observedAt: '2026-10-20T18:00:02Z', fullAddress: 'Calle de Prueba 10, Ciudad de Prueba, Colombia', street: 'Calle de Prueba', streetNumber: '10', city: 'Ciudad de Prueba', state: 'Departamento de Prueba', postalCode: '000000', region: 'Región de Prueba', country: 'Colombia', countryCode: 'CO', url: 'https://maps.apple.com/place?coordinate=4.6,-74.1' } } });
  await expect.poll(async () => (await (await request.get(`${api}/state`)).json()).observations[0]?.location?.city).toBe('Ciudad de Prueba');
  const state = await (await request.get(`${api}/state`)).json();
  if (register) expect((await request.post(`${api}/reviews`, { data: { observationId: state.observations[0].id, action: 'separate' } })).ok()).toBe(true);
}
test('simple location editor resolves links, saves corrections and preserves capture evidence', async ({ page, request }, info) => {
  await capturedMovement(request);
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  await page.goto('./#/movimientos');
  await page.getByRole('button', { name: 'COMERCIO DE PRUEBA', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar movimiento', exact: true });
  await expect(dialog.getByLabel('Latitud del lugar')).toHaveValue('4.6');
  await dialog.getByLabel('Enlace de Google Maps').fill('https://www.google.com/maps/place/Prueba/data=!3d4.65!4d-74.15');
  await dialog.getByLabel('Enlace de Google Maps').blur();
  await expect(dialog.getByLabel('Latitud del lugar')).toHaveValue('4.65');
  await expect(dialog.getByLabel('Longitud del lugar')).toHaveValue('-74.15');
  await dialog.getByText('Ubicación original del atajo', { exact: true }).click();
  await expect(dialog.locator('.captured-address > p')).toContainText('Calle de Prueba');
  await dialog.locator('.place-picker').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('simple-location.png') });
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const state = await (await request.get(`${api}/state`)).json();
  expect(state.transactions[0].place).toMatchObject({ latitude: 4.65, longitude: -74.15, source: 'google-link' });
  expect(state.observations[0].location.latitude).toBe(4.6);
});

test('empty map offers current location and handles denied permission', async ({ page, request, context }, info) => {
  await request.post(`${api}/test/reset`);
  await request.post(`${api}/accounts`, { data: { id: 'manual-bank', name: 'Cuenta de prueba', kind: 'bank', openingMinor: '100000000', openingDate: '2026-01-01' } });
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  await page.goto('./#/movimientos');
  await page.getByRole('button', { name: 'Nuevo movimiento', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo movimiento', exact: true });
  await dialog.getByText('Ubicación y negocio', { exact: true }).click();
  await expect(dialog.getByText(/Ubicación sin configurar/)).toBeVisible();
  await expect(dialog.locator('.capture-map-frame')).toBeVisible();
  await page.evaluate(() => { navigator.geolocation.getCurrentPosition = (_success, error) => error?.({ code: 1, message: 'denied' } as GeolocationPositionError); });
  await dialog.getByRole('button', { name: 'Usar mi ubicación' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Revisa el permiso');
  await page.evaluate(() => { navigator.geolocation.getCurrentPosition = success => success({ coords: { latitude: 4.7, longitude: -74.2 } } as GeolocationPosition); });
  await dialog.getByRole('button', { name: 'Usar mi ubicación' }).click();
  await expect(dialog.getByLabel('Latitud del lugar')).toHaveValue('4.7');
  await expect(dialog.getByLabel('Longitud del lugar')).toHaveValue('-74.2');
  await dialog.getByRole('button', { name: 'Quitar lugar' }).click();
  await expect(dialog.getByText(/Ubicación sin configurar/)).toBeVisible();
  await page.screenshot({ path: info.outputPath('empty-location.png') });
});

test('MapLibre renders saved coordinates and keeps the map stable while editing', async ({ page, request }) => {
  await capturedMovement(request);
  const tile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  let tileRequests = 0;
  await page.route('https://tile.openstreetmap.org/**', route => { tileRequests++; return route.fulfill({ contentType: 'image/png', body: tile }); });
  await page.goto('./#/movimientos');
  await page.getByRole('button', { name: 'COMERCIO DE PRUEBA', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar movimiento', exact: true });
  await expect(dialog.locator('.maplibregl-canvas')).toBeVisible();
  await expect(dialog.getByText('Cargando mapa…', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText(/No se pudo cargar el mapa/)).toHaveCount(0);
  await expect.poll(() => tileRequests).toBeGreaterThan(0);
  await expect(dialog.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');
  const marker = dialog.getByLabel('Negocio confirmado por ti', { exact: true });
  await expect(marker).toBeVisible();
  await marker.evaluate(el => el.setAttribute('data-persist', 'yes'));
  await dialog.getByLabel('Comercio o descripción').fill('Comercio elegido por el usuario');
  await expect(marker).toHaveAttribute('data-persist', 'yes');
  await expect(dialog.locator('.maplibregl-canvas')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await (await request.get(`${api}/state`)).json()).observations[0].location.city).toBe('Ciudad de Prueba');
});

