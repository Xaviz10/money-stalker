import { expect, test } from "@playwright/test";

const apiBase = `http://127.0.0.1:${process.env.E2E_API_PORT ?? "8787"}/api`;

test.beforeEach(async ({ request }) => {
  await request.post(`${apiBase}/test/reset`);
});

test("review queue shows progress and registers repeated purchases individually or in a batch", async ({
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
  await page.getByRole("button", { name: /Peaje.*3 pistas/ }).click();
  await page.getByRole("button", { name: "Preparar 3 como distintos" }).click();
  await expect(
    page.getByText("Registrar 3 pistas como 3 movimientos distintos"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirmar 3" }).click();
  await expect(page.getByText("2 pendientes", { exact: true })).toBeVisible();
  await expect(page.getByText("3 resueltas", { exact: true })).toBeVisible();
  await expect(page.locator(".clue")).toHaveCount(1);
  await expect(page.locator(".clue-state")).toHaveText("1 de 2 en este grupo");
  await expect(page.locator(".review-progress [role=status]")).toContainText(
    "3 pistas registradas como movimientos distintos",
  );

  await page.goto("./#/movimientos");
  await page.goto("./#/revisar");
  await expect(page.getByText("3 resueltas", { exact: true })).toBeVisible();
  await expect(page.locator(".clue-state")).toHaveText("1 de 2 en este grupo");

  await page
    .getByRole("button", { name: "Registrar como movimiento distinto" })
    .click();
  await expect(page.getByText("1 pendientes", { exact: true })).toBeVisible();
  await expect(page.getByText("4 resueltas", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Registrar como movimiento distinto" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Todo en su lugar" }),
  ).toBeVisible();
  await expect(page.getByText("5 resueltas", { exact: true })).toBeVisible();
  await expect(page.locator(".review-progress [role=status]")).toHaveText(
    "Pista resuelta. La revisión quedó al día.",
  );

  await page.goto("./#/movimientos");
  await page.goto("./#/revisar");
  await expect(page.getByText("5 resueltas", { exact: true })).toBeVisible();
  await expect(page.locator(".review-progress [role=status]")).toContainText(
    "5 de 5 pistas resueltas",
  );

  await page.reload();
  await expect(page.getByText("5 resueltas", { exact: true })).toBeVisible();
  await expect(page.locator(".review-progress [role=status]")).toContainText(
    "5 de 5 pistas resueltas",
  );
  const state = await (await request.get(`${apiBase}/state`)).json();
  expect(state.transactions).toHaveLength(5);
  expect(
    state.observations.filter(
      (observation: { status: string }) => observation.status === "review",
    ),
  ).toHaveLength(0);
});
