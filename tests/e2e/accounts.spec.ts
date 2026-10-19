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
  await create.locator("summary").click();
  await create.getByLabel("Tipo de cuenta").selectOption("bank");
  await create
    .getByLabel("Nombre de la cuenta", { exact: true })
    .fill("Ahorros");
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
  if (isMobile)
    await page.getByRole("button", { name: "Mis cuentas y tarjetas" }).click();
  await page
    .locator(".rail-account")
    .filter({ hasText: "Nu independiente" })
    .click();
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
