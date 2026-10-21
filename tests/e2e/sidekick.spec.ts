import { expect, test, type Page } from "@playwright/test";
import { emptyState, type State } from "../../domain/model";
import {
  addTransaction,
  dashboard,
  mergeObservation,
  undo,
} from "../../domain/ledger";

const today = "2026-10-18",
  at = "2026-10-18T12:00:00Z";
function fixture() {
  const state = emptyState();
  state.accounts.push({
    id: "bank",
    name: "Ahorros",
    kind: "bank",
    openingMinor: "100000000",
    openingDate: "2026-01-01",
    eligible: true,
  });
  addTransaction(
    state,
    {
      id: "coffee",
      accountId: "bank",
      amountMinor: "1850000",
      date: today,
      kind: "expense",
      merchant: "Café de prueba",
      status: "provisional",
    },
    at,
  );
  state.observations.push({
    id: "statement",
    source: "statement",
    observedAt: at,
    receivedAt: at,
    date: today,
    accountId: "bank",
    amountMinor: "1900000",
    currency: "COP",
    merchant: "Café de prueba",
    kind: "expense",
    status: "review",
    candidates: ["coffee"],
    parserVersion: "1",
  });
  return state;
}
async function mock(page: Page, state: State) {
  const control = {
    failRead: false,
    failMatch: false,
    holdReads: false,
    writes: 0,
    reads: 0,
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/state") || path.endsWith("/dashboard")) {
      if (path.endsWith("/state")) control.reads++;
      while (control.holdReads)
        await new Promise((resolve) => setTimeout(resolve, 30));
      if (control.failRead)
        return route.fulfill({
          status: 503,
          json: { error: "No se pudo actualizar" },
        });
      return route.fulfill({
        json: path.endsWith("/state") ? state : dashboard(state, today),
      });
    }
    if (path.endsWith("/matches")) {
      if (control.failMatch)
        return route.fulfill({
          status: 409,
          json: { error: "No se pudo unir. Intenta de nuevo." },
        });
      control.writes++;
      const body = route.request().postDataJSON();
      mergeObservation(state, body.observationId, body.transactionId, at);
    } else if (path.endsWith("/undo")) {
      control.writes++;
      undo(state, route.request().postDataJSON().auditId, at);
    }
    return route.fulfill({ json: {} });
  });
  return control;
}

