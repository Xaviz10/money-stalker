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
  await expect(refunds).toHaveAttribute("aria-expanded", "true");
  await expect(refunds.locator(".report-category-label svg")).toHaveCount(2);
  const refundItem = refunds.locator("..");
  await expect(
    refundItem.locator(":scope > .report-category-detail"),
  ).toContainText("Peaje del norte");
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
    page.getByRole("group", {
      name: "Distribución por subcategoría",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Distribución por comercio", exact: true }),
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

test("pie slices reveal names and values with pointer, touch and keyboard", async ({
  page,
  isMobile,
}) => {
  await page.goto("./#/reportes");
  await page.getByLabel("Desde").fill("2026-09-01");
  for (const [label, first, second] of [
    ["Distribución por subcategoría", "Carro › Peajes", "Restaurantes"],
    ["Distribución por comercio", "Peaje del norte", "Restaurante central"],
  ]) {
    const pie = page.getByRole("group", { name: label, exact: true });
    const selection = pie.locator("..").locator(".report-pie-selection");
    const bounds = (await pie.boundingBox())!;
    const firstPosition = { x: bounds.width * 0.75, y: bounds.height * 0.5 };
    if (isMobile) await pie.tap({ position: firstPosition });
    else await pie.click({ position: firstPosition });
    await expect(selection).toContainText(first);
    await expect(selection).toContainText("$ 90.000");
    const secondPosition = { x: bounds.width * 0.25, y: bounds.height * 0.25 };
    if (isMobile) await pie.tap({ position: secondPosition });
    else await pie.click({ position: secondPosition });
    await expect(selection).toContainText(second);
    await expect(selection).toContainText("$ 50.000");
    const firstSlice = pie.getByRole("button", { name: new RegExp(first) });
    await firstSlice.focus();
    await firstSlice.press("Enter");
    await expect(firstSlice).toHaveAttribute("aria-pressed", "true");
    await expect(selection).toContainText(first);
  }
  const categories = page.getByRole("group", {
    name: "Gráfico de gasto neto por categoría",
  });
  const firstCategory = categories.getByRole("button", {
    name: /Carro › Peajes/,
  });
  await expect(firstCategory).toHaveAttribute("aria-expanded", "true");
  const item = firstCategory.locator("..");
  await expect(item.locator(":scope > .report-category-detail")).toContainText(
    "Peaje del norte",
  );
  await page.screenshot({
    path: test.info().outputPath("interactive-reports.png"),
    fullPage: true,
  });
  await firstCategory.click();
  await expect(firstCategory).toHaveAttribute("aria-expanded", "false");
  await expect(item.locator(".report-category-detail")).toHaveCount(0);
});

test("small grouped slices remain selectable through exact-value rows", async ({
  page,
  request,
}) => {
  await request.post(`${apiBase}/transactions`, {
    data: {
      id: "large",
      date: "2026-10-10",
      amountMinor: "98765432100",
      kind: "expense",
      merchant: "Comercio principal",
      categoryId: "restaurants",
      accountId: "bank",
    },
  });
  const categoryIds = [
    "food",
    "car-fuel",
    "car-parking",
    "delivery",
    "utilities",
    "home",
    "transport",
    "health",
    "leisure",
  ];
  for (const [index, categoryId] of categoryIds.entries()) {
    await request.post(`${apiBase}/transactions`, {
      data: {
        id: `small-${index}`,
        date: "2026-10-10",
        amountMinor: String((9 - index) * 10000),
        kind: "expense",
        merchant: `Pequeño ${index}`,
        categoryId,
        accountId: "bank",
      },
    });
  }
  await page.goto("./#/reportes");
  const merchants = page.locator(".report-merchants");
  const pie = merchants.getByRole("group", {
    name: "Distribución por comercio",
    exact: true,
  });
  await expect(pie.getByRole("button")).toHaveCount(8);
  const small = merchants
    .locator("ol")
    .getByRole("button", { name: /Pequeño 8/ });
  await expect(small).not.toBeVisible();
  await pie.getByRole("button", { name: /^Otros:/ }).click();
  await expect(small).toBeVisible();
  await small.click();
  await expect(small).toHaveAttribute("aria-pressed", "true");
  await expect(merchants.locator(".report-pie-selection")).toContainText(
    "Pequeño 8",
  );
  await expect(merchants.locator(".report-pie-selection")).toContainText(
    "<0,1%",
  );
  await expect(pie.getByRole("button", { name: /^Otros:/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await merchants
    .getByRole("button", { name: "Ocultar otros comercios" })
    .click();
  await expect(small).not.toBeVisible();
  await expect(merchants.locator(".report-pie-selection")).not.toContainText(
    "Pequeño 8",
  );
  const categoryPie = page.getByRole("group", {
    name: "Distribución por subcategoría",
    exact: true,
  });
  await expect(categoryPie.getByRole("button")).toHaveCount(8);
  await categoryPie.getByRole("button", { name: /^Otros:/ }).click();
  const otherCategory = page
    .locator("#other-categories")
    .getByRole("button", { name: /Ocio/ });
  await otherCategory.click();
  await expect(otherCategory).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".report-category-detail")).toContainText(
    "Pequeño 8",
  );
  await expect(
    categoryPie.getByRole("button", { name: /^Otros:/ }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("grouped-reports.png"),
    fullPage: true,
  });
});

test("closed filters retain visible scope and can be removed or reset", async ({
  page,
}) => {
  await page.goto("./#/movimientos");
  await page.locator(".register-more > summary").click();
  const panel = page.locator(".register-more-panel");
  await panel.getByLabel("Categoría", { exact: true }).selectOption("car");
  await panel.getByLabel("Subcategoría (opcional)").selectOption("car-tolls");
  await page
    .getByRole("button", { name: "Cerrar filtros", exact: true })
    .click();
  await expect(page.locator(".register-filter-state")).toContainText(
    "2 de 4 movimientos",
  );
  await expect(
    page.getByRole("button", { name: "Quitar categoría: Carro", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Quitar subcategoría: Peajes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Quitar categoría: Carro", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Buscar en este producto").fill("sin coincidencias");
  await expect(
    page.getByRole("button", {
      name: "Limpiar búsqueda y filtros",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Limpiar búsqueda y filtros", exact: true })
    .click();
  await expect(page.locator(".register-filter-state")).toHaveCount(0);
  await expect(page.locator(".movement-table")).toContainText(
    "Restaurante central",
  );
  await page.locator(".register-more > summary").click();
  await expect(panel).toContainText(
    "todos los movimientos de Ahorros, sin aplicar estos filtros",
  );
  await expect(
    panel.getByRole("button", {
      name: "Exportar CSV del producto completo",
      exact: true,
    }),
  ).toBeVisible();
  await panel.getByLabel("Categoría", { exact: true }).selectOption("car");
  await page
    .getByRole("button", { name: "Cerrar filtros", exact: true })
    .click();
  await page.screenshot({
    path: test.info().outputPath("visible-filters.png"),
    fullPage: true,
  });
});

test("refund-only and zero-net categories retain signed detail", async ({
  page,
  request,
}) => {
  await page.goto("./#/reportes");
  await page.getByLabel("Categoría", { exact: true }).selectOption("car");
  await expect(page.locator(".report-primary-stat")).toContainText("−$ 10.000");
  await expect(
    page.getByText("No hay gasto neto positivo para representar.", {
      exact: true,
    }),
  ).toHaveCount(2);
  await page
    .locator(".report-merchants ol")
    .getByRole("button", { name: /Peaje del norte/ })
    .click();
  await expect(
    page.locator(".report-merchants .report-pie-selection"),
  ).toContainText("Devolución neta");
  await request.post(`${apiBase}/transactions`, {
    data: {
      id: "offset",
      date: "2026-10-06",
      amountMinor: "1000000",
      kind: "expense",
      merchant: "Otro peaje",
      categoryId: "car-tolls",
      accountId: "bank",
    },
  });
  await page.reload();
  await page.getByLabel("Categoría", { exact: true }).selectOption("car");
  await expect(page.locator(".report-primary-stat")).toContainText("$ 0");
  await expect(page.locator(".report-category-panel")).toContainText(
    "Los gastos y las devoluciones se compensan",
  );
  await expect(page.locator(".report-merchants")).toContainText("−$ 10.000");
  await page.getByLabel("Desde").fill("");
  await expect(page.getByRole("alert")).toContainText("Completa las fechas");
});
