import { expect, test } from "@playwright/test";

const apiBase = `http://127.0.0.1:${process.env.E2E_API_PORT ?? "8787"}/api`;
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test.beforeEach(async ({ request }) => {
  await request.post(`${apiBase}/test/reset`);
});

test("category set and product artwork stay clear and editable", async ({
  page,
  request,
}) => {
  await page.goto("./#/cuentas");
  const create = page.locator(".settings-section").filter({
    has: page.getByText("Agregar producto", { exact: true }),
  });
  await create.getByLabel("Nombre de la cuenta").fill("Ahorros con identidad");
  await create.getByText("Más opciones · banco, imagen y organización", { exact: true }).click();
  await create.getByLabel("Banco o entidad (opcional)").fill("Bancolombia");
  await create
    .getByLabel("Sitio web del banco (opcional)")
    .fill("https://www.bancolombia.com");
  await create.getByLabel("Imagen del producto (opcional)").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: tinyPng,
  });
  await create.getByLabel("Saldo inicial (COP)").fill("100.000");
  await create.getByLabel("Fecha del saldo inicial").fill("2026-01-01");
  await create.getByRole("button", { name: "Guardar", exact: true }).click();

  const row = page
    .locator(".account-row")
    .filter({ hasText: "Ahorros con identidad" });
  await expect(row.locator(".account-artwork-image")).toHaveAttribute(
    "src",
    /^data:image\/(?:webp|png);base64,/,
  );
  const state = await (await request.get(`${apiBase}/state`)).json();
  expect(state.accounts[0]).toMatchObject({
    institutionUrl: "https://www.bancolombia.com",
  });
  expect(state.accounts[0].imageDataUrl).toMatch(
    /^data:image\/(?:webp|png);base64,/,
  );
  expect(
    state.categories.map((category: { name: string }) => category.name),
  ).toEqual(
    expect.arrayContaining([
      "Mercado",
      "Restaurantes",
      "Carro",
      "Domicilios",
      "Servicios",
    ]),
  );
  expect(
    state.categories.map((category: { name: string }) => category.name),
  ).not.toContain("Alimentación");

  expect(
    (
      await request.post(`${apiBase}/accounts`, {
        data: {
          id: "visa",
          name: "Visa independiente",
          kind: "credit",
          openingMinor: "0",
          openingDate: "2026-01-01",
          closingDay: 15,
          dueDay: 5,
        },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  const card = page
    .locator(".account-row")
    .filter({ hasText: "Visa independiente" });
  await expect(card.locator(".stat-icon.credit svg")).toBeVisible();
});
