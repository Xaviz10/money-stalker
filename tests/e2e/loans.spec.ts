import { test, expect } from "@playwright/test";
import * as XLSX from "xlsx";
const apiBase = `http://127.0.0.1:${process.env.E2E_API_PORT ?? "8787"}/api`;
test.beforeEach(async ({ request }) => {
  await request.post(`${apiBase}/test/reset`);
  await request.post(`${apiBase}/accounts`, {
    data: {
      id: "bank",
      name: "Ahorros de prueba",
      kind: "bank",
      openingMinor: "2000000000",
      openingDate: "2026-01-01",
    },
  });
});
async function seed(request: import("@playwright/test").APIRequestContext) {
  await request.post(`${apiBase}/accounts`, {
    data: {
      id: "loan",
      name: "Hipoteca de prueba",
      kind: "loan",
      openingMinor: "0",
      openingDate: "2026-01-01",
    },
  });
  const response = await request.post(`${apiBase}/loans/terms`, {
    data: {
      id: "loan",
      denomination: "COP",
      principal: "10000000",
      balanceDate: "2026-10-01",
      ratePercent: "12",
      remainingMonths: 120,
      nextPaymentDate: "2026-11-01",
      insuranceMinor: "500000",
      feesMinor: "0",
    },
  });
  expect(response.ok()).toBe(true);
}
test("creates a mortgage, compares strategies, saves a scenario and corrects debt without cash", async ({
  page,
  request,
}, testInfo) => {
  await page.goto("./#/creditos");
  await page.getByText("Agregar crédito hipotecario", { exact: true }).click();
  await page
    .getByLabel("Nombre del crédito", { exact: true })
    .fill("Vivienda de prueba");
  await page
    .getByRole("button", { name: "Crear crédito", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Vivienda de prueba" }),
  ).toBeVisible();
  await expect(page.locator(".rail-worth")).toContainText("Disponible total");
  await expect(page.locator(".rail-worth > strong")).toHaveText("$ 20.000.000");
  await page
    .getByLabel("Capital inicial confirmado (COP)", { exact: true })
    .fill("10000000");
  await page.getByLabel("Fecha del capital confirmado").fill("2026-10-01");
  await page.getByLabel("Tasa de interés contratada (%)").fill("12");
  await page.getByLabel("Cuotas restantes", { exact: true }).fill("120");
  await page
    .getByLabel("Próximo vencimiento", { exact: true })
    .fill("2026-11-01");
  await page.getByLabel("Seguros mensuales confirmados (COP)").fill("5.000");
  await page.getByLabel("Otros cargos mensuales (COP)").fill("0");
  await page.getByRole("button", { name: "Guardar datos del crédito" }).click();
  await expect(page.locator(".loan-current-balance")).toContainText(
    "$ 10.000.000",
  );
  await page.getByRole("button", { name: "Simulador", exact: true }).click();
  await page
    .getByLabel("Nombre del escenario", { exact: true })
    .fill("Abono de prueba");
  await page.getByLabel("Fecha de inicio del análisis").fill("2026-10-01");
  await page.getByLabel("Abono único (COP)").fill("1.000.000");
  await page.getByLabel("Fecha del abono único").fill("2026-11-01");
  await page
    .getByRole("button", { name: "Simular abono", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Resultado de la simulación" }),
  ).toBeVisible();
  await expect(page.locator(".loan-comparison")).toContainText("Reducir plazo");
  await page
    .getByRole("button", { name: "Guardar escenario", exact: true })
    .click();
  await expect(page.getByLabel("Escenario guardado")).toContainText(
    "Abono de prueba",
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("loan-simulator.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Resumen", exact: true }).click();
  await page.getByText("Ajustar saldo según extracto", { exact: true }).click();
  await page
    .getByLabel("Capital confirmado (COP)", { exact: true })
    .fill("9800000");
  await page.getByLabel("Fecha efectiva del ajuste").fill("2026-10-20");
  await page
    .getByLabel("Motivo del ajuste")
    .fill("Conciliación manual sintética");
  await page.getByRole("button", { name: "Confirmar ajuste de deuda" }).click();
  await expect(page.locator(".loan-current-balance")).toContainText(
    "$ 9.800.000",
  );
  let d = await (await request.get(`${apiBase}/dashboard`)).json();
  expect(d.balances.bank).toBe("2000000000");
  expect(d.spendingMinor).toBe("0");
  await page
    .getByRole("button", { name: "Deshacer ajuste", exact: true })
    .click();
  await expect(page.locator(".loan-current-balance")).toContainText(
    "$ 10.000.000",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("one split payment affects principal and expense reports and survives movement editing", async ({
  page,
  request,
}) => {
  await seed(request);
  await page.goto("./#/resumen");
  await page
    .getByRole("button", { name: "Nuevo movimiento", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Nuevo movimiento",
    exact: true,
  });
  await dialog.getByLabel("Categoría de gasto").selectOption("loans");
  await expect(dialog.getByRole("combobox", { name: "Subcategoría", exact: true })).toHaveValue("loans-housing");
  await dialog.getByRole("combobox", { name: "Crédito destino", exact: true }).selectOption("loan");
  await dialog
    .getByRole("combobox", { name: "Cuenta de origen", exact: true })
    .selectOption("bank");
  await dialog.getByLabel("Fecha", { exact: true }).fill("2026-10-20");
  await dialog.getByLabel("Valor (COP)", { exact: true }).fill("110.000");
  await dialog.getByLabel("Comercio o descripción").fill("Pago vivienda");
  await dialog.getByLabel("Tipo de pago al crédito").selectOption("ordinary");
  await dialog
    .getByLabel("Conozco el desglose confirmado por el banco")
    .check();
  await dialog
    .getByLabel("Capital del pago (COP)", { exact: true })
    .fill("100.000");
  await dialog
    .getByLabel("Intereses del pago (COP)", { exact: true })
    .fill("9.000");
  await dialog
    .getByLabel("Seguros del pago (COP)", { exact: true })
    .fill("1.000");
  await dialog
    .getByRole("button", { name: "Registrar movimiento", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  let d = await (await request.get(`${apiBase}/dashboard`)).json();
  expect(d.spendingMinor).toBe("1000000");
  expect(d.balances.loan).toBe("990000000");
  expect(d.balances.bank).toBe("1989000000");
  await page.getByRole("link", { name: "Créditos", exact: true }).click();
  await page.getByRole("button", { name: "Movimientos", exact: true }).click();
  await expect(page.locator(".loan-table-scroll")).toContainText(
    "Cuota ordinaria",
  );
  await page.getByRole("button", { name: "Editar pago", exact: true }).click();
  const editor = page.getByRole("dialog");
  await expect(editor.getByLabel("Categoría de gasto")).toHaveValue("loans");
  await expect(editor.getByRole("combobox", { name: "Subcategoría", exact: true })).toHaveValue("loans-housing");
  await expect(editor.getByRole("combobox", { name: "Crédito destino", exact: true })).toHaveValue("loan");
  await editor.getByLabel("Tipo de pago al crédito").selectOption("term");
  await editor
    .getByRole("button", { name: "Guardar cambios", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  await page.getByRole("link", { name: "Reportes", exact: true }).click();
  await expect(page.locator(".report-primary-stat")).toContainText("$ 10.000");
});
test("previews and confirms a mortgage XLSX without generating another bank payment", async ({
  page,
  request,
}, testInfo) => {
  await seed(request);
  const w = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    w,
    XLSX.utils.aoa_to_sheet([
      ["Estado de Crédito Hipotecario"],
      ["en: PESOS"],
      [
        "Fecha De Pago",
        "Fecha En Que Se Generó El Extracto",
        "Valor A Pagar",
        "Saldo A La Fecha En Que Se Generó El Extracto",
      ],
      ["2026/11/01", "2026/10/01", "110000", "10000000"],
      ["Saldo de capital:", "10000000"],
      [
        "Fecha aplicación",
        "Descripción",
        "Capital",
        "Intereses Corriente",
        "Intereses Mora",
        "Seguros Vida",
        "Seguros Incendio",
        "Seguros Terremoto",
        "Otros Cargos",
        "Total",
      ],
      [
        "2026/09/20",
        "Pago Cuota",
        "100000",
        "9000",
        "0",
        "1000",
        "0",
        "0",
        "0",
        "110000",
      ],
    ]),
    "Extracto",
  );
  const buffer = XLSX.write(w, { type: "buffer", bookType: "xlsx" });
  await page.goto("./#/movimientos");
  const accountSelector = page.locator(
    'button[aria-controls="accounts-panel"]',
  );
  if ((page.viewportSize()?.width ?? 1280) <= 850)
    await accountSelector.click();
  await page
    .getByRole("button", {
      name: "Hipoteca de prueba · Crédito hipotecario",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Importar archivo", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Documentos", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByLabel("Extractos hipotecarios XLSX").setInputFiles({
    name: "synthetic-mortgage.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await page
    .getByRole("button", { name: "Preparar documentos", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Vista previa hipotecaria" }),
  ).toContainText("Pago Cuota");
  await page
    .getByRole("button", { name: "Confirmar documento", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Vista previa hipotecaria" }),
  ).toContainText("Documento confirmado");
  const s = await (await request.get(`${apiBase}/state`)).json();
  expect(s.transactions).toHaveLength(0);
  expect(s.loanDocuments[0].status).toBe("confirmed");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("loan-documents.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("editing a merchant assigns a mortgage through category and subcategory with historical preview and a remembered import", async ({ page, request }, testInfo) => {
  await seed(request);
  for (const [id, date, amountMinor] of [["latest", "2026-10-18", "11000000"], ["history", "2026-10-17", "12000000"], ["omitted", "2026-10-16", "13000000"]])
    expect((await request.post(`${apiBase}/transactions`, { data: { id, date, amountMinor, accountId: "bank", kind: "expense", merchant: "PAGO VIVIENDA" } })).ok()).toBe(true);
  const before = await (await request.get(`${apiBase}/dashboard`)).json();
  await page.goto("./#/movimientos");
  await expect(page.locator(".rail-worth")).toContainText("Disponible total");
  await expect(page.locator(".rail-worth > strong")).toHaveText("$ 19.640.000");
  await expect(page.locator(".rail-worth")).not.toContainText("Patrimonio");
  await page.getByRole("button", { name: "PAGO VIVIENDA", exact: true }).first().click();
  let editor = page.getByRole("dialog", { name: "Editar movimiento", exact: true });
  await editor.getByLabel("Categoría de gasto").selectOption("loans");
  await expect(editor.getByLabel("Categoría de gasto")).toHaveValue("loans");
  await expect(editor.getByRole("combobox", { name: "Subcategoría", exact: true })).toHaveValue("loans-housing");
  await editor.getByRole("combobox", { name: "Subcategoría", exact: true }).selectOption("loans-car");
  await expect(editor.getByRole("combobox", { name: "Crédito destino", exact: true })).toHaveCount(0);
  await editor.getByRole("combobox", { name: "Subcategoría", exact: true }).selectOption("loans-housing");
  await editor.getByRole("combobox", { name: "Crédito destino", exact: true }).selectOption("loan");
  await expect(editor.getByLabel("Tipo de pago al crédito")).toHaveValue("unconfirmed");
  await editor.getByLabel("Recordar este comercio y el crédito para próximas importaciones (sin asumir tipo ni desglose)").check();
  await editor.getByLabel("Aplicar este crédito, categoría y nota a movimientos del mismo comercio").check();
  await expect(editor.locator(".loan-merchant-preview")).toContainText("2026-10-17");
  await editor.locator(".loan-candidates label").filter({ hasText: "2026-10-16" }).getByRole("checkbox").uncheck();
  await editor.screenshot({ path: testInfo.outputPath("loan-merchant-editor.png") });
  await editor.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(editor).not.toBeVisible();
  let state = await (await request.get(`${apiBase}/state`)).json();
  expect(state.transactions.find((t: { id: string }) => t.id === "latest")).toMatchObject({ kind: "loan_payment", counterAccountId: "loan", categoryId: "loans-housing", loanPayment: { purpose: "unconfirmed" } });
  expect(state.transactions.find((t: { id: string }) => t.id === "history")).toMatchObject({ kind: "loan_payment", counterAccountId: "loan", loanPayment: { purpose: "unconfirmed" } });
  expect(state.transactions.find((t: { id: string }) => t.id === "omitted")).toMatchObject({ kind: "expense" });
  expect((await (await request.get(`${apiBase}/dashboard`)).json()).balances).toEqual(before.balances);
  await page.getByRole("button", { name: "PAGO VIVIENDA", exact: true }).first().click();
  editor = page.getByRole("dialog", { name: "Editar movimiento", exact: true });
  await expect(editor.getByRole("combobox", { name: "Subcategoría", exact: true })).toHaveValue("loans-housing");
  await expect(editor.getByRole("combobox", { name: "Crédito destino", exact: true })).toHaveValue("loan");
  await editor.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.getByRole("button", { name: "Nuevo movimiento", exact: true }).click();
  editor = page.getByRole("dialog", { name: "Nuevo movimiento", exact: true });
  await editor.getByLabel("Categoría de gasto").selectOption("loans");
  await editor.getByLabel("Comercio o descripción").fill("PAGO VIVIENDA");
  await expect(editor.getByRole("combobox", { name: "Crédito destino", exact: true })).toHaveValue("loan");
  await editor.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.locator(".register-more > summary").click();
  await page.locator(".register-more").getByRole("button", { name: "Importar archivo" }).click();
  const importDialog = page.getByRole("dialog", { name: "Importar movimientos" });
  await importDialog.getByLabel("Archivo CSV o Excel").setInputFiles({ name: "loan-payments.csv", mimeType: "text/csv", buffer: Buffer.from("Fecha;Descripcion;Valor;Moneda;Tipo\n2026-10-19;PAGO VIVIENDA;115.000,00;COP;gasto") });
  await importDialog.getByRole("button", { name: "Subir y previsualizar" }).click();
  await expect(importDialog.locator("tbody tr").first()).toContainText("Crédito: Hipoteca de prueba");
  await expect(importDialog.locator("tbody tr").first()).toContainText("Tipo y desglose pendientes de confirmar");
  await importDialog.getByRole("button", { name: "Confirmar 1 movimientos" }).click();
  await expect(importDialog.getByText("Completado", { exact: true }).first()).toBeVisible();
  state = await (await request.get(`${apiBase}/state`)).json();
  expect(state.transactions.find((t: { date: string }) => t.date === "2026-10-19")).toMatchObject({ kind: "loan_payment", counterAccountId: "loan", categoryId: "loans-housing", loanPayment: { purpose: "unconfirmed" } });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
