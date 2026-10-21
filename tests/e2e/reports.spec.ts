import { expect, test } from "@playwright/test";

const apiBase = `http://127.0.0.1:${process.env.E2E_API_PORT ?? "8787"}/api`;

test.beforeEach(async ({ request, page }) => {
  await page.clock.setFixedTime(new Date("2026-10-19T18:00:00-05:00"));
  await request.post(`${apiBase}/test/reset`);
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
  const movements = [
    {
      id: "toll",
      date: "2026-09-15",
      amountMinor: "10000000",
      kind: "expense",
      merchant: "Peaje del norte",
      categoryId: "car-tolls",
    },
    {
      id: "restaurant",
      date: "2026-10-05",
      amountMinor: "5000000",
      kind: "expense",
      merchant: "Restaurante central",
      categoryId: "restaurants",
    },
    {
      id: "toll-refund",
      date: "2026-10-06",
      amountMinor: "1000000",
      kind: "refund",
      merchant: "Peaje del norte",
      categoryId: "car-tolls",
    },
    {
      id: "salary",
      date: "2026-10-07",
      amountMinor: "300000000",
      kind: "income",
      merchant: "Empresa",
      categoryId: "salary",
    },
  ];
  for (const movement of movements)
    await request.post(`${apiBase}/transactions`, {
      data: { ...movement, accountId: "bank" },
    });
});

test("reports explain spending by time, category and merchant", async ({
  page,
}) => {
  await page.goto("./#/reportes");
  await expect(
    page.getByRole("heading", { name: "Entiende adónde se fue tu dinero." }),
  ).toBeVisible();
  await expect(page.locator(".report-primary-stat")).toContainText("$ 40.000");
  await expect(
    page.getByRole("img", { name: "Gasto neto a través del tiempo" }),
  ).toBeVisible();

  await page.getByLabel("Desde").fill("2026-09-01");
  await page.getByLabel("Hasta").fill("2026-10-19");
  await expect(page.locator(".report-primary-stat")).toContainText("$ 140.000");
  await expect(page.locator(".report-category-panel")).toContainText(
    "Carro › Peajes",
  );
  await expect(page.locator(".report-category-panel")).toContainText(
    "$ 90.000",
  );
  await expect(page.locator(".report-category-panel")).toContainText(
    "Restaurantes",
  );
  await expect(page.locator(".report-merchants")).toContainText(
    "Peaje del norte",
  );
  await expect(page.locator(".report-merchants")).not.toContainText("Empresa");
  await expect(page.getByLabel("Producto")).toHaveValue("");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("trend supports keyboard, pointer and touch inspection including refunds", async ({
  page,
  isMobile,
}) => {
  await page.goto("./#/reportes");
  const chart = page.getByRole("slider", {
    name: "Explorar gasto por período",
  });
  await chart.focus();
  await chart.press("Home");
  for (let index = 0; index < 5; index++) await chart.press("ArrowRight");
  await expect(chart).toHaveAttribute("aria-valuetext", /6 de oct.*10\.000/);
  await expect(page.locator(".report-chart-detail")).toContainText("−$ 10.000");
  const bounds = (await chart.boundingBox())!;
  const position = {
    x: bounds.width * (0.02 + (4 * 0.96) / 18),
    y: bounds.height / 2,
  };
  if (isMobile) await chart.tap({ position });
  else await page.mouse.move(bounds.x + position.x, bounds.y + position.y);
  await expect(chart).toHaveAttribute("aria-valuetext", /5 de oct.*50\.000/);
  await chart.press("End");
  await expect(chart).toHaveAttribute("aria-valuetext", /19 de oct.*\$ 0/);
});

test("category chart opens movements and retains negative category totals", async ({
  page,
}) => {
  await page.goto("./#/reportes");
  const categories = page.getByRole("group", {
    name: "Gráfico de gasto neto por categoría",
  });
  const refunds = categories.getByRole("button", { name: /Carro › Peajes/ });
  await expect(refunds).toContainText("−$ 10.000");
  await refunds.click();
  await expect(refunds).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".report-category-detail")).toContainText(
    "Peaje del norte",
  );
  await expect(page.locator(".report-category-detail")).toContainText(
    "Devolución",
  );
  await categories.getByRole("button", { name: /Restaurantes/ }).focus();
  await categories.getByRole("button", { name: /Restaurantes/ }).press("Enter");
  await expect(page.locator(".report-category-detail")).toContainText(
    "Restaurante central",
  );
  await expect(page.locator(".report-category-detail")).not.toContainText(
    "Peaje del norte",
  );
  await page
    .getByRole("button", { name: "Cerrar detalle de categoría" })
    .click();
  await expect(page.locator(".report-category-detail")).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("reports.png"),
    fullPage: true,
  });
});

