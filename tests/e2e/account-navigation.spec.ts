import { test, expect } from '@playwright/test';
const api = `http://127.0.0.1:${process.env.E2E_API_PORT ?? '8787'}/api`;

test('product selection stays clear in the mobile selector and compact desktop rail', async ({ page, request }, info) => {
  await request.post(`${api}/test/reset`);
  for (const [id, name] of [['daily', 'Cuenta diaria'], ['savings', 'Ahorros para proyectos personales']]) {
    await request.post(`${api}/accounts`, { data: { id, name, kind: 'bank', institution: 'Banco de prueba', openingMinor: '10000000', openingDate: '2026-01-01' } });
  }
  await page.goto('./#/movimientos');
  const mobile = (page.viewportSize()?.width ?? 1280) <= 850;
  if (mobile) {
    await expect(page.locator('.mobile-account-toggle')).toContainText('Cuenta diaria');
    await page.locator('.mobile-account-toggle').click();
  } else {
    await page.getByRole('button', { name: 'Contraer menú de cuentas', exact: true }).click();
    await expect(page.locator('.accounts-panel')).toHaveCSS('width', '80px');
  }
  await page.getByRole('button', { name: 'Ahorros para proyectos personales · Cuenta bancaria', exact: true }).click();
  await expect(page.locator('.register-product-name h1')).toHaveText('Ahorros para proyectos personales');
  if (mobile) {
    await expect(page.locator('.mobile-account-toggle')).toContainText('Ahorros para proyectos personales');
    await expect(page.locator('.mobile-account-toggle')).toHaveAttribute('aria-expanded', 'false');
  } else {
    await page.getByRole('button', { name: 'Expandir menú de cuentas', exact: true }).click();
    await expect(page.locator('.rail-account.selected')).toContainText('Ahorros para proyectos personales');
    await page.getByRole('button', { name: 'Contraer menú de cuentas', exact: true }).click();
  }
  await page.screenshot({ path: info.outputPath('account-navigation.png'), fullPage: true });
});

test('compact product labels support hover, focus and Escape; rail heading fits', async ({ page, request }, info) => {
  await request.post(`${api}/test/reset`);
  await request.post(`${api}/accounts`, { data: { id: 'daily', name: 'Cuenta para gastos y proyectos personales con un nombre muy largo', kind: 'bank', openingMinor: '10000000', openingDate: '2026-01-01' } });
  await page.setViewportSize({ width: 851, height: 900 });
  await page.goto('./#/movimientos');
  const heading = page.locator('.rail-heading');
  expect(await heading.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const collapse = page.getByRole('button', { name: 'Contraer menú de cuentas', exact: true });
  await collapse.click();
  const product = page.locator('.rail-account');
  await product.focus();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toContainText('Cuenta para gastos y proyectos personales con un nombre muy largo');
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  await product.blur();
  await product.hover();
  await expect(tooltip).toBeVisible();
  await tooltip.hover();
  await expect(tooltip).toBeVisible();
  const bounds = await tooltip.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(80);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(851);
  await page.screenshot({ path: info.outputPath('compact-product-tooltip.png') });
  await page.locator('.register-product-name h1').hover();
  await expect(tooltip).toHaveCount(0);
  await page.getByRole('button', { name: 'Expandir menú de cuentas', exact: true }).click();
  for (const width of [851, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await heading.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
});
