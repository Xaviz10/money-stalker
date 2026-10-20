import { expect, test, type APIRequestContext, type Locator } from '@playwright/test';
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
async function editLocation(dialog: Locator) {
  const section = dialog.locator('.transaction-location-picker');
  await expect(section).toBeVisible();
  // The native details element opens before onToggle mounts PlacePicker.
  // Wait for that render before checking whether its compact editor needs opening.
  if (await section.getAttribute('open') === null) return;
  await expect(section.locator('.place-picker')).toBeVisible();
  const button = dialog.getByRole('button', { name: 'Editar ubicación', exact: true });
  if (await button.isVisible()) await button.click();
  await expect(dialog.getByLabel('Latitud del lugar')).toBeVisible();
}
test('simple location editor resolves links, saves corrections and preserves capture evidence', async ({ page, request }, info) => {
  await capturedMovement(request);
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  await page.goto('./#/movimientos');
  await page.getByRole('button', { name: 'COMERCIO DE PRUEBA', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar movimiento', exact: true });
  await expect(dialog.getByLabel('Enlace de Google Maps')).not.toBeVisible();
  await expect(dialog.getByLabel('Latitud del lugar')).not.toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Ver en Google Maps', exact: true })).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=4.6%2C-74.1');
  await editLocation(dialog);
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
  await editLocation(dialog);
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
  await editLocation(dialog);
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
  await editLocation(dialog);
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


test('verified shared place links update MapLibre and preserve the original evidence', async ({ page, request }, info) => {
  await capturedMovement(request, false);
  const original = (await (await request.get(`${api}/state`)).json()).observations[0].location;
  const tile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const tilePaths: string[] = [];
  await page.route('https://tile.openstreetmap.org/**', route => { tilePaths.push(new URL(route.request().url()).pathname); return route.fulfill({ contentType: 'image/png', body: tile }); });
  let requests = 0;
  await page.route('**/api/places/resolve-link', route => { requests++; return route.fulfill({ json: { latitude: 4.65, longitude: -74.15, approximate: false, name: 'Restaurante sintético', url: 'https://maps.google.com/?q=Comercio+de+prueba&ftid=0x1:0x2' } }); });
  await page.goto('./#/revisar');
  await page.getByRole('button', { name: 'Editar antes de guardar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar antes de guardar', exact: true });
  await editLocation(dialog);
  const input = dialog.getByLabel('Enlace de Google Maps');
  // Pasting then blurring must not restart an already completed lookup.
  await input.focus();
  await input.evaluate(el => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text', 'https://maps.app.goo.gl/synthetic?g_st=ic');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  await expect(dialog.getByLabel('Latitud del lugar')).toHaveValue('4.65');
  await expect(dialog.getByLabel('Longitud del lugar')).toHaveValue('-74.15');
  await expect(dialog.getByLabel('Enlace de Google Maps')).not.toBeVisible();
  await expect(dialog.getByLabel('Latitud del lugar')).not.toBeVisible();
  await expect(dialog.locator('.place-name')).toHaveText('Restaurante sintético');
  await expect(dialog.getByLabel('Comercio o descripción')).toHaveValue('COMERCIO DE PRUEBA');
  await expect(dialog.getByRole('link', { name: 'Ver en Google Maps', exact: true })).toHaveAttribute('href', 'https://maps.google.com/?q=Comercio+de+prueba&ftid=0x1:0x2');
  await expect(dialog.locator('.maplibregl-canvas')).toBeVisible();
  // Verify the map actually requests tiles covering the resolved point, so a
  // swapped coordinate order or an unchanged generic viewport cannot pass.
  await expect.poll(() => tilePaths.some(path => {
    const match = /^\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(path);
    if (!match || Number(match[1]) < 15) return false;
    const scale = 2 ** Number(match[1]);
    const x = Math.floor((-74.15 + 180) / 360 * scale);
    const y = Math.floor((1 - Math.asinh(Math.tan(4.65 * Math.PI / 180)) / Math.PI) / 2 * scale);
    return Number(match[2]) === x && Number(match[3]) === y;
  })).toBe(true);
  await input.blur();
  await expect(dialog.getByRole('checkbox', { name: /Ubicación aproximada del enlace/ })).toHaveCount(0);
  expect(requests).toBe(1);
  await dialog.locator('.place-picker').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('shared-map-preview.png') });
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const state = await (await request.get(`${api}/state`)).json();
  expect(state.transactions[0].merchant).toBe('COMERCIO DE PRUEBA');
  expect(state.transactions[0].place).toMatchObject({ name: 'Restaurante sintético', latitude: 4.65, longitude: -74.15, source: 'google-link' });
  expect(state.observations[0].location).toEqual(original);
  await page.goto('./#/movimientos');
  await page.getByRole('button', { name: 'COMERCIO DE PRUEBA', exact: true }).click();
  const savedDialog = page.getByRole('dialog', { name: 'Editar movimiento', exact: true });
  await expect(savedDialog.locator('.place-name')).toHaveText('Restaurante sintético');
  await expect(savedDialog.getByLabel('Enlace de Google Maps')).not.toBeVisible();
  await expect(savedDialog.getByRole('link', { name: 'Ver en Google Maps', exact: true })).toBeVisible();
  await savedDialog.locator('.place-picker').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('saved-compact-location.png') });
});

