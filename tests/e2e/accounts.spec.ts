import { expect, test } from "@playwright/test";
const apiBase = `http://127.0.0.1:${process.env.E2E_API_PORT ?? "8787"}/api`;
test.beforeEach(async ({ request }) => {
  expect((await request.post(`${apiBase}/test/reset`)).status()).toBe(204);
});
test("credit-only setup, bank/debit grouping, account filtering and unlinking preserve financial totals", async ({
  page,
  request,
  isMobile,
}) => {
  await page.goto("./#/cuentas");
  const create = page.locator(".settings-section").filter({
    has: page.getByText("Agregar producto", { exact: true }),
  });
  await create.getByLabel("Tipo de cuenta").selectOption("credit");
  await create
    .getByLabel("Nombre de la cuenta", { exact: true })
    .fill("Nu independiente");
  await create.getByLabel("Deuda inicial (COP)").fill("100.000");
  await create.getByLabel("Fecha del saldo inicial").fill("2026-01-01");
  await create.getByLabel("Día de corte").fill("18");
  await create.getByLabel("Día de pago").fill("5");
  await expect(
    create.getByLabel("Cuenta bancaria vinculada (opcional)"),
  ).toHaveValue("");
  await create.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.locator(".standalone-cards")).toContainText(
    "Nu independiente",
  );
  await create.locator(":scope > summary").click();
  await create.getByLabel("Tipo de cuenta").selectOption("bank");
  await create
    .getByLabel("Nombre de la cuenta", { exact: true })
    .fill("Ahorros");
  await create.getByText("Más opciones · banco, imagen y organización", { exact: true }).click();
  await create.getByLabel("Banco o entidad (opcional)").fill("Bancolombia");
  await create.getByLabel("Saldo inicial (COP)").fill("1.000.000");
  await create.getByLabel("Fecha del saldo inicial").fill("2026-01-01");
  await create.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.locator(".institution-group")).toContainText("Bancolombia");
  let state = await (await request.get(`${apiBase}/state`)).json();
  const bank = state.accounts.find((a: any) => a.kind === "bank"),
    credit = state.accounts.find((a: any) => a.kind === "credit");
  const instrument = page.locator(".settings-section").filter({
    has: page.getByText("Configurar capturas automáticas", { exact: true }),
  });
  await instrument.locator(":scope > summary").click();
  await instrument.getByText("Agregar una tarjeta o alias después", { exact: false }).click();
  await instrument.getByLabel("Nombre de tarjeta").fill("Visa débito");
  await instrument.getByLabel("Cuenta asociada").selectOption(bank.id);
  await instrument.getByLabel("Alias separados por comas").fill("1234");
  await instrument
    .getByRole("button", { name: "Guardar", exact: true })
    .click();
  await expect(page.locator(".rail-instrument")).toContainText("Visa débito");
  const bankProduct = page
    .locator(".account-row")
    .filter({ has: page.getByText("Ahorros", { exact: true }) });
  await bankProduct
    .getByText("Editar producto", { exact: true })
    .click();
  const savedInstrument = bankProduct
    .locator(".product-instrument")
    .filter({ has: page.getByText("Visa débito", { exact: true }) });
  await savedInstrument.getByText("Editar tarjeta", { exact: true }).click();
  await savedInstrument.getByLabel("Nombre de tarjeta").fill("Visa crédito");
  await savedInstrument.getByLabel("Cuenta asociada").selectOption(credit.id);
  await savedInstrument
    .getByLabel("Alias separados por comas")
    .fill("8645, wallet-visa-8645");
  await savedInstrument
    .getByRole("button", { name: "Guardar cambios", exact: true })
    .click();
  const creditProduct = page
    .locator(".account-row")
    .filter({ has: page.getByText("Nu independiente", { exact: true }) });
  await creditProduct
    .getByText("Editar producto", { exact: true })
    .click();
  await expect(
    creditProduct.locator(".product-instrument").filter({ hasText: "Visa crédito" }),
  ).toContainText("8645, wallet-visa-8645");
  const organization = page
    .locator(".account-row")
    .filter({ has: page.getByText("Nu independiente", { exact: true }) })
    .locator(".account-organization");
  const parentAccount = organization.getByLabel(
    "Vincular con cuenta bancaria",
  );
  if (!(await parentAccount.isVisible()))
    await organization.locator(":scope > summary").click();
  await parentAccount.selectOption(bank.id);
  await organization.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.locator(".bank-family")).toContainText("Nu independiente");
  await expect(page.locator(".standalone-cards")).toHaveCount(0);
  for (const t of [
    {
      id: "bank-expense",
      accountId: bank.id,
      merchant: "Mercado del banco",
      amountMinor: "1000000",
    },
    {
      id: "credit-expense",
      accountId: credit.id,
      merchant: "Café con crédito",
      amountMinor: "500000",
    },
  ])
    expect(
      (
        await request.post(`${apiBase}/transactions`, {
          data: {
            ...t,
            kind: "expense",
            categoryId: "food",
            date: "2026-10-05",
          },
        })
      ).ok(),
    ).toBe(true);
  await page.getByRole("link", { name: "Resumen", exact: true }).click();
  await page.getByRole("button", { name: "Actualizar datos" }).click();
  await expect(page.locator(".available-total > strong")).toHaveText(
    "$ 885.000",
  );
  // Product text changes with selection; the disclosure relationship is stable.
  const accountToggle = page.locator('button[aria-controls="accounts-panel"]');
  if (isMobile) {
    await expect(accountToggle).toContainText("Todas las cuentas");
    await accountToggle.click();
    await expect(accountToggle).toHaveAttribute("aria-expanded", "true");
  }
  await page
    .locator(".rail-account")
    .filter({ hasText: "Nu independiente" })
    .click();
  if (isMobile) {
    await expect(accountToggle).toContainText("Nu independiente");
    await expect(accountToggle).toHaveAttribute("aria-expanded", "false");
  }
  await expect(page.locator(".activity-scope")).toContainText(
    "Nu independiente",
  );
  await expect(page.locator(".activity-ledger")).toContainText(
    "Café con crédito",
  );
  await expect(page.locator(".activity-ledger")).not.toContainText(
    "Mercado del banco",
  );
  await expect(page.locator(".available-total > strong")).toHaveText(
    "$ 885.000",
  );
  const d = await (await request.get(`${apiBase}/dashboard`)).json();
  expect(d.liquidMinor).toBe("99000000");
  expect(d.cardDebtMinor).toBe("10500000");
  await page.getByRole("link", { name: "Cuentas", exact: true }).click();
  const unlinkParent = organization.getByLabel(
    "Vincular con cuenta bancaria",
  );
  if (!(await unlinkParent.isVisible()))
    await organization.locator(":scope > summary").click();
  await unlinkParent.selectOption("");
  await organization.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.locator(".standalone-cards")).toContainText(
    "Nu independiente",
  );
  state = await (await request.get(`${apiBase}/state`)).json();
  expect(
    state.accounts.find((a: any) => a.id === credit.id).parentAccountId,
  ).toBeUndefined();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("capture setup keeps the new access visible and verifies an actual arrival", async ({ page, request }, testInfo) => {
  await request.post(`${apiBase}/accounts`, { data: {
    id: "capture-bank", name: "Cuenta de captura", kind: "bank",
    openingMinor: "0", openingDate: "2026-01-01", eligible: true,
  } });
  await request.post(`${apiBase}/instruments`, { data: {
    id: "capture-card", name: "Débito de prueba", accountId: "capture-bank", aliases: ["1122"],
  } });
  await page.goto("./#/cuentas");
  const setup = page.locator(".settings-section").filter({ has: page.getByText("Configurar capturas automáticas", { exact: true }) });
  await setup.locator(":scope > summary").click();
  await setup.getByLabel("Nombre del dispositivo").fill("iPhone de prueba");
  await setup.getByRole("button", { name: "Crear acceso para mi iPhone" }).click();
  await expect(setup.getByText("Copia este acceso ahora; no volverá a mostrarse.")).toBeVisible();
  // Read the ephemeral test token locally; never include it in screenshots.
  const token = await setup.locator("code.token").first().textContent();
  await setup.getByRole("button", { name: "Ya lo guardé" }).click();
  await setup.locator(".capture-step").filter({ has: page.getByText("3. Conecta el Atajo") }).locator(":scope > summary").click();
  const arrival = setup.locator(".capture-step").filter({ has: page.getByText("4. Verifica la primera evidencia") });
  await arrival.locator(":scope > summary").click();
  await expect(arrival).toContainText("Aún no hay evidencias de SMS o Wallet recibidas.");
  await request.post(`${apiBase}/capture-events`, { headers: { Authorization: `Bearer ${token}` }, data: {
    eventId: "setup-arrival", source: "wallet", accountId: "capture-bank", amountMinor: "2200000",
    merchant: "Comercio de prueba", date: "2026-10-17", observedAt: "2026-10-17T18:00:00Z",
  } });
  await expect.poll(async () => (await (await request.get(`${apiBase}/state`)).json()).observations.length).toBe(1);
  await arrival.getByRole("button", { name: "Comprobar llegada" }).click();
  await expect(arrival).toContainText("Última evidencia recibida · Wallet");
  await expect(arrival).toContainText("Comercio de prueba · $ 22.000");
  await expect(setup.locator("code.token")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("capture-setup.png"), fullPage: true });
});

