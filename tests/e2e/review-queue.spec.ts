import { expect, test } from "@playwright/test";

const apiBase = `http://127.0.0.1:${process.env.E2E_API_PORT ?? "8787"}/api`;

test.beforeEach(async ({ request }) => {
  await request.post(`${apiBase}/test/reset`);
});

test("clears progress from a deleted review queue", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "money-stalker.review-progress.v2",
      JSON.stringify(Array.from({ length: 172 }, (_, index) => `old-${index}`)),
    );
  });
  await page.goto("./#/revisar");
  await expect(page.getByRole("heading", { name: "Todo en su lugar" })).toBeVisible();
  await expect(page.getByText("172 resueltas", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Progreso guardado", { exact: true })).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("money-stalker.review-progress.v2"),
      ),
    )
    .toBe("[]");
});

test("review queue shows every capture and requires reviewing before saving", async ({
  page,
  request,
  isMobile,
}, testInfo) => {
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
  const device = await (
    await request.post(`${apiBase}/devices`, { data: { name: "Review phone" } })
  ).json();
  const captures = [
    { merchant: "Peaje", amountMinor: "1500000" },
    { merchant: "Peaje", amountMinor: "1500000" },
    { merchant: "Peaje", amountMinor: "1500000" },
    { merchant: "Parqueadero", amountMinor: "1200000" },
    { merchant: "Parqueadero", amountMinor: "1200000" },
  ];
  for (let index = 0; index < captures.length; index++) {
    await request.post(`${apiBase}/capture-events`, {
      headers: { Authorization: `Bearer ${device.token}` },
      data: {
        eventId: `toll-${index}`,
        source: "wallet",
        observedAt: `2026-10-17T18:0${index}:00Z`,
        date: "2026-10-17",
        accountId: "bank",
        amountMinor: captures[index].amountMinor,
        merchant: captures[index].merchant,
      },
    });
    await expect
      .poll(async () => {
        const dashboard = await (
          await request.get(`${apiBase}/dashboard`)
        ).json();
        return `${dashboard.pending}:${dashboard.balances.bank}`;
      })
      .toBe(
        [
          `1:100000000`,
          `2:100000000`,
          `3:100000000`,
          `4:100000000`,
          `5:100000000`,
        ][index],
      );
  }

  await page.goto("./#/revisar");
  await expect(page.getByText("5 pendientes", { exact: true })).toBeVisible();
  await expect(page.getByText("0 resueltas", { exact: true })).toBeVisible();
  const captureList = page.getByRole("complementary", { name: "Lista de capturas pendientes" });
  await expect(captureList.getByRole("button")).toHaveCount(5);
  await expect(captureList.getByText("Peaje", { exact: true })).toHaveCount(3);
  await expect(captureList.getByText("Parqueadero", { exact: true })).toHaveCount(2);
  await expect(captureList.getByText(/Capturada 1:00 p\. m\./)).toBeVisible();
  await expect(captureList.getByText(/Capturada 1:04 p\. m\./)).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Buscar capturas" });
  for (const value of ["15.000", "15000", "$ 15.000"]) {
    await search.fill(value);
    await expect(captureList.getByRole("button")).toHaveCount(3);
  }
  await search.fill("");
  await captureList.getByRole("button", { name: /Parqueadero.*12\.000/ }).first().click();
  await page.reload();
  await expect(page.locator(".review-focus h2")).toHaveText("Parqueadero");
  const selectedCapture = captureList.locator('[aria-current="true"]');
  await expect(selectedCapture).toContainText("En revisión");
  await expect.poll(() => selectedCapture.evaluate((row) => {
    const list = row.closest("aside")!.getBoundingClientRect(), bounds = row.getBoundingClientRect();
    return bounds.top >= list.top && bounds.bottom <= list.bottom;
  })).toBe(true);
  await page.locator(".review-filter-menu > summary").click();
  await page.getByLabel("Origen").selectOption("wallet");
  if (isMobile) await page.getByRole("button", { name: "Cerrar filtros", exact: true }).click();
  else await page.locator(".review-filter-menu > summary").click();
  await expect(page.getByRole("button", { name: "Quitar filtro Origen: Wallet" })).toBeVisible();
  await expect(captureList.getByText("5 de 5 capturas", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Quitar filtro Origen: Wallet" }).click();
  await expect(page.getByRole("heading", { name: "Lista para revisar" })).toBeVisible();
  await expect(page.getByText("Recibimos la captura, pero aún no está guardada como movimiento. Revísala y confirma sus datos antes de guardar.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar movimiento", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Revisar", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Revisar", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Revisar captura" });
  await expect(editor.getByLabel("Comercio o descripción")).toHaveValue("Parqueadero");
  await editor.getByLabel("Comercio o descripción").fill("Parqueadero corregido");
  expect((await (await request.get(`${apiBase}/state`)).json()).transactions).toHaveLength(0);
  await editor.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("review-ready.png"), fullPage: true });
  for (let remaining = 5; remaining > 0; remaining--) {
    await page.getByRole("button", { name: "Revisar", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Revisar captura" });
    await dialog.getByRole("button", { name: "Guardar movimiento", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText(`${remaining - 1} pendientes`, { exact: true })).toBeVisible();
  }
  await expect(
    page.getByRole("heading", { name: "Todo en su lugar" }),
  ).toBeVisible();
  await expect(page.getByText("5 resueltas", { exact: true })).toBeVisible();

  await page.goto("./#/movimientos");
  await page.goto("./#/revisar");
  await expect(page.getByText("5 resueltas", { exact: true })).toBeVisible();
  await expect(page.locator(".review-progress [role=status]")).toContainText(
    "5 de 5 capturas resueltas",
  );

  await page.reload();
  await expect(page.getByText("5 resueltas", { exact: true })).toBeVisible();
  await expect(page.locator(".review-progress [role=status]")).toContainText(
    "5 de 5 capturas resueltas",
  );
  const history = page.locator(".correction-history .audit-row");
  await expect(history.first()).toContainText("Parqueadero · $ 12.000 · Ahorros");
  await history.first().getByText("Ver cambio y efecto de deshacer").click();
  await expect(history.first()).toContainText("se retira el movimiento");
  const state = await (await request.get(`${apiBase}/state`)).json();
  expect(state.transactions).toHaveLength(5);
  expect(
    state.observations.filter(
      (observation: { status: string }) => observation.status === "review",
    ),
  ).toHaveLength(0);
});

test("an unmatched SMS can be edited before it is registered", async ({ page, request }) => {
  await request.post(`${apiBase}/accounts`, { data: {
    id: "sms-bank", name: "Cuenta de prueba", kind: "bank", openingMinor: "0", openingDate: "2026-01-01", eligible: true,
  } });
  await request.post(`${apiBase}/instruments`, { data: {
    id: "sms-card", name: "Débito de prueba", accountId: "sms-bank", aliases: ["1122"],
  } });
  const device = await (await request.post(`${apiBase}/devices`, { data: { name: "iPhone de prueba" } })).json();
  await request.post(`${apiBase}/capture-events`, { headers: { Authorization: `Bearer ${device.token}` }, data: {
    eventId: "edit-sms", source: "sms", observedAt: "2026-10-17T18:00:00Z",
    message: "Bancolombia: Compraste $22.000,00 en COMERCIO EJEMPLO con tu T.Deb *1122, el 17/10/2026 a las 10:55.",
  } });
  await expect.poll(async () => (await (await request.get(`${apiBase}/state`)).json()).observations.length).toBe(1);
  await page.goto("./#/revisar");
  await expect(page.getByRole("button", { name: "Registrar movimiento", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Registrar otro movimiento", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Revisar", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Revisar captura" });
  await expect(editor.getByLabel("Mensaje SMS original")).toContainText("Bancolombia: Compraste $22.000,00");
  await editor.getByLabel("Comercio o descripción").fill("Comercio corregido");
  await editor.getByLabel("Valor (COP)").fill("23.000");
  expect((await (await request.get(`${apiBase}/state`)).json()).transactions).toHaveLength(0);
  await editor.getByRole("button", { name: "Guardar movimiento", exact: true }).click();
  await expect(editor).not.toBeVisible();
  const state = await (await request.get(`${apiBase}/state`)).json();
  expect(state.transactions).toHaveLength(1);
  expect(state.transactions[0]).toMatchObject({ merchant: "Comercio corregido", amountMinor: "2300000" });
  expect(state.observations.filter((item: { status: string }) => item.status === "review")).toHaveLength(0);
  expect(state.transactions[0].observationIds).toHaveLength(1);
});
