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
  await dialog
    .getByRole("combobox", { name: "Tipo", exact: true })
    .selectOption("loan_payment");
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