test("product setup includes SMS aliases and optional debit, with another card added later", async ({ page, request }, info) => {
  await page.goto("./#/cuentas");
  const create = page.locator(".settings-section").filter({ has: page.getByText("Agregar producto", { exact: true }) });
  await create.getByLabel("Nombre de la cuenta", { exact: true }).fill("Ahorros iniciales");
  await create.getByLabel("Saldo inicial (COP)").fill("1.000.000");
  await create.getByLabel("Fecha del saldo inicial").fill("2026-01-01");
  await create.getByLabel("Alias del producto en SMS (opcional)").fill("3344");
  await create.getByLabel("Agregar tarjeta débito ahora").check();
  await create.getByLabel("Alias de la tarjeta débito en SMS", { exact: true }).fill("5566");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("initial-product-sms.png"), fullPage: true });
  await create.getByRole("button", { name: "Guardar", exact: true }).click();
  const row = page.locator(".account-row").filter({ has: page.getByText("Ahorros iniciales", { exact: true }) });
  await expect(row).toContainText("Identificación SMS configurada");
  let state = await (await request.get(`${apiBase}/state`)).json();
  expect(state.accounts).toHaveLength(1);
  expect(state.accounts[0].captureAliases).toEqual(["3344"]);
  expect(state.instruments).toHaveLength(1);
  expect(state.instruments[0]).toMatchObject({ name: "Débito · Ahorros iniciales", accountId: state.accounts[0].id, aliases: ["5566"] });
  await row.getByText("Editar producto", { exact: true }).click();
  await expect(row.getByLabel("Alias del producto en SMS (opcional)")).toHaveValue("3344");
  await row.getByText("Agregar tarjeta débito", { exact: true }).click();
  await row.getByLabel("Nombre de la tarjeta débito (opcional)").fill("Segunda débito");
  await row.getByLabel("Alias de la tarjeta débito en SMS", { exact: true }).fill("7788");
  await row.getByRole("button", { name: "Guardar tarjeta débito", exact: true }).click();
  state = await (await request.get(`${apiBase}/state`)).json();
  expect(state.accounts).toHaveLength(1);
  expect(state.instruments).toHaveLength(2);
  const device = await (await request.post(`${apiBase}/devices`, { data: { name: "iPhone sintético" } })).json();
  await request.post(`${apiBase}/capture-events`, { headers: { Authorization: `Bearer ${device.token}` }, data: { eventId: "initial-debit-capture", source: "sms", observedAt: "2026-10-20T18:00:00Z", message: "Bancolombia: Compraste $22.000,00 en COMERCIO EJEMPLO con tu T.Deb *5566, el 18/10/2026 a las 10:55." } });
  await expect.poll(async () => (await (await request.get(`${apiBase}/state`)).json()).observations.length).toBe(1);
  state = await (await request.get(`${apiBase}/state`)).json();
  expect(state.observations[0].accountId).toBe(state.accounts[0].id);
  expect(state.observations[0].amountMinor).toBe("2200000");
});