test('explicit camera coordinates require confirmation before they are saved', async ({ page, request }) => {
  await capturedMovement(request);
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  await page.goto('./#/movimientos');
  await page.getByRole('button', { name: 'COMERCIO DE PRUEBA', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar movimiento', exact: true });
  await editLocation(dialog);
  await dialog.getByLabel('Enlace de Google Maps').fill('https://www.google.com/maps/@4.65,-74.15,17z');
  await dialog.getByLabel('Enlace de Google Maps').blur();
  const confirmation = dialog.getByRole('checkbox', { name: /Ubicación aproximada del enlace/ });
  await confirmation.check();
  await confirmation.uncheck();
  await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await (await request.get(`${api}/state`)).json()).transactions[0].place).toBeUndefined();
});

test('unresolvable shared links preserve the previously selected place', async ({ page, request }) => {
  await capturedMovement(request);
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  await page.route('**/api/places/resolve-link', route => route.fulfill({ status: 400, json: { error: 'Enlace no disponible' } }));
  await page.goto('./#/movimientos');
  await page.getByRole('button', { name: 'COMERCIO DE PRUEBA', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar movimiento', exact: true });
  await editLocation(dialog);
  await dialog.getByLabel('Latitud del lugar').fill('4.65');
  await dialog.getByLabel('Longitud del lugar').fill('-74.15');
  await dialog.getByLabel('Enlace de Google Maps').fill('https://maps.app.goo.gl/unavailable');
  await dialog.getByLabel('Enlace de Google Maps').blur();
  await expect(dialog.getByRole('alert')).toContainText('No pudimos obtener las coordenadas');
  await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await (await request.get(`${api}/state`)).json()).transactions[0].place).toMatchObject({ latitude: 4.65, longitude: -74.15, source: 'manual' });
});

