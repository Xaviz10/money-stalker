import { expect, test } from "@playwright/test";

const apiBase = `http://127.0.0.1:${process.env.E2E_API_PORT ?? "8787"}/api`;

test.beforeEach(async ({ request }) => {
  await request.post(`${apiBase}/test/reset`);
  await request.post(`${apiBase}/accounts`, { data: {
    id: "bank", name: "Ahorros", kind: "bank", openingMinor: "100000000", openingDate: "2026-01-01", eligible: true,
  } });
  const movements = [
    { id: "toll", date: "2026-09-15", amountMinor: "10000000", kind: "expense", merchant: "Peaje del norte", categoryId: "car-tolls" },
    { id: "restaurant", date: "2026-10-05", amountMinor: "5000000", kind: "expense", merchant: "Restaurante central", categoryId: "restaurants" },
    { id: "toll-refund", date: "2026-10-06", amountMinor: "1000000", kind: "refund", merchant: "Peaje del norte", categoryId: "car-tolls" },
    { id: "salary", date: "2026-10-07", amountMinor: "300000000", kind: "income", merchant: "Empresa", categoryId: "salary" },
  ];
  for (const movement of movements) await request.post(`${apiBase}/transactions`, { data: { ...movement, accountId: "bank" } });
});

test("reports explain spending by time, category and merchant", async ({ page }) => {
  await page.goto("./#/reportes");
  await expect(page.getByRole("heading", { name: "Entiende adónde se fue tu dinero." })).toBeVisible();
  await expect(page.locator(".report-primary-stat")).toContainText("$ 40.000");
  await expect(page.getByRole("img", { name: "Gasto neto a través del tiempo" })).toBeVisible();

  await page.getByLabel("Desde").fill("2026-09-01");
  await page.getByLabel("Hasta").fill("2026-10-19");
  await expect(page.locator(".report-primary-stat")).toContainText("$ 140.000");
  await expect(page.locator(".report-category-panel")).toContainText("Carro › Peajes");
  await expect(page.locator(".report-category-panel")).toContainText("$ 90.000");
  await expect(page.locator(".report-category-panel")).toContainText("Restaurantes");
  await expect(page.locator(".report-merchants")).toContainText("Peaje del norte");
  await expect(page.locator(".report-merchants")).not.toContainText("Empresa");
  await expect(page.getByLabel("Producto")).toHaveValue("");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
