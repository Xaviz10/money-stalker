# Money Stalker design system

The approved direction is **Accounts first**. The selected visual reference is `.impeccable/mocks/accounts-first.png`; the running component catalog is `#/design-system`.

## Source and ownership

- `tokens.css`: live color, type, spacing, shape, focus, overlay, and motion primitives. The variable font is self-hosted in `fonts/`; the license is in `public/fonts/OFL-Inter.txt`.
- `ui.tsx`: typed `Icon`, `Eyes`, `EvidenceTrail`, `Badge`, `Button`, `Panel`, `EmptyState`, `SectionHeading`, `DisclosureEditor`, and `Field` components.
- `../style.css`: shared components, application frame, finance patterns, and responsive layouts. New patterns belong in named sections rather than competing override layers.
- Root `DESIGN.md`: portable design tokens and usage guidance. `.impeccable/design.json` carries responsive/motion extensions. Keep them synchronized with the implementation when changing the system.
- `DesignSystem.tsx`: live examples of the shipped controls and their states. Examples are illustrative and do not write financial data.

## Reuse

```tsx
import { Button, Field, Icon, Panel } from "./design-system/ui";

<Panel title="Nueva categoría">
  <Field label="Nombre">
    <input name="name" required />
  </Field>
  <Button type="submit">
    <Icon name="plus" size={17} />
    Guardar categoría
  </Button>
</Panel>;
```

Use native links for navigation and buttons for actions. Label inputs through `Field`. Use `Icon` with its typed name; the SVG is decorative and the control supplies its accessible text. `Button` defaults to the browser's form submission semantics, so set `type="button"` for a non-submit action inside a form.

Variants: primary for the main action, secondary for an alternate action, quiet for a low-priority action, danger for a destructive action. A disabled/busy control retains its label and explains the busy state in text. Badges communicate neutral, blue/selected, success, warning, or danger states using text as well as color.

Use `DisclosureEditor` for inline editing beneath a saved settings row. Keep the saved summary visible, prefill every field, preserve the record ID, and name the submit action “Guardar cambios.”

On the accounts route, keep saved products visible above the `Administrar` hub. Group creation, margin/categories, automatic capture, and bills into native disclosure sections. Automatic capture sequences card aliases and iPhone access inside one disclosure. Open creation automatically only when there are no products; otherwise let the user reveal one task at a time.

## Financial patterns

`AccountRail` uses `domain/account-groups.ts`; do not infer an institution from a display name. `institution` is an optional explicit group name. Bank accounts hold cash balances; debit instruments point to those accounts. Credit accounts have separate debt and optional `parentAccountId` pointing to a bank account. Omitting that association creates an independent credit card. Cash accounts stay separate.

Product artwork follows one fallback chain: a user-uploaded, browser-reduced raster; for bank accounts, the favicon at the explicitly saved HTTPS institution URL; then the built-in bank, card, or cash symbol. Favicon requests use no referrer. Uploaded artwork is restricted to JPG, PNG, or WebP, reduced to a small data image in the browser, and remains inside the owner's private account state. Category symbols come from `CategoryIcon`; built-in categories each have a stable icon while custom categories use `other`.

Grouping never changes money calculations. Do not add debit instrument balances, sum debt into cash, or infer that linking a credit account pays it. Existing accounts without new metadata remain valid. The accounts screen can organize an existing card without changing its opening balance.

The dashboard's available amount is global. Selecting a rail account filters activity and category spending; show that scope explicitly. The net-worth rail summary means all account balances minus credit debt, including accounts excluded from spendable cash. Use the existing exact minor-unit helpers, never floating-point currency math.

Source/candidate review must show amount/date/account context, explain statement-driven amount changes, require an explicit decision, preserve failure state, and offer correction undo. Initial loading, incomplete evidence, and stale refresh are distinct from an empty ledger or a zero balance.

Large review queues use a compact, filterable inbox grouped by merchant, amount, account, type, and review reason, with one focused comparison workspace. Keep durable pending/resolved progress, filters, resume point, and save state visible. A repeated complete group can be previewed and registered in backend-safe chunks as individual movements; this is intended for legitimate repeated purchases such as same-value tolls. Never batch-merge evidence or infer that equal amount/date means one purchase. Conflicting candidate details make separate registration the primary action.

The Movements route is a product register. Scope it to one account or card, show that product’s balance or debt and movement count, and use the account rail or its mobile disclosure as the single scope control. Keep the ledger structure visible when the selected product has no movements. Search, import, export, and new movements use the current product; transfers use their direction relative to it. Import opens as a modal with a required preview and confirmation. On phones, rows keep merchant and amount visible together and place date, category, and status beneath them.

Movement edits persist before the dialog reports success. “Aplicar esta categoría y nota” updates every existing movement with the same normalized merchant and remembers both values for future movements from that merchant. Large merchant groups are saved in bounded chunks. Income movements can use the built-in `Salario` category.

Location is progressive disclosure inside the movement editor. Show an inline location label in the register when evidence or a confirmed place exists. The map distinguishes the iPhone sample from a Google Place selected by the owner, and loads only when the location disclosure is open.