test('unverified shared place leaves a new movement without a pin or guessed coordinates', async ({ page, request }) => {
  await request.post(`${api}/test/reset`);
  await request.post(`${api}/accounts`, { data: { id: 'manual-bank', name: 'Cuenta de prueba', kind: 'bank', openingMinor: '100000000', openingDate: '2026-01-01' } });
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  await page.route('**/api/places/resolve-link', route => route.fulfill({ status: 400, json: { error: 'No pudimos verificar las coordenadas de ese lugar.' } }));
  await page.goto('./#/movimientos');
  await page.getByRole('button', { name: 'Nuevo movimiento', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo movimiento', exact: true });
  await editLocation(dialog);
  await dialog.getByLabel('Comercio o descripción').fill('Comercio sintético');
  await dialog.getByLabel('Valor (COP)').fill('22.000');
  await dialog.getByText('Ubicación y negocio', { exact: true }).click();
  await dialog.getByLabel('Enlace de Google Maps').fill('https://maps.app.goo.gl/unverified');
  await dialog.getByLabel('Enlace de Google Maps').blur();
  await expect(dialog.getByRole('alert')).toContainText('No pudimos obtener las coordenadas');
  await expect(dialog.getByLabel('Latitud del lugar')).toHaveValue('');
  await expect(dialog.getByLabel('Longitud del lugar')).toHaveValue('');
  await expect(dialog.locator('.maplibregl-marker')).toHaveCount(0);
  await expect(dialog.getByText(/Ubicación sin configurar/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await (await request.get(`${api}/state`)).json()).transactions[0].place).toBeUndefined();
});

test('merchant location can be applied to existing movements and reused or removed in new forms', async ({ page, request }, info) => {
  await capturedMovement(request);
  for (let i = 0; i < 2; i++) await request.post(`${api}/transactions`, { data: { id: `same-merchant-${i}`, accountId: 'location-bank', date: `2026-10-${10 + i}`, amountMinor: `${3100000 + i}`, kind: 'expense', merchant: 'COMERCIO DE PRUEBA', categoryId: 'car', note: `Nota ${i}` } });
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  await page.goto('./#/movimientos');
  await page.getByRole('button', { name: 'COMERCIO DE PRUEBA', exact: true }).first().click();
  let dialog = page.getByRole('dialog', { name: 'Editar movimiento', exact: true });
  await editLocation(dialog);
  // Some existing rows have no evidence, so the section may begin collapsed.
  if (!(await dialog.getByLabel('Latitud del lugar').isVisible())) await dialog.getByText('Ubicación y negocio', { exact: true }).click();
  await dialog.getByLabel('Latitud del lugar').fill('4.65');
  await dialog.getByLabel('Longitud del lugar').fill('-74.15');
  await dialog.getByLabel('Recordar esta ubicación para próximos movimientos de este comercio', { exact: true }).check();
  await dialog.getByLabel('Aplicar esta ubicación a todos los movimientos de este comercio', { exact: true }).check();
  await dialog.getByText('Ubicación y negocio', { exact: true }).click();
  await expect(dialog.locator('.place-picker')).toHaveCount(0);
  await dialog.getByText('Ubicación y negocio', { exact: true }).click();
  await editLocation(dialog);
  await expect(dialog.getByLabel('Aplicar esta ubicación a todos los movimientos de este comercio', { exact: true })).toBeChecked();
  await dialog.getByLabel('Recordar esta ubicación para próximos movimientos de este comercio', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('merchant-location-options.png') });
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  let state = await (await request.get(`${api}/state`)).json();
  expect(state.transactions.every((t: { place?: { latitude: number; longitude: number } }) => t.place?.latitude === 4.65 && t.place?.longitude === -74.15)).toBe(true);
  expect(state.transactions.find((t: { id: string }) => t.id === 'same-merchant-1')).toMatchObject({ categoryId: 'car', note: 'Nota 1' });
  expect(state.observations[0].location.latitude).toBe(4.6);
  expect(state.aliases[0].place.latitude).toBe(4.65);
  await page.getByRole('button', { name: 'Nuevo movimiento', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Nuevo movimiento', exact: true });
  await editLocation(dialog);
  await dialog.getByText('Ubicación y negocio', { exact: true }).click();
  await expect(dialog.getByLabel('Latitud del lugar')).toHaveValue('');
  await dialog.getByLabel('Comercio o descripción').fill('COMERCIO DE PRUEBA');
  await expect(dialog.getByLabel('Latitud del lugar')).toHaveValue('4.65');
  await expect(dialog.getByLabel('Longitud del lugar')).toHaveValue('-74.15');
  await editLocation(dialog);
  await expect(dialog.getByText(/Ubicación recordada para este comercio/)).toBeVisible();
  await editLocation(dialog);
  await dialog.getByRole('button', { name: 'Quitar lugar', exact: true }).click();
  await expect(dialog.getByLabel('Latitud del lugar')).toHaveValue('');
  await dialog.getByLabel('Valor (COP)').fill('77.000');
  await dialog.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  state = await (await request.get(`${api}/state`)).json();
  expect(state.transactions.find((t: { amountMinor: string }) => t.amountMinor === '7700000').place).toBeUndefined();
  expect(state.aliases[0].place.latitude).toBe(4.65);
});
