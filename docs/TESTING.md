# Local verification and E2E regressions

## Required checks for changes

Run `npm run check` for repository safety, TypeScript, unit tests and the production build. **This command does not run browser tests.**

For shared UI, navigation, copy, accessible names, forms or responsive layout changes:

1. Search the old labels and affected component selectors across `tests/e2e`, source and design documentation. Update affected flows in the same change.
2. Run the relevant existing browser tests alongside new regression tests. A new feature test passing does not validate older flows using the same component.
3. Run the full `npm run test:e2e` suite, which includes desktop and mobile Chromium projects, before calling the change verified. Keep one worker: tests share an ephemeral API and reset its state.
4. For iPhone layout changes, also run `npm run test:e2e:iphone` (WebKit). Emulation does not establish physical-device or iOS Shortcut reliability.
5. Report exactly which checks passed, which browser was used and anything blocked. Never describe a focused run as a full-suite pass.

Install the project dependencies and browser engines when missing:

```sh
npm ci
npx playwright install chromium webkit
npm run check
npm run test:e2e
```

Linux CI installs Chromium with its system dependencies using `npx playwright install --with-deps chromium`. A local installed Chromium-compatible browser can be selected by setting `PLAYWRIGHT_CHROME_PATH` to its executable; disclose that substitution in the verification report. It is not the same browser build used in CI.

Playwright starts isolated local API and Vite servers (`LOCAL_EPHEMERAL=1`); do not point regression tests at a deployed environment. Ports default to 8787 and 5173, with `E2E_API_PORT` and `E2E_WEB_PORT` overrides. These local checks do not authorize deployment, remote pushes or deployment-status monitoring.

## Locator contracts

Prefer role and accessible-name locators for stable user-facing controls. When the name intentionally changes with state, use a stable explicit relationship and separately assert the visible text and state. The mobile account disclosure is a `button[aria-controls="accounts-panel"]`; its name contains the selected product or “Todas las cuentas” and the open/close action. Assert `aria-expanded` and selected text rather than locating it by an obsolete default label.

Do not hide a missing-element failure by increasing timeouts, adding retries, using fixed sleeps, skipping mobile coverage or weakening financial assertions. Check whether the locator matches the actual rendered control first. Playwright's auto-wait cannot make a removed label reappear.

## Incident: mobile account navigation timeout (2026-10-21)

The reported CI run had 85 passing tests and one timeout in the mobile `accounts.spec.ts` account/grouping/filtering flow. The test still clicked a button named “Mis cuentas y tarjetas” after the navigation UI changed to show the current scope and “Cambiar producto”. The control existed, but no longer had that accessible name; `locator.click` waited until the 30-second test timeout. This was a deterministic stale-selector regression, not evidence of a slow backend.

The previous validation ran new navigation checks and a build, but missed the existing account flow. The correction locates the disclosure by its `aria-controls` relationship and checks its text and expanded state before and after selecting the credit account. Financial-total assertions remain intact. Outdated navigation wording in the design references was also corrected.

For a similar failure, reproduce the exact spec, project and test name locally:

```sh
npm run test:e2e -- tests/e2e/accounts.spec.ts --project=mobile --grep 'credit-only setup'
```

Inspect `test-results` error context and retained traces locally when a failure remains. Treat artifacts as potentially sensitive; tests must use synthetic data. Follow the focused fix with the complete desktop/mobile suite.

References: [Playwright locator guidance](https://playwright.dev/docs/locators), [Playwright best practices](https://playwright.dev/docs/best-practices). CI verification steps live in `.github/workflows/checks.yml`.

Local validation of this correction (2026-10-21): reproduced the original missing-name timeout before the fix; the complete E2E suite then passed all 86 tests using installed Google Chrome through `PLAYWRIGHT_CHROME_PATH`. `npm run check` passed repository safety, TypeScript, all 130 unit tests and the production build. This is local evidence, not a claim that hosted CI has rerun or passed. No application UI or infrastructure was changed by this correction.

## Mortgage extension verification (2026-10-21)

`npm run check` passed the secret scan, TypeScript, all 148 unit tests and the production build. The full `npm run test:e2e` passed all 92 desktop/mobile tests using Playwright's installed Chromium engine, without a browser substitution. `npm run test:e2e:iphone` passed all 52 WebKit tests across widths 320, 375, 390 and 430. Both browser suites used isolated ephemeral local servers; the iPhone run used separate ports and artifact output. Existing account-navigation coverage was extended alongside the new mortgage flows. Fresh desktop, mobile and iPhone screenshots also received an independent visual review with no material fixes outstanding.

Private mortgage workbooks were read locally without changing or publishing them. Native UVR comparison covers two bank projection periods within the explicit approximation tolerances in [LOANS.md](LOANS.md); it does not establish exact contractual daily accrual. Independent bank COP schedules remain unavailable, so bank conformance in pesos is not verified. Synthetic financial tests do not replace that evidence. No deployment, remote push or deployed-state verification was performed.

## Mortgage merchant editing and aggregate wording (2026-10-21)

The movement editor now keeps Créditos → Vivienda → destination visible, remembers the merchant's loan and previews selected historical associations without reusing payment applications or allocations. The initial rail wording in this change was Saldo neto registrado, with unchanged recorded-asset-minus-debt arithmetic; the subsequent available-total revision below supersedes that presentation. Local verification passed `npm run check` (150 unit tests, secret scan, TypeScript and build), the full Chromium desktop/mobile suite (94 tests), and all four iPhone WebKit widths (56 tests). Updated existing payment coverage and a merchant-edit/import regression verify the hierarchy and remembered destination. API tests cover stale previews, exclusions, document/application preservation, cash invariance, undo and bounded writes for a larger merchant history. Desktop/mobile and 320px iPhone captures received a local visual review. No deployment or remote push was performed.

## Available total in the product rail (2026-10-21)

The rail now shows Disponible total from the same global dashboard response as Resumen, independent of product selection. The previous net-balance aggregate is removed from that surface; mortgage details remain in Créditos. Existing navigation coverage compares both values with a large mortgage present and verifies the total stays global after selecting another account. Existing loading/stale tests check the placeholder, retained amount and incomplete/stale copy. `npm run check` passed all 150 unit tests, secret scan, TypeScript and build; the full Chromium desktop/mobile suite passed 94 tests and the four-width iPhone WebKit suite passed 56 tests. Read-only local desktop/mobile visual captures also confirmed matching amounts, including a negative available balance. No deployment or remote push was performed.
