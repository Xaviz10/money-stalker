import { expect, test } from "@playwright/test";

const apiBase = `http://127.0.0.1:${process.env.E2E_API_PORT ?? "8787"}/api`;

test.beforeEach(async ({ request }) => {
  await request.post(`${apiBase}/test/reset`);
});

test("review queue shows progress and registers repeated purchases individually or in a batch", async ({ page, request }) => {
  await request.post(`${apiBase}/accounts`, { data: {
    id: "bank", name: "Ahorros", kind: "bank", openingMinor: "100000000",
    openingDate: "2026-01-01", eligible: true,
  } });
  const device = await (await request.post(`${apiBase}/devices`, { data: { name: "Review phone" } })).json();
  for (let index = 0; index < 4; index++) {
    await request.post(`${apiBase}/capture-events`, {
      headers: { Authorization: `Bearer ${device.token}` },
      data: {
        eventId: `toll-${index}`, source: "wallet", observedAt: `2026-10-17T18:0${index}:00Z`,
        date: "2026-10-17", accountId: "bank", amountMinor: "1500000", merchant: "Peaje",
      },
    });
    await expect.poll(async () => {
      if (index === 0) {
        const state = await (await request.get(`${apiBase}/state`)).json();
        return state.transactions.length;
      }
      const dashboard = await (await request.get(`${apiBase}/dashboard`)).json();
      return dashboard.pending;
    }).toBe(index === 0 ? 1 : index);
  }

  await page.goto("./#/revisar");
  await expect(page.getByText("3 pendientes", { exact: true })).toBeVisible();
  await expect(page.getByText("0 resueltas en esta sesión", { exact: true })).toBeVisible();
  await page.locator(".clue-select input").nth(0).check();
  await page.locator(".clue-select input").nth(1).check();
  await page.getByRole("button", { name: "Registrar 2 como distintos" }).click();
  await expect(page.getByText("1 pendientes", { exact: true })).toBeVisible();
  await expect(page.getByText("2 resueltas en esta sesión", { exact: true })).toBeVisible();
  await expect(page.locator(".review-progress [role=status]")).toContainText("2 movimientos guardados");

  await page.getByRole("button", { name: "Registrar como movimiento distinto" }).click();
  await expect(page.getByRole("heading", { name: "Todo en su lugar" })).toBeVisible();
  const state = await (await request.get(`${apiBase}/state`)).json();
  expect(state.transactions).toHaveLength(4);
  expect(state.observations.filter((observation: { status: string }) => observation.status === "review")).toHaveLength(0);
});
