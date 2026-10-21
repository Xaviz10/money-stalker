import { expect, test } from "@playwright/test";
const apiBase = `http://127.0.0.1:${process.env.E2E_API_PORT ?? "8787"}/api`;
test.beforeEach(async ({ request }) => { await request.post(`${apiBase}/test/reset`); });

test("ATM cash, cash income, pockets and manually valued investments keep balances distinct", async ({ page, request }, testInfo) => {
  await request.post(`${apiBase}/accounts`, { data: { id: "bank", name: "Ahorros de prueba", kind: "bank", openingMinor: "100000000", openingDate: "2026-01-01" } });
  await request.post(`${apiBase}/instruments`, { data: { id: "debit", name: "Débito", accountId: "bank", aliases: ["1122"] } });
  const device = await (await request.post(`${apiBase}/devices`, { data: { name: "iPhone sintético" } })).json();
  await request.post(`${apiBase}/capture-events`, { headers: { Authorization: `Bearer ${device.token}` }, data: {
    eventId: "atm", source: "sms", observedAt: "2026-10-18T18:00:00Z", message: "Bancolombia: Retiraste $100.000,00 en CAJERO EJEMPLO de tu T.Deb **1122 el 18/10/2026 a las 12:00.",
  } });
  await expect.poll(async () => (await (await request.get(`${apiBase}/state`)).json()).transactions.length).toBe(1);
  await page.goto("./#/cuentas");
  await expect(page.locator(".cash-accounts")).toContainText("Efectivo");
  await page.getByRole("button", { name: "Recibir efectivo", exact: true }).click();
  const income = page.getByRole("dialog", { name: "Nuevo movimiento" });
  await expect(income.getByRole("combobox", { name: "Tipo", exact: true })).toHaveValue("income");
  await expect(income.getByRole("combobox", { name: "Cuenta de origen", exact: true })).toHaveValue("cash:auto");
  await income.getByLabel("Valor (COP)").fill("10.000");
  await income.getByLabel("Comercio o descripción").fill("Regalo recibido");
  await income.getByRole("button", { name: "Registrar movimiento", exact: true }).click();
  await expect(income).not.toBeVisible();
  const create = page.locator(".settings-section").filter({ has: page.getByText("Agregar producto", { exact: true }) });
  await create.locator(":scope > summary").click();
  for (const [kind, name] of [["pocket", "Viaje"], ["investment", "Fondo de prueba"]]) {
    await create.getByLabel("Tipo de cuenta").selectOption(kind);
    await create.getByLabel("Nombre de la cuenta", { exact: true }).fill(name);
    await create.getByLabel("Alias de destino en SMS (opcional)").fill(kind === "pocket" ? "3344" : "5566");
    await create.getByLabel("Saldo inicial (COP)").fill("0");
    await create.getByLabel("Fecha del saldo inicial").fill("2026-01-01");
    await create.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.locator(".account-row").filter({ has: page.getByText(name, { exact: true }) })).toBeVisible();
  }
  let state = await (await request.get(`${apiBase}/state`)).json();
  const pocket = state.accounts.find((account: { kind: string }) => account.kind === "pocket");
  const investment = state.accounts.find((account: { kind: string }) => account.kind === "investment");
  for (const [id, destination, value] of [["reserve", pocket.id, "20000000"], ["invest", investment.id, "30000000"]]) {
    const suffix = destination === pocket.id ? "3344" : "5566";
    const amount = value === "20000000" ? "200.000,00" : "300.000,00";
    const response = await request.post(`${apiBase}/capture-events`, { headers: { Authorization: `Bearer ${device.token}` }, data: { eventId: id, source: "sms", observedAt: "2026-10-18T18:00:00Z", message: `Bancolombia: Transferiste $${amount} desde tu cuenta *1122 a mi producto *${suffix} el 18/10/2026 a las 12:00.` } });
    expect(response.ok()).toBe(true);
  }
  await expect.poll(async () => (await (await request.get(`${apiBase}/state`)).json()).transactions.length).toBe(4);
  await page.getByRole("button", { name: "Actualizar datos" }).click();
  const product = page.locator(".account-row").filter({ has: page.getByText("Fondo de prueba", { exact: true }) });
  await product.getByText("Actualizar valor de inversión", { exact: true }).click();
  await product.getByLabel("Valor actual de la inversión (COP)").fill("330.000");
  await product.getByLabel("Fecha de valoración").fill("2026-10-18");
  await product.getByLabel("Nota de valoración (opcional)").fill("Valor consultado manualmente");
  await product.getByRole("button", { name: "Guardar valor actual" }).click();
  await product.locator(".investment-history > summary").click();
  await expect(product.locator(".investment-history")).toContainText("Ajuste declarado: $ 30.000");
  await expect(product.locator(".investment-history")).toContainText("Valor consultado manualmente");
  state = await (await request.get(`${apiBase}/state`)).json();
  expect(state.valuations).toHaveLength(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("products-and-values.png"), fullPage: true });
  await page.getByRole("link", { name: "Resumen", exact: true }).click();
  await expect(page.locator(".available-total > strong")).toHaveText("$ 510.000");
  await expect(page.getByRole("region", { name: "Dinero por tipo de producto" })).toContainText("$ 330.000");
  await expect(page.locator(".holdings-summary")).toContainText("$ 200.000");
  await expect(page.locator(".holdings-summary")).toContainText("$ 110.000");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("product-summary.png"), fullPage: true });
});

