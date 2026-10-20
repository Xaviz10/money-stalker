import { expect, test, type Page } from '@playwright/test';
const api = `http://127.0.0.1:${process.env.E2E_API_PORT ?? '8787'}/api`;
async function fits(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll<HTMLElement>('input:not([type=checkbox]), select, textarea, .field, .product-aliases, .product-instrument, .account-organization, .register-product-header, .report-filters')]
      .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
      .filter(el => { const rect = el.getBoundingClientRect(); const parent = el.closest('.field')?.getBoundingClientRect(); return rect.left < -1 || rect.right > width + 1 || (parent && rect.width > parent.width + 1); })
      .map(el => `${el.tagName}.${el.className} ${el.getAttribute('name') ?? ''}`);
  });
  expect(overflow).toEqual([]);
  const clippedLabels = await page.locator('.field > span, .settings-editor summary, .form > .button').evaluateAll(elements => elements.filter(el => el.getClientRects().length && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1).map(el => el.textContent));
  expect(clippedLabels).toEqual([]);
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth ? [] : [...document.querySelectorAll<HTMLElement>('body *')].filter(el => el.getClientRects().length && el.getBoundingClientRect().right > innerWidth + 1).slice(0, 16).map(el => ({ tag: el.tagName, cls: el.className, text: el.textContent?.slice(0, 60), right: el.getBoundingClientRect().right })));
  expect(pageOverflow).toEqual([]);
}
test('iPhone product editors, movement dates and reports fit narrow screens', async ({ page, request }, info) => {
  await request.post(`${api}/test/reset`);
  await request.post(`${api}/accounts`, { data: { id: 'bank', name: 'Cuenta para gastos y proyectos personales', kind: 'bank', openingMinor: '123456789000', openingDate: '2026-01-01', institution: 'Entidad financiera de prueba', captureAliases: ['1122'] } });
  await request.post(`${api}/instruments`, { data: { id: 'debit', accountId: 'bank', name: 'Tarjeta débito para compras y pagos cotidianos', aliases: ['3344'] } });
  await page.goto('./#/cuentas');
  const row = page.locator('.account-row').first();
  await row.getByText('Editar producto', { exact: true }).click();
  await fits(page);
  await row.getByLabel('Fecha del saldo inicial').fill('2026-01-02');
  await row.getByText('Editar tarjeta', { exact: true }).click();
  await fits(page);
  await row.getByText('Agregar tarjeta débito', { exact: true }).click();
  await fits(page);
  await row.getByLabel('Fecha del saldo inicial').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('product-editor.png') });
  await page.getByRole('link', { name: 'Movimientos', exact: true }).click();
  await fits(page);
  await page.getByRole('button', { name: 'Nuevo movimiento', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo movimiento', exact: true });
  await dialog.getByLabel('Fecha', { exact: true }).fill('2026-10-18');
  await expect(dialog.getByLabel('Fecha', { exact: true })).toHaveValue('2026-10-18');
  if ((page.viewportSize()?.width ?? 1000) <= 700) {
    await expect(dialog.getByLabel('Fecha', { exact: true })).toHaveCSS('font-size', '16px');
    expect(await dialog.getByRole('combobox', { name: 'Tipo', exact: true }).evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  }
  await fits(page);
  await dialog.getByLabel('Valor (COP)').fill('22.000');
  await dialog.getByLabel('Comercio o descripción').fill('Un comercio con un nombre largo para comprobar el formulario');
  await dialog.getByLabel('Fecha', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('movement-date.png') });
  await dialog.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('link', { name: 'Reportes', exact: true }).click();
  await page.getByLabel('Desde', { exact: true }).fill('2026-10-01');
  await fits(page);
  await page.locator('.report-filters').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('report-dates.png') });
});

test('movement rows keep side gutters, readable text and complete separators', async ({ page, request }, info) => {
  await request.post(`${api}/test/reset`);
  await request.post(`${api}/accounts`, { data: { id: 'bank', name: 'Cuenta diaria', kind: 'bank', openingMinor: '100000000', openingDate: '2026-01-01' } });
  for (const [index, merchant, amountMinor, categoryId, note] of [
    [1, 'SUPERMERCADO DE PRUEBA SUCURSAL CENTRO', '12500000', 'delivery-groceries', 'Compra del mercado para la casa y productos de limpieza'],
    [2, 'NETFLIX', '4490000', 'subscriptions-netflix', ''],
    [3, 'TIENDAONLINECONUNNOMBRECONTINUOMUYLARGO', '123456789000', 'online-shopping-electronics', 'Pedido con una descripción extensa para verificar que se conserva completa'],
    [4, 'COMERCIO EJEMPLO', '2200000', 'shopping-treats', ''],
  ]) await request.post(`${api}/transactions`, { data: { id: `row-${index}`, accountId: 'bank', date: `2026-10-1${index}`, kind: 'expense', merchant, amountMinor, categoryId, note } });
  await page.goto('./#/movimientos');
  const table = page.locator('.movement-table');
  await expect(table.locator('tbody tr')).toHaveCount(4);
  await table.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('movement-rows.png') });
  if ((page.viewportSize()?.width ?? 1000) <= 700) {
    const layout = await table.evaluate(el => {
      const outer = el.getBoundingClientRect();
      return { left: parseFloat(getComputedStyle(el).paddingLeft), right: parseFloat(getComputedStyle(el).paddingRight), overflow: el.scrollWidth > el.clientWidth + 1,
        rows: [...el.querySelectorAll('tbody tr')].map(row => { const box = row.getBoundingClientRect(); return box.left >= outer.left + 15 && box.right <= outer.right - 15; }),
        text: [...el.querySelectorAll<HTMLElement>('.transaction-name, .register-movement small, .register-mobile-meta, .register-value')].every(item => item.scrollWidth <= item.clientWidth + 1),
      };
    });
    expect(layout.left).toBeGreaterThanOrEqual(16);
    expect(layout.right).toBeGreaterThanOrEqual(16);
    expect(layout.overflow).toBe(false);
    expect(layout.rows.every(Boolean)).toBe(true);
    expect(layout.text).toBe(true);
  }
  await fits(page);
  await table.getByRole('button', { name: 'NETFLIX', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Editar movimiento', exact: true })).toBeVisible();
});
