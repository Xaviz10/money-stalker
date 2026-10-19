import { expect, test } from "@playwright/test";
const apiBase = `http://127.0.0.1:${process.env.E2E_API_PORT ?? "8787"}/api`;
test.beforeEach(async ({ request }) => {
  await request.post(`${apiBase}/test/reset`);
});
test("account → capture → import → review → export works on the project path", async ({
  page,
  request,
  isMobile,
}) => {
  await page.goto("./#/cuentas");
  const create = page.locator(".settings-section").filter({
    has: page.getByText("Agregar producto", { exact: true }),
  });
  await page
    .getByLabel("Nombre de la cuenta", { exact: true })
    .fill("Ahorros de prueba");
  await page.getByLabel("Saldo inicial (COP)").fill("1.000.000");
  await page.getByLabel("Fecha del saldo inicial").fill("2026-01-01");
  await create.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.locator(".account-row")).toContainText("Ahorros de prueba");
  const state = await (await request.get(`${apiBase}/state`)).json();
  expect(
    (
      await request.post(`${apiBase}/accounts`, {
        data: {
          id: "empty-wallet",
          name: "Bolsillo sin movimientos",
          kind: "cash",
          openingMinor: "0",
          openingDate: "2026-01-01",
          eligible: true,
        },
      })
    ).ok(),
  ).toBe(true);
  const device = await (
    await request.post(`${apiBase}/devices`, {
      data: { name: "Synthetic phone" },
    })
  ).json();
  const capture = await request.post(`${apiBase}/capture-events`, {
    headers: { Authorization: `Bearer ${device.token}` },
    data: {
      eventId: "purchase",
      source: "wallet",
      observedAt: "2026-10-05T18:00:00Z",
      date: "2026-10-05",
      accountId: state.accounts[0].id,
      amountMinor: "1250000",
      merchant: "Café de ejemplo",
      location: {
        latitude: 4.60971,
        longitude: -74.08175,
        accuracy: 24,
        observedAt: "2026-10-05T18:00:02Z",
      },
    },
  });
  expect(capture.status()).toBe(202);
  await expect
    .poll(
      async () =>
        (await (await request.get(`${apiBase}/state`)).json()).transactions
          .length,
    )
    .toBe(1);
  await page.getByRole("link", { name: "Movimientos", exact: true }).click();
  await page.getByRole("button", { name: "Importar archivo" }).first().click();
  const importDialog = page.getByRole("dialog");
  await expect(importDialog).toContainText(
    "El archivo se agregará a Ahorros de prueba",
  );
  await page.getByLabel("Archivo CSV o Excel").setInputFiles({
    name: "sample.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Fecha;Descripcion;Valor;Moneda;Tipo\n2026-10-05;Café de ejemplo;12.500,00;COP;gasto",
    ),
  });
  await page.getByRole("button", { name: "Subir y previsualizar" }).click();
  const preview = importDialog.getByRole("table");
  await expect(
    preview.getByRole("columnheader", { name: "Tipo" }),
  ).toBeVisible();
  await expect(preview.getByText("Gasto", { exact: true })).toBeVisible();
  await expect(preview.locator("tbody tr").first()).toContainText(
    "−$ 12.500",
  );
  await page
    .getByRole("button", { name: "Confirmar 1 filas aceptadas" })
    .click();
  await expect(
    page.getByText("Completado", { exact: true }).first(),
  ).toBeVisible();
  await importDialog.getByRole("button", { name: "Cerrar" }).click();
  await page.getByRole("link", { name: /Revisar/ }).click();
  await page.getByRole("button", { name: /Unir con Café de ejemplo/ }).click();
  await expect(
    page.getByRole("heading", { name: "Todo en su lugar" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Resumen", exact: true }).click();
  await expect(page.locator(".available-total > strong")).toHaveText(
    "$ 987.500",
  );
  await page.reload();
  await expect(page.locator(".available-total > strong")).toHaveText(
    "$ 987.500",
  );
  await page.getByRole("link", { name: "Movimientos", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Ahorros de prueba", exact: true }),
  ).toBeVisible();
  const ledger = page.getByRole("table", {
    name: "Movimientos del producto seleccionado",
  });
  await expect(ledger.locator("tbody tr")).toHaveCount(1);
  await expect(ledger.getByText("Gasto", { exact: true })).toBeVisible();
  if (isMobile)
    await page.getByRole("button", { name: /Ahorros de prueba/ }).click();
  await page
    .locator(".rail-account")
    .filter({ hasText: "Bolsillo sin movimientos" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Bolsillo sin movimientos",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    ledger.getByRole("columnheader", { name: "Movimiento" }),
  ).toBeVisible();
  await expect(
    ledger.getByRole("columnheader", { name: "Valor" }),
  ).toBeVisible();
  await expect(ledger).toContainText(
    "Este producto todavía no tiene movimientos",
  );
  await expect(
    ledger.getByRole("button", { name: "Agregar movimiento" }),
  ).toBeVisible();
  if (isMobile)
    await page
      .getByRole("button", { name: /Bolsillo sin movimientos/ })
      .click();
  await page
    .locator(".rail-account")
    .filter({ hasText: "Ahorros de prueba" })
    .click();
  await page
    .getByRole("button", { name: "Café de ejemplo", exact: true })
    .click();
  await expect(page.getByText("Ubicación guardada por el atajo")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Abrir en Mapas" }),
  ).toHaveAttribute("href", "https://maps.apple.com/?ll=4.60971,-74.08175");
  await page.getByRole("button", { name: "Cerrar" }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV", exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe("money-stalker.csv");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