test("loading and failed refresh never pretend to be empty or current balances", async ({
  page,
}) => {
  const state = fixture();
  state.observations.push({
    id: "missing",
    source: "sms",
    observedAt: at,
    receivedAt: at,
    currency: "COP",
    merchant: "Sin valor",
    kind: "expense",
    status: "review",
    candidates: [],
    parserVersion: "1",
  });
  const control = await mock(page, state);
  control.holdReads = true;
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Buscando tus pistas…" }),
  ).toBeVisible();
  await expect(page.locator(".first-account")).toHaveCount(0);
  await expect(page.locator(".rail-worth > strong")).toHaveText("—");
  control.holdReads = false;
  await expect(page.locator(".balance-status")).toContainText(
    "El disponible está incompleto",
  );
  await page.getByText("Ver detalle").click();
  await expect(page.locator(".commitments-details")).toContainText(
    "Por revisar",
  );
  const balance = await page.locator(".available-total > strong").textContent();
  await expect(page.locator(".rail-worth > strong")).toHaveText(balance!);
  await expect(page.locator(".rail-worth > small")).toContainText("Datos incompletos");
  control.failRead = true;
  await page.getByRole("button", { name: "Actualizar datos" }).click();
  await expect(page.locator(".balance-status")).toContainText(
    "Datos sin actualizar",
  );
  await expect(page.locator(".available-total > strong")).toHaveText(balance!);
  await expect(page.locator(".rail-worth > strong")).toHaveText(balance!);
  await expect(page.locator(".rail-worth > small")).toContainText("datos sin actualizar");
  await page.getByRole("link", { name: "Revisar coincidencia" }).click();
  await expect(
    page.getByRole("button", { name: "Unir de todos modos" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("review explains amount changes, preserves a failed match, confirms success and supports undo", async ({
  page,
}) => {
  const control = await mock(page, fixture());
  await page.goto("./#/revisar");
  await expect(
    page.getByText("Valor diferente · Misma fecha"),
  ).toBeVisible();
  await expect(
    page.getByText("Al unir, el valor cambiará a $ 19.000 según el extracto."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar otro movimiento", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Editar antes de guardar", exact: true })).toBeVisible();
  control.failMatch = true;
  await page.getByRole("button", { name: "Unir de todos modos" }).click();
  await expect(page.locator(".review-action-error")).toContainText(
    "No se pudo unir",
  );
  await expect(page.locator(".review-action-error")).toContainText(
    "La pista continúa pendiente",
  );
  await expect(page.locator(".clue")).toHaveCount(1);
  control.failMatch = false;
  await page.getByRole("button", { name: "Unir de todos modos" }).click();
  await expect(
    page.getByRole("heading", { name: "Todo en su lugar" }),
  ).toBeVisible();
  await expect(page.locator(".review-progress [role=status]")).toContainText(
    "Pistas unidas",
  );
  const correction = page.locator(".correction-history .audit-row").first();
  await expect(correction).toContainText("Café de prueba · $ 18.500 · Ahorros");
  await correction.getByText("Ver cambio y efecto de deshacer").click();
  await expect(correction).toContainText("Antes: Café de prueba · $ 18.500");
  await expect(correction).toContainText("Después: Café de prueba · $ 19.000");
  await page.getByRole("button", { name: "Deshacer", exact: true }).click();
  await expect(page.locator(".clue")).toHaveCount(1);
  expect(control.writes).toBe(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("first use offers a single account setup path, without zero-value dashboard noise", async ({
  page,
}) => {
  await mock(page, emptyState());
  await page.goto("./");
  await expect(
    page.getByRole("link", { name: "Agregar mi primera cuenta" }),
  ).toHaveAttribute("href", "#/cuentas");
  await expect(page.locator(".funds-equation")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Nuevo movimiento" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("compact financial operands keep digit groups intact and ledger controls separated", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await mock(page, fixture());
  await page.goto("./");
  await expect(page.locator(".available-total > strong")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const figures = await page
    .locator(".equation-part > strong, .preview-comparison strong")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return { text: node.textContent, lines: range.getClientRects().length };
      }),
    );
  expect(figures).toHaveLength(4);
  for (const figure of figures)
    expect(figure.lines, figure.text ?? "amount").toBe(1);
  const tabs = await page.locator(".activity-tabs").boundingBox(),
    more = await page.locator(".activity-toolbar > .text-link").boundingBox();
  expect(tabs).not.toBeNull();
  expect(more).not.toBeNull();
  expect(more!.y).toBeGreaterThanOrEqual(tabs!.y + tabs!.height - 1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});


test("refresh button reports progress, recovers from a timeout and can retry", async ({ page }) => {
  await page.clock.install();
  const control = await mock(page, fixture());
  await page.goto("./");
  const refresh = page.getByRole("button", { name: "Actualizar datos" });
  await expect(refresh).toBeEnabled();
  await page.clock.fastForward(500);
  control.holdReads = true;
  await refresh.click();
  await expect(refresh).toBeDisabled();
  await expect(refresh).toHaveAttribute("aria-busy", "true");
  await page.clock.fastForward(15001);
  await expect(page.getByRole("alert")).toContainText("La actualización tardó demasiado");
  await expect(refresh).toBeEnabled();
  control.holdReads = false;
  await refresh.click();
  await expect(page.locator(".action-notice")).toContainText("Datos actualizados.");
  await expect(refresh).toHaveAttribute("aria-busy", "false");
});

test("returning to the app refreshes data once and preserves an open editor", async ({ page }) => {
  await page.clock.install();
  const state = fixture();
  const control = await mock(page, state);
  await page.goto("./");
  await expect(page.getByRole("button", { name: "Actualizar datos" })).toBeEnabled();
  await page.clock.fastForward(500);
  await page.getByRole("button", { name: "Nuevo movimiento" }).click();
  const editor = page.getByRole("dialog", { name: "Nuevo movimiento" });
  await editor.getByLabel("Comercio o descripción").fill("Borrador sin guardar");
  const reads = control.reads;
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await page.clock.fastForward(500);
  expect(control.reads).toBe(reads);
  state.accounts[0].openingMinor = "200000000";
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
  });
  await page.clock.fastForward(250);
  await expect.poll(() => control.reads).toBe(reads + 1);
  await expect(page.locator(".available-total > strong")).toHaveText("$ 1.962.500");
  await expect(editor.getByLabel("Comercio o descripción")).toHaveValue("Borrador sin guardar");
  await editor.getByRole("button", { name: "Cerrar", exact: true }).click();
  const focusedReads = control.reads;
  state.accounts[0].openingMinor = "300000000";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.clock.fastForward(250);
  await expect.poll(() => control.reads).toBe(focusedReads + 1);
  await expect(page.locator(".available-total > strong")).toHaveText("$ 2.962.500");
});