test("manual pocket and investment transfers let the owner choose cash as the source", async ({ page, request }) => {
  for (const [id, kind, name, openingMinor] of [
    ["bank", "bank", "Banco de prueba", "200000000"],
    ["cash", "cash", "Efectivo de prueba", "100000000"],
    ["pocket", "pocket", "Bolsillo de prueba", "0"],
    ["investment", "investment", "Inversión de prueba", "0"],
  ]) {
    expect((await request.post(`${apiBase}/accounts`, { data: { id, kind, name, openingMinor, openingDate: "2026-01-01" } })).ok()).toBe(true);
  }
  await page.goto("./#/resumen");
  for (const destination of ["pocket", "investment"]) {
    await page.getByRole("button", { name: "Nuevo movimiento", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Nuevo movimiento", exact: true });
    await editor.getByRole("combobox", { name: "Tipo", exact: true }).selectOption("transfer");
    await editor.getByRole("combobox", { name: "Cuenta de origen", exact: true }).selectOption("cash");
    await editor.getByLabel("Cuenta destino").selectOption(destination);
    await editor.getByLabel("Valor (COP)").fill("100.000");
    await editor.getByRole("button", { name: "Registrar movimiento", exact: true }).click();
    await expect(editor).not.toBeVisible();
  }
  const summary = await (await request.get(`${apiBase}/dashboard`)).json();
  expect(summary.balances).toMatchObject({ bank: "200000000", cash: "80000000", pocket: "10000000", investment: "10000000" });
  expect(summary.availableMinor).toBe("280000000");
  expect(summary.spendingMinor).toBe("0");
  expect(summary.incomeMinor).toBe("0");
  const state = await (await request.get(`${apiBase}/state`)).json();
  expect(state.transactions.every((movement: { accountId: string; kind: string }) => movement.accountId === "cash" && movement.kind === "transfer")).toBe(true);
});

test("manual investments offer existing products and inline creation, then CSV reuses the remembered merchant rule", async ({ page, request }, testInfo) => {
  for (const [id, kind, name, openingMinor] of [
    ["bank", "bank", "Banco de prueba", "100000000"],
    ["cash", "cash", "Efectivo de prueba", "20000000"],
    ["existing-investment", "investment", "Producto existente", "0"],
  ]) await request.post(`${apiBase}/accounts`, { data: { id, kind, name, openingMinor, openingDate: "2026-01-01" } });
  await request.post(`${apiBase}/categories`, { data: { id: "investments", name: "Aportes a inversión", scope: "expense" } });
  await page.goto("./#/resumen");
  await page.getByRole("button", { name: "Nuevo movimiento", exact: true }).click();
  let editor = page.getByRole("dialog", { name: "Nuevo movimiento", exact: true });
  await editor.getByLabel("Categoría de gasto").selectOption("__investment__");
  await editor.getByRole("combobox", { name: "Cuenta de origen", exact: true }).selectOption("cash");
  await editor.getByLabel("Comercio o descripción").fill("FONDO SINTÉTICO");
  await expect(editor.getByLabel("Nombre del nuevo producto de inversión")).toHaveValue("FONDO SINTÉTICO");
  await editor.getByLabel("Nombre del nuevo producto de inversión").fill("Plan a largo plazo");
  await editor.getByLabel("Valor (COP)").fill("50.000");
  await editor.getByLabel("Recordar este comercio, su categoría y producto de inversión para próximas importaciones").check();
  await editor.screenshot({ path: testInfo.outputPath("inline-investment.png") });
  await editor.getByRole("button", { name: "Registrar movimiento", exact: true }).click();
  await expect(editor).not.toBeVisible();
  let state = await (await request.get(`${apiBase}/state`)).json();
  const investment = state.accounts.find((account: { name: string }) => account.name === "Plan a largo plazo");
  expect(investment).toBeDefined();
  expect(state.transactions[0]).toMatchObject({ kind: "transfer", accountId: "cash", counterAccountId: investment.id, categoryId: "uncategorized" });
  await page.getByRole("button", { name: "Nuevo movimiento", exact: true }).click();
  editor = page.getByRole("dialog", { name: "Nuevo movimiento", exact: true });
  await editor.getByLabel("Categoría de gasto").selectOption("__investment__");
  await editor.getByRole("combobox", { name: "Cuenta de origen", exact: true }).selectOption("bank");
  await editor.getByLabel("Comercio o descripción").fill("FONDO SINTÉTICO");
  await expect(editor.getByRole("combobox", { name: "Producto de inversión", exact: true })).toHaveValue(investment.id);
  await editor.getByRole("combobox", { name: "Producto de inversión", exact: true }).selectOption("existing-investment");
  await expect(editor.getByLabel("Nombre del nuevo producto de inversión")).toHaveCount(0);
  await editor.getByRole("combobox", { name: "Producto de inversión", exact: true }).selectOption(investment.id);
  await editor.getByLabel("Valor (COP)").fill("10.000");
  await editor.getByRole("button", { name: "Registrar movimiento", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page.getByRole("link", { name: "Movimientos", exact: true }).click();
  await page.locator(".register-more > summary").click();
  await page.locator(".register-more").getByRole("button", { name: "Importar archivo" }).click();
  const importDialog = page.getByRole("dialog", { name: "Importar movimientos" });
  await importDialog.getByLabel("Archivo CSV o Excel").setInputFiles({ name: "investment.csv", mimeType: "text/csv", buffer: Buffer.from("Fecha;Descripcion;Valor;Moneda;Tipo\n2026-10-18;FONDO SINTÉTICO;25.000,00;COP;gasto") });
  await importDialog.getByRole("button", { name: "Subir y previsualizar" }).click();
  const row = importDialog.locator("tbody tr").first();
  await expect(row).toContainText("Inversión: Plan a largo plazo");
  await expect(row).toContainText("Transferencia enviada");
  await importDialog.screenshot({ path: testInfo.outputPath("investment-csv-preview.png") });
  await importDialog.getByRole("button", { name: "Confirmar 1 movimientos" }).click();
  await expect(importDialog.getByText("Completado", { exact: true }).first()).toBeVisible();
  state = await (await request.get(`${apiBase}/state`)).json();
  expect(state.accounts.filter((account: { kind: string }) => account.kind === "investment")).toHaveLength(2);
  expect(state.transactions).toHaveLength(3);
  const summary = await (await request.get(`${apiBase}/dashboard`)).json();
  expect(summary).toMatchObject({ availableMinor: "111500000", investmentsMinor: "8500000", spendingMinor: "0", incomeMinor: "0", balances: { cash: "15000000", bank: "96500000" } });
});

test('reclassifying a merchant as an investment applies its destination to historical expenses and sums contributions', async ({ page, request }) => {
  await request.post(`${apiBase}/accounts`, { data: { id: 'bank', name: 'Banco de prueba', kind: 'bank', openingMinor: '100000000', openingDate: '2026-01-01' } });
  for (const [id, date, amountMinor] of [['latest', '2026-10-18', '10000000'], ['historical', '2025-12-01', '20000000']]) {
    expect((await request.post(`${apiBase}/transactions`, { data: { id, date, amountMinor, accountId: 'bank', kind: 'expense', merchant: 'FONDO HISTÓRICO' } })).ok()).toBe(true);
  }
  await page.goto('./#/movimientos');
  await page.getByRole('button', { name: 'FONDO HISTÓRICO', exact: true }).first().click();
  let editor = page.getByRole('dialog', { name: 'Editar movimiento', exact: true });
  await editor.getByLabel('Categoría de gasto').selectOption('__investment__');
  await editor.getByLabel('Nombre del nuevo producto de inversión').fill('Ahorro a largo plazo');
  await editor.getByLabel('Recordar este comercio, su categoría y producto de inversión para próximas importaciones').check();
  await editor.getByLabel('Aplicar esta categoría y nota a todos los movimientos de este comercio').check();
  await editor.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(editor).not.toBeVisible();
  let state = await (await request.get(`${apiBase}/state`)).json();
  const investment = state.accounts.find((a: { kind: string }) => a.kind === 'investment');
  expect(state.transactions.every((t: { kind: string; counterAccountId: string }) => t.kind === 'transfer' && t.counterAccountId === investment.id)).toBe(true);
  expect(await (await request.get(`${apiBase}/dashboard`)).json()).toMatchObject({ investmentsMinor: '30000000', spendingMinor: '0', balances: { bank: '90000000' } });
  // A later historical entry must reuse the product and increase it only once.
  await page.getByRole('button', { name: 'Nuevo movimiento', exact: true }).click();
  editor = page.getByRole('dialog', { name: 'Nuevo movimiento', exact: true });
  await editor.getByLabel('Categoría de gasto').selectOption('__investment__');
  await editor.getByRole('combobox', { name: 'Cuenta de origen', exact: true }).selectOption('bank');
  await editor.getByLabel('Comercio o descripción').fill('FONDO HISTÓRICO');
  await expect(editor.getByRole('combobox', { name: 'Producto de inversión', exact: true })).toHaveValue(investment.id);
  await editor.getByLabel('Fecha', { exact: true }).fill('2025-11-01');
  await editor.getByLabel('Valor (COP)').fill('50.000');
  await editor.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
  await expect(editor).not.toBeVisible();
  state = await (await request.get(`${apiBase}/state`)).json();
  expect(state.accounts.filter((a: { kind: string }) => a.kind === 'investment')).toHaveLength(1);
  expect(state.transactions).toHaveLength(3);
  expect(await (await request.get(`${apiBase}/dashboard`)).json()).toMatchObject({ investmentsMinor: '35000000', spendingMinor: '0', balances: { bank: '90000000' } });
});
