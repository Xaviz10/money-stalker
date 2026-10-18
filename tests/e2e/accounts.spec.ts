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
  const create = page
    .getByRole("heading", { name: "Agregar cuenta", exact: true })
    .locator("..");
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
  const instrument = page
    .getByRole("heading", { name: "Tarjetas y alias de captura", exact: true })
    .locator("..");
  await instrument.getByLabel("Nombre de tarjeta").fill("Visa débito");
  await instrument.getByLabel("Cuenta asociada").selectOption(bank.id);
  await instrument.getByLabel("Alias separados por comas").fill("1234");
  await instrument
    .getByRole("button", { name: "Guardar", exact: true })
    .click();
  await expect(page.locator(".rail-instrument")).toContainText("Visa débito");
  const organization = page
    .locator(".account-row")
    .filter({ has: page.getByText("Nu independiente", { exact: true }) })
    .locator(".account-organization");
  await organization.locator("summary").click();
  await organization
    .getByLabel("Vincular con cuenta bancaria")
    .selectOption(bank.id);
  await organization
    .getByRole("button", { name: "Guardar organización" })
    .click();
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
  await organization.locator("summary").click();
  await organization
    .getByLabel("Vincular con cuenta bancaria")
    .selectOption("");
  await organization
    .getByRole("button", { name: "Guardar organización" })
    .click();
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