An account opening balance is a dated snapshot. Movements before that date remain visible in the product register and exports, but do not change the current balance, available amount, card debt, or unconfirmed card amount. Import help must explain this before confirmation.

Signed interchange imports follow the selected product. Bank and cash accounts interpret positive values as income and negative values as expenses. Credit cards interpret positive values as purchases and negative values as refunds. An explicit transaction type overrides sign inference so payments and transfers keep their real meaning.

The verified Bancolombia Visa detailed XLSX profile reads `Valor Movimiento`: positive rows are purchases, negative non-payment rows are refunds, and negative rows labeled as an abono or payment become bank-to-card transfers. Use the card's linked bank account, or the only configured bank account when unambiguous; otherwise leave the transfer for review instead of guessing.

Every ledger and import-preview row states its direction independently from its reconciliation status. Use `Ingreso`, `Gasto`, `Compra`, `Pago recibido`, `Pago de tarjeta`, or the applicable transfer direction, paired with a signed amount. `Histórico` only explains balance treatment and never replaces the movement type. Card payments are incoming to the card but remain transfers rather than income.

## Responsive behavior and accessibility

Desktop has top navigation, an account rail, main ledger, and right insights workspace. Below 1100px the insights move below the ledger. At 850px and below the rail is an in-flow, scrollable disclosure opened by “Mis cuentas y tarjetas.” It closes after selection. Narrow transactions keep merchant and amount together and move account/date beneath the name.

Use visible focus, native keyboard behavior, labeled controls, `aria-current` for navigation, and `aria-pressed` for account/filter selection. Restrict motion to clear state changes; respect reduced motion. Keep localized COP formatting and America/Bogota dates. Do not ship screenshot text, example balances, bank logos, or generated analytics as real data.

## Extend the system

Reuse existing tokens/components before adding a new one. Promote a repeated, same-purpose pattern; keep one-off screen behavior local. Update the catalog and root design reference with a new reusable variant. Check the actual page at desktop, tablet, and narrow-phone sizes and run the relevant browser flow. Add behavior tests when financial state, grouping, filtering, or recovery changes.

## Financial trail and companion

`EvidenceTrail` is a decorative, noninteractive family of financial symbols with `funds`, `evidence` and `holdings` variants. Use it in reserved heading space, empty-state artwork and the rail companion. Keep it out of data rows, amounts, input fields and status messages. `coin`, `receipt`, `pocket` and `investment` are available in `Icon`; functional controls still need visible labels.


| Variant | Symbols | Intended context |
| --- | --- | --- |
| `funds` | Coin, wallet, receipt | Summary and money overview |
| `evidence` | Receipt, search, card | Review and empty evidence states |
| `holdings` | Pocket, coin, investment | Accounts and saved products |

Use primary-blue outlines at 12–18% opacity on light surfaces and white at 16% on the blue rail. Decorative elements have `aria-hidden`, ignore pointer events and remain static. Reserve their own space; hide heading motifs below 380px rather than squeezing text. The `Eyes` companion keeps its dark capsule and −12° inclination.

The favicon and installed-app icons use primary blue `#1949db`, the complete eye mark in the lower-right corner, and faint coin/receipt outlines. Maskable variants inset the mark for platform cropping. Edit `public/icon.svg` and regenerate PNGs with `scripts/generate-icons.mjs`; keep favicon, Apple touch and PWA assets consistent. See the live variants at `#/design-system` and the portable rules in root `DESIGN.md`.

## Product setup

The account creation form asks for type, name, opening balance/date, then SMS identity for non-cash products. Bank accounts offer “Agregar tarjeta débito ahora”; the optional card shares the source balance and saves with the account as one operation. Keep visual personalization and organization in the collapsed “Más opciones” disclosure. Product editing owns future alias changes and “Agregar tarjeta débito”; the shared iPhone connection keeps four primary steps and a final optional later-card form. SMS identification status never implies that an automation is connected.

Expense symbols: Suscripciones uses a playback screen, Compras online a cart, Compras a shopping bag, Créditos a document/clock, Gastos bancarios a bank/charge, Internet Wi-Fi and Telefonía a phone. Built-in subcategories reuse their parent symbol. Keep these outlined at the shared stroke weight and pair them with category text; the catalog includes every new family.

## iPhone form containment

Native date/time fields use `min-inline-size: 0`, explicit border-box width, a left-aligned WebKit value and the native picker. On phones, text inputs/selects use 16px type to avoid Safari focus zoom; selects keep the native menu with a consistent 44px target and chevron. Product editors and nested card forms lose desktop indentation. Long account names wrap, balances get their own row, and actions may wrap without hiding text. Reports stack dates below 420px. Never fix overflow by clipping the document.

`npm run test:e2e:iphone` runs local WebKit layout regressions at 320, 375, 390 and 430px with synthetic data. Install its browser first with `npx playwright install webkit`. These checks cover product/card editors, native movement dates, reports, long names and large balances; real iPhone keyboard and browser chrome still require owner device verification.