test("weekly trend includes the last partial week and filters future and deleted expenses", async ({
  page,
  request,
}) => {
  await request.post(`${apiBase}/transactions`, {
    data: {
      id: "last-week",
      date: "2026-10-19",
      amountMinor: "700000",
      kind: "expense",
      merchant: "Última semana",
      categoryId: "restaurants",
      accountId: "bank",
    },
  });
  await request.post(`${apiBase}/transactions`, {
    data: {
      id: "future",
      date: "2026-12-01",
      amountMinor: "99000000",
      kind: "expense",
      merchant: "Gasto futuro",
      categoryId: "restaurants",
      accountId: "bank",
    },
  });
  expect(
    (
      await request.delete(`${apiBase}/transactions/toll`, {
        data: { expectedRevision: 1 },
      })
    ).status(),
  ).toBe(200);
  await page.goto("./#/reportes");
  await page.getByLabel("Desde").fill("2026-09-01");
  const chart = page.getByRole("slider");
  await chart.focus();
  await chart.press("End");
  await expect(chart).toHaveAttribute(
    "aria-valuetext",
    /Semana del 19 de oct.*7\.000/,
  );
  await expect(page.locator(".report-primary-stat")).toContainText("$ 47.000");
  await page.getByRole("button", { name: "Este año", exact: true }).click();
  await expect(page.locator(".report-primary-stat")).toContainText("$ 47.000");
  await page.getByLabel("Desde").fill("");
  await expect(page.getByRole("alert")).toBeVisible();
});

test("category filter scopes totals and both pies", async ({ page }) => {
  await page.goto("./#/reportes");
  await page.getByLabel("Desde").fill("2026-09-01");
  await page.getByLabel("Categoría", { exact: true }).selectOption("car");
  await expect(page.locator(".report-primary-stat")).toContainText("$ 90.000");
  await expect(
    page.getByRole("img", {
      name: "Distribución por subcategoría",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Distribución por comercio", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".report-merchants")).not.toContainText(
    "Restaurante central",
  );
  await page.screenshot({
    path: test.info().outputPath("filtered-reports.png"),
    fullPage: true,
  });
});

test("movement filters close directly and separate category from subcategory", async ({
  page,
}) => {
  await page.goto("./#/movimientos");
  await page.locator(".register-more > summary").click();
  const panel = page.locator(".register-more-panel");
  await panel.getByLabel("Categoría", { exact: true }).selectOption("car");
  await expect(panel.getByLabel("Subcategoría (opcional)")).toBeVisible();
  await expect(page.locator(".movement-table")).not.toContainText(
    "Restaurante central",
  );
  await panel.getByLabel("Subcategoría (opcional)").selectOption("car-tolls");
  await page
    .getByRole("button", { name: "Cerrar filtros", exact: true })
    .click();
  await expect(panel).not.toBeVisible();
  await page.locator(".register-more summary").click();
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
  await page.locator(".register-more summary").click();
  await page.getByRole("banner").click({ position: { x: 2, y: 2 } });
  await expect(panel).not.toBeVisible();
  await page.locator(".register-more summary").click();
  await page.screenshot({
    path: test.info().outputPath("movement-filters.png"),
    fullPage: true,
  });
});
