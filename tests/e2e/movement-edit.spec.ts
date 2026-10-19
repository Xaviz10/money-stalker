import { expect, test } from "@playwright/test";

const apiBase = `http://127.0.0.1:${process.env.E2E_API_PORT ?? "8787"}/api`;

test.beforeEach(async ({ request }) => {
  await request.post(`${apiBase}/test/reset`);
});

test("movement category and note persist, including all movements from the same merchant", async ({
  page,
  request,
}) => {
  await request.post(`${apiBase}/accounts`, {
    data: {
      id: "bank",
      name: "Ahorros",
      kind: "bank",
      openingMinor: "100000000",
      openingDate: "2026-01-01",
      eligible: true,
    },
  });
  for (let index = 0; index < 3; index++) {
    await request.post(`${apiBase}/transactions`, {
      data: {
        id: `toll-${index}`,
        accountId: "bank",
        date: `2026-10-${10 + index}`,
        amountMinor: "1500000",
        kind: "expense",
        merchant: index === 1 ? " PEaje Central " : "Peaje Central",
      },
    });
  }
  await request.post(`${apiBase}/transactions`, {
    data: {
      id: "payroll",
      accountId: "bank",
      date: "2026-10-15",
      amountMinor: "500000000",
      kind: "income",
      merchant: "Empresa de prueba",
    },
  });

  await page.goto("./#/movimientos");
  await page
    .getByRole("button", { name: "Empresa de prueba", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.locator('select[name="categoryId"]').selectOption("salary");
  await dialog.locator('textarea[name="note"]').fill("Nómina de octubre");
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("status")).toContainText("Movimiento guardado");

  await page
    .getByRole("button", { name: "Peaje Central", exact: true })
    .first()
    .click();
  dialog = page.getByRole("dialog");
  await dialog.locator('select[name="categoryId"]').selectOption("car");
  await dialog.locator('textarea[name="note"]').fill("Ruta al trabajo");
  await dialog
    .getByLabel(
      "Aplicar esta categoría y nota a todos los movimientos de este comercio",
    )
    .check();
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Categoría y nota guardadas en 3 movimientos",
  );

  await page.getByRole("link", { name: "Resumen", exact: true }).click();
  await page.getByRole("link", { name: "Movimientos", exact: true }).click();
  await page.reload();

  const ledger = page.getByRole("table", {
    name: "Movimientos del producto seleccionado",
  });
  const tolls = ledger
    .locator("tbody tr")
    .filter({ hasText: /Peaje Central/i });
  await expect(tolls).toHaveCount(3);
  for (let index = 0; index < 3; index++) {
    await expect(tolls.nth(index)).toContainText("Carro");
    await expect(tolls.nth(index)).toContainText("Ruta al trabajo");
  }
  const payroll = ledger
    .locator("tbody tr")
    .filter({ hasText: "Empresa de prueba" });
  await expect(payroll).toContainText("Salario");
  await expect(payroll).toContainText("Nómina de octubre");

  const state = await (await request.get(`${apiBase}/state`)).json();
  expect(
    state.transactions
      .filter((transaction: { id: string }) =>
        transaction.id.startsWith("toll-"),
      )
      .every(
        (transaction: { categoryId: string; note: string }) =>
          transaction.categoryId === "car" &&
          transaction.note === "Ruta al trabajo",
      ),
  ).toBe(true);
  expect(
    state.transactions.find(
      (transaction: { id: string }) => transaction.id === "payroll",
    ),
  ).toMatchObject({ categoryId: "salary", note: "Nómina de octubre" });
});
