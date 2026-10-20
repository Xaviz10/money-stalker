---
name: Money Stalker
description: Accounts first — clear financial figures and a curious eye for the evidence.
colors:
  primary: "#1949db"
  primary-hover: "#103bbd"
  primary-soft: "#edf2ff"
  rail: "#132d78"
  rail-muted: "#c4d2f4"
  rail-line: "#ffffff26"
  ink: "#0c1730"
  text: "#304367"
  muted: "#596b89"
  canvas: "#f7f9fd"
  surface: "#ffffff"
  surface-subtle: "#fbfcff"
  surface-hover: "#fafbfe"
  line: "#e0e6f0"
  icon-muted: "#7c93bd"
  citron: "#f6f673"
  citron-soft: "#fdfddf"
  success: "#207052"
  success-bg: "#e9f5ee"
  warning: "#865017"
  warning-bg: "#fff3db"
  danger: "#a4382a"
  danger-bg: "#fff0ec"
  focus: "#2454cf"
typography:
  display:
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "52px"
    fontWeight: 900
    lineHeight: 1.08
    letterSpacing: "-0.04em"
  heading:
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "38px"
    fontWeight: 850
    lineHeight: 1.12
    letterSpacing: "-0.035em"
  title:
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "19px"
    fontWeight: 750
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  body:
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    lineHeight: 1.7
  label:
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
  small:
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "11px"
    lineHeight: 1.6
rounded:
  sm: "6px"
  control: "8px"
  panel: "12px"
  large: "16px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "10": "40px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.primary-soft}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  button-quiet-hover:
    backgroundColor: "{colors.primary-soft}"
  button-danger:
    backgroundColor: "{colors.danger-bg}"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  badge-warning:
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.warning}"
    rounded: "5px"
    padding: "4px 7px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "{spacing.6}"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "11px 12px"
  account-rail:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.surface}"
    padding: "24px 18px 20px"
  available-total:
    backgroundColor: "{colors.citron}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "23px 17px"
---

# Design System: Money Stalker

## Overview

**Creative North Star: "Accounts first"**

Money Stalker combines familiar account organization with expressive financial typography and a curious eye companion. The approved composition uses white top navigation, a deep ultramarine account rail, a primary ledger, and a right evidence/category workspace. The citron available amount is its financial focal point. The user rejected the earlier generic pastel helper-card treatment.

The eye helps orient, inspect evidence, and acknowledge completed review. Financial labels and warnings stay literal; the interface represents recorded data and explicit user decisions. Spanish copy, COP formatting, and America/Bogota dates give the workspace its local context.

**Key Characteristics:**

- Grouped accounts and cards with readable balances and debt.
- One self-hosted variable family, heavy headings, and tabular figures.
- Blue actions, a citron available total, and textual semantic states.
- Flat white work surfaces, fine borders, and native controls.

`src/design-system/tokens.css` is the live primitive source. Frontmatter keys preserve CSS suffixes: `primary` maps to `--color-primary`, `heading` to `--text-heading`, `control` to `--radius-control`, and `4` to `--space-4`. `src/style.css` owns shared patterns and responsive overrides; `src/design-system/ui.tsx` owns typed primitives. The catalog is `#/design-system`. Keep these sources and this reference synchronized. `PRODUCT.md` owns product truth; `docs/design/dashboard-review.md` owns the approved surface brief.

## Colors

The palette pairs deep ultramarine structure with white working space and a concentrated citron highlight. Frontmatter values are normative.

### Primary

**Action Blue** (`primary`, `primary-hover`, `primary-soft`) identifies actions, links, navigation selection, and filtered context. **Account Ultramarine** (`rail`) grounds the financial hierarchy; `rail-muted` and `rail-line` support text and group separation. **Focus Blue** (`focus`) supplies light-surface keyboard outlines; the rail has a lighter local outline.

### Secondary

**Available Citron** (`citron`) anchors the available-total surface and brand tile. `citron-soft` exists in the live primitive set; it does not establish a second status meaning or a default panel tint.

### Neutral

**Financial Ink** (`ink`) carries headings and important figures; `text` carries reading copy and `muted` carries context. `canvas` surrounds white `surface` work areas. `surface-subtle` and `surface-hover` provide quiet structure, `icon-muted` supports secondary symbols, and `line` separates panels, rows, and work zones.

### Semantic states

`success` with `success-bg` means confirmation/completion or incoming money. `warning` with `warning-bg` means pending review, differences, or caution. `danger` with `danger-bg` means error, destructive action, or an evidence discrepancy needing attention. Category symbols/bars and account-type tiles have local classification colors; these do not replace the semantic pairs.

**The Explicit State Rule.** Pair status color with literal text and, where present, an icon. Color never carries the entire meaning alone.

**The Global Amount Rule.** Keep the citron amount explicitly labeled as available across all accounts. Account selection scopes activity and category spending, while the global amount remains global.

**The Product Artwork Rule.** Prefer user-uploaded artwork, then an explicitly configured bank favicon, then the built-in product symbol. Credit cards use the card symbol by default. Keep artwork square, contained, private, and decorative; the adjacent product name remains the accessible label. Built-in spending categories use distinct line icons consistently in summaries and ledgers.

## Typography

**Display Font:** self-hosted Inter variable, with the platform fallback stack recorded in frontmatter. **Body Font:** the same family. The application disables synthesized fonts.

The character is heavy and tightly tracked in headings, calmer in explanatory copy, and precise in money. The shipped Inter display treatment is an intentional part of the approved reference; a generic font-detector warning does not authorize replacing it.

- **Display:** the main dashboard statement, using the display role as its baseline and responsive overrides for available space.
- **Heading:** general page titles. Mobile route headings reduce locally.
- **Title:** shared section and panel headings; review titles have local emphasis in the same family.
- **Body:** explanations and paragraphs; dashboard introductory copy has a maximum measure of approximately 65 characters.
- **Label / Small:** field labels, dates, and supporting context. Dense ledger/status patterns use local smaller sizes, rather than redefining the body scale.
- **Figures:** tabular numerals, strong weight, and tighter tracking. Available money, account balances, evidence values, and ledger amounts have distinct sizes for their roles.

**The Complete Amount Rule.** Preserve the currency sign, grouping, and complete amount as a readable unit. At the narrowest breakpoint, reflow comparisons before squeezing figures; exceptionally long totals can scroll within their own amount region.

## Layout

A sticky white header sits above an account rail and flexible route area. Baseline dimensions are a header of (76px) and rail of (276px). The rail grows to (296px) on wide screens and reduces to (246px), then (224px), at intermediate widths. It scrolls within the viewport. The dashboard route splits between a ledger and right insight workspace, approximately (1.72:1), with a minimum insight width of (300px). Other routes reuse the frame without repeating the dashboard composition.

Use the spacing steps in frontmatter. Shared panels use the sixth step, controls the third/fourth steps, and wrapping action groups the third step. White main space, a lightly tinted insight region, fine borders, and surrounding canvas establish work zones.

- **1500px and wider:** grow the rail, headline, main figures, and main-area breathing room.
- **1390px and below:** compact the rail, header, equation, and ledger; hide lower-priority ledger columns where required.
- **1100px and below:** move insights beneath the ledger, keeping evidence/category panels in two columns until the phone layout. General paired panels stack.
- **850px and below:** use a three-row header of (154px). Top navigation remains visible; “Mis cuentas y tarjetas” opens an in-flow account disclosure, scrollable up to (60dvh), which closes after selection. Account groups may use two columns here.
- **600px and below:** stack the funds equation, insights, forms, and source/candidate review. Keep transaction merchant and amount together; put account/date beneath the merchant. The new-movement label remains accessible when its visible control becomes icon-only.
- **360px and below:** stack funds and commitments, keep currency totals intact, stack preview comparisons, and wrap the ledger toolbar.

Use flexible zero-minimum-width containers for long names and evidence. General tables scroll within their container; the dashboard ledger has its own phone presentation. The obsolete bottom navigation and horizontally scrolling account-tile patterns are not the current frame.

## Elevation & Depth

Routine surfaces are flat. Tone, borders, spacing, and a white selected account row provide depth. Standard panels and buttons have no decorative shadow. The native modal is the elevated exception: `--shadow-overlay` is (`0 20px 70px #10245429`), above a translucent ink backdrop (`#0c173080`).

Color and border state changes use `--motion-fast` (160ms) and `--ease-out` (`cubic-bezier(0.16, 1, 0.3, 1)`). Completed review gives the eyes one short acknowledgement (450ms) when reduced motion is not requested. Reduced-motion mode disables transitions and animations.

**The Flat Workspace Rule.** Group routine content with border, tone, and spacing. Reserve the shipped overlay shadow for modal elevation.

## Shapes

Controls use compact `control` corners, panels and the brand tile use `panel`, native dialogs use `large`, and small contextual treatments use `sm`. The eye mark retains its capsule silhouette. Single fine borders define fields and white panels. Badge, icon-tile, and nested-row geometry is local to those patterns; reuse it through the existing component rather than expanding the global radius scale for every detail.

## Components

### Buttons

Reuse `Button` with `primary`, `secondary`, `quiet`, or `danger`. Main buttons use control corners, a minimum height of (44px), frontmatter padding, and an icon/label gap. Labels use (13px), weight (650). Primary hover deepens blue; secondary hover introduces soft blue and a stronger border; quiet hover introduces soft blue. Danger uses its semantic background/text and warm border.

Keyboard focus uses a three-pixel outline with a three-pixel offset on light surfaces. Disabled/busy controls keep their label and describe progress in text. Buttons preserve native submission semantics: set `type="button"` for non-submit actions in forms. Use native links for navigation. Smaller text/icon controls retain their existing local geometry rather than inheriting a fictional universal fixed height.

### Badges

`Badge` supplies `neutral`, `blue`, `success`, `warning`, and `danger` textual markers. Compact padding, modest local corners, and restrained weight keep them secondary. Blue indicates selection/context; semantic variants use the matching foreground/background pair. They are labels, not standalone actions.

### Cards / Containers

`Panel` is white, fine-bordered, flat, and uses panel corners and standard padding. It accepts a title and action via the shared `SectionHeading` arrangement. Phone padding becomes (21px 18px); ledger/review patterns have explicit local spacing.

`EmptyState` centers a line icon, short title, explanation limited to (35ch), and optional next action. Explain the next step before adding personality. Loading, stale data, incomplete evidence, and an empty collection are distinct states.

### Inputs / Fields

`Field` is a native wrapping label with its text above the control and an eight-pixel gap. Inputs, selects, and textareas use white surfaces, fine cool strokes, control corners, ink text, and visible focus. The minimum control height is (44px); textareas start taller and resize vertically. Errors use explicit danger messages with alert semantics where implemented. There is no shared error-outline variant to invent or document.

### Settings editors

`DisclosureEditor` places a native inline disclosure beneath a saved product or attached-card row. Its summary uses the literal action “Editar producto” for the account/card product and “Editar tarjeta” for an attached SMS/Wallet identity; opening it reveals a prefilled form on the primary-soft surface. Saving updates the existing record ID and returns to the compact saved row. Protect opening balances and account types once movements exist, and explain that correction movements preserve financial history.

Saved accounts and credit cards use the shared action “Editar producto”. That editor owns identity, institution, artwork, organization, and every SMS/Wallet card alias attached to the product. Automatic capture owns creation of an alias and the iPhone connection/instructions; it points back to the product editor for later changes.

The opening-balance date is the account's financial snapshot. Older imported movements remain available as history without changing the current balance. Explain that consequence beside account creation and inside the import dialog before confirmation.

The generic COP import accepts signed values. For bank and cash products, positive means money in and negative means money out. Credit cards reverse that interpretation: positive means a purchase and negative means a refund. An explicit type overrides the sign, especially for transfers and card payments. State these rules in the compatible-format help.

The Bancolombia Visa detailed XLSX format uses positive purchases and negative abonos. Present the abono as a bank-to-card transfer when the linked bank is known. The import preview compares it with movements saved before the current file so the owner can omit the matching second record before commit.

The import preview owns statement duplicate decisions. Compare each row only with transactions that existed before the current file, never with another row in the same CSV/XLSX. Show prior matches as explicit opt-in rows: unchecked omits the duplicate, while checked preserves it as another real movement. Statement rows leave the preview as confirmed transactions and never enter Pistas.

Movement rows and import previews expose financial direction separately from status. Show a compact directional label and signed amount for income, expense, purchase, refund, card payment, and transfers. A card abono reads `Pago recibido` with a positive amount when viewed from the card; it remains a transfer in the ledger. `Histórico` only communicates that the row predates the opening-balance snapshot.

The accounts route shows saved products first. Creation, margin/categories, automatic capture, and bills live in a single `Administrar` hub made from native disclosures. Keep these sections collapsed until requested, except `Agregar producto` on an empty account list. A disclosure summary names the job and describes its contents; do not expose every form at once. Automatic capture uses four primary native disclosures: test the iPhone, create its private access, connect the Shortcut, and verify the first evidence received. A final optional disclosure retains later card/alias creation. Product SMS identity belongs in creation and editing, before iPhone setup. Keep the one-time token beside access creation and copyable configuration beside the matching instruction. Arrival shows the latest actual SMS/Wallet evidence and its received time; creating an access alone never means capture is working.

Movement editors keep location optional and collapsed until it has evidence or the owner opens it. Captured iPhone coordinates use the primary blue and display accuracy and capture time. An owner-confirmed Google Place uses success green and may replace the merchant field. Never present captured coordinates as a confirmed business: delayed SMS delivery, online purchases and Watch payments make that inference unsafe.

Movement type controls the category vocabulary. Expenses and refunds show expense categories; income shows its own categories; transfers show no category. When a principal category has children, expose a second optional subcategory control and display the saved path as `Categoría › Subcategoría`. Editing may change type and classification together. Deletion uses an inline confirmation, removes the movement from financial totals, and leaves an undoable audit entry.

### Navigation

The white header combines a citron eye tile, compact wordmark, four user routes, and actions. Active links use blue, heavier text, a blue underline, and `aria-current="page"`. Review counts use separate small markers. Import is contextual to Movements rather than a top-level route. The responsive frame retains top navigation and exposes the account disclosure beneath it.

### Account hierarchy

The ultramarine `AccountRail` uses native institution disclosures, text monograms, and chevrons. Account buttons show type icon, name, literal type label, balance, and `aria-pressed` selection. Selection turns the row white with ink text and a blue symbol tile.

### Product movement register

The Movements route is scoped to exactly one account or card. Its header keeps the product type, name, institution, balance or debt, and total movement count visible. The account rail on desktop and its in-flow disclosure on mobile are the single product switcher; “all accounts” is unavailable here because a mixed ledger obscures the current product.

The ledger always renders its column structure. An empty product uses a table row that says the product has no movements and offers manual entry or import, rather than replacing the register with a generic empty card. Search applies only to the current product and does not change the total movement count. Category and direction filters, import, and the two export formats share one secondary action surface so the ledger remains visible near the top on phones. On phones, each row keeps movement and amount together, with date, category, and status on one predictable metadata line. New movements and the import modal default to the visible product; product exports use that same scope.

Debit instruments indent under their bank account and explain that they use its balance; they have no separate amount. Associated credit accounts retain separate debt in nested rows. Independent credit cards and cash have their own sections. Institutions come from explicit data. The net-worth summary stays distinct from cash and available money. Organization must not duplicate balances; `domain/account-groups.ts` owns these relationships.

### Reports

The time chart exposes exact net amounts on hover, touch, and keyboard arrows (Home/End reach the first/last period). Keep points circular at every viewport and show refunds below a visible zero baseline. Category bars share a common scale, retain negative net refunds, and open the category’s movements when selected; sign, amount, and text carry meaning alongside color.

Reports answer how much was spent, when, where, and in which category for an explicit date range and optional product. Lead with net spending after refunds, then show gross expenses, refunds, and daily average. Follow with a continuous time chart, category/subcategory bars, and ranked merchants. Keep filters visible and provide month, trailing-30-day, and year presets. On phones, preserve the summary grid and stack the analytical panels without horizontal page overflow. Income, transfers, future and deleted movements do not appear as expenses.

### Evidence and available money

The labeled funds-minus-commitments equation leads to a citron global available-total surface with attached freshness/incomplete-evidence context. Selected-account scope belongs to the ledger and category work areas.

Pistas contains only unconfirmed SMS and Wallet Shortcut captures. It compares source/candidate amount, account, and date. Show discrepancies next to an explicit match action. Keep separate/complete, discard, and correction undo identifiable. On phones, source precedes candidate; the narrow dashboard preview also stacks its values. Exact duplicate manual movements use an inline confirmation in the movement form and never create a Pista.

For long evidence queues, keep the durable pending count, resolved count, active filters, resume point, and latest save confirmation visible while the user works. Use a compact heading and progress bar instead of a second pending banner. On phones, expose the group list through an expandable switcher so the focused evidence leads. Search accepts displayed COP amounts, and complete evidence without a candidate says it is ready to register. Its primary action is `Registrar movimiento`; only evidence with a possible existing match offers `Registrar otro movimiento`. A separate secondary button, `Editar antes de guardar`, opens the populated movement form and does not save until the owner submits it. Correction history identifies the merchant, value, account and Bogotá timestamp; details explain the prior state and the effect of undo, without presenting a later revision as the original result. Use a compact, filterable inbox grouped by normalized merchant, amount, account, movement type, and review reason; open one focused comparison at a time. Repeated complete evidence can be previewed and registered in groups of up to 500 as individual movements, with backend writes chunked below storage transaction limits. Equal amount and date remain suggestions only; batch merging is never offered. When candidate evidence conflicts on date, account, or value, emphasize separate registration over merging.

### Icon and Eyes

`Icon` supplies typed inline SVG line icons with a (24-unit) viewBox and rounded strokes. Its SVG is decorative; the enclosing control supplies accessible text. `Eyes` supplies the geometric brand companion and happy variant. Browser, iPhone and installed-app icons reuse the open-eyed companion with its ultramarine capsule on citron; keep the SVG and raster variants aligned. Reuse them for brand, money, setup, and review contexts while keeping the financial information literal.

## Do's and Don'ts

### Do:

- **Do** reuse live tokens, shared primitives, and the catalog before adding a visual variant.
- **Do** preserve white top navigation, the ultramarine hierarchy, heavy Inter headings, and the citron global available amount.
- **Do** use tabular COP figures, explicit financial scope, and complete amounts at narrow widths.
- **Do** pair status color with text and distinguish stale/incomplete data from an empty state.
- **Do** preserve native controls, visible focus, accessible labels, and reduced-motion behavior.
- **Do** update the catalog, this reference, and its sidecar when a repeated pattern enters the shared system.

### Don't:

- **Don't** replace the approved hierarchy with the rejected generic pastel helper-card composition.
- **Don't** give debit instruments separate balances or make associated credit debt look like shared cash.
- **Don't** imply bank synchronization, autonomous matching, or complete evidence through visual state or copy.
- **Don't** ship example balances, fabricated analytics, unverified bank logos, or raster interface panels as real product data or UI.
- **Don't** add decorative shadows to routine panels or replace the display family without an approved system change.
- **Don't** clip, split, or hide a financial amount to preserve a desktop row on a narrow screen.

### Cash, pockets and investments

Keep Efectivo, Bolsillos and Inversiones as distinct account-rail sections and product types. The global available equation includes eligible bank/cash balances, while pocket and investment balances are separate holdings below the equation. Label pocket money `Disponible en bolsillos` and investment money `Dinero en inversiones`; neither is part of the global available amount. Moving money in or out uses a transfer, avoiding a second expense or income. Pocket and investment forms expose optional SMS destination aliases (names or masked suffixes only), allowing compatible complete SMS to register an unambiguous owned transfer automatically; uncertain captures remain in Review. Initial balances must already be separate from other product balances.

Cash products expose `Recibir efectivo`, opening a normal income form already scoped to that cash product. Complete, unambiguous ATM SMS transfers automatically into cash and leaves an undoable correction; uncertain captures stay in Revisar. A statement withdrawal keeps import-preview confirmation. Multiple cash accounts require an explicit automatic-withdrawal destination in settings.

Each investment has a collapsed `Actualizar valor de inversión` form and a dated value history. Explain that values are declared manually and automatic profitability is unavailable. Keep declared adjustments separate from contributions, withdrawals, cash and expense/income reports. History shows prior value, declared value, adjustment, note and annulled state, with undo for the latest active valuation.


Manual investment contributions offer existing investment products or inline product creation in the movement modal. The new product name defaults to the merchant until the owner changes it, starts at zero, and is saved atomically with the transfer. An explicit remember option saves the merchant, compatible category and investment destination for future CSV/XLSX imports, including the original merchant name when renamed. Import preview displays this classification before duplicate comparison and confirmation; its classification is retained through commit. Only transactions existing before upload are duplicate candidates, and repeated equal rows within one file remain independent.

Investment entry is hierarchical: choose Inversión in the expense-category selector, then select an existing investment product or create one inline. It is stored as a transfer, without requiring a separate investment movement type.

App and favicon assets reuse the complete Conecta las pistas eye mark with its dark capsule, rotated −12 degrees in the lower-right corner on primary blue (#1949db). Maskable variants inset the eyes slightly to preserve them within platform cropping. Keep the same identity across SVG favicon, Apple touch icon and regular/maskable PWA icons.

Icon backgrounds add a restrained white-outline coin, receipt and short dotted evidence trail at 16% opacity. Keep this supporting texture behind the corner eye mark, never competing with it.

The frontend shares the icon’s evidence-trail language through `EvidenceTrail`: coins, wallet and receipts for funds; receipts, search and cards for evidence; pockets, coins and growth for holdings. Use low-opacity primary outlines in reserved heading/empty-state space and white outlines alongside the rail mascot. Do not overlay values, tables, controls or error messages. Decoration is static, noninteractive and hidden from assistive technology; at the narrowest widths omit heading motifs to preserve text. The catalog documents every variant. Pocket and investment products have their own semantic icons.

Product creation leads with type, name, opening balance and date. Show “Cómo aparece en tus SMS” for every non-cash product, accepting names or masked suffixes only. Bank creation offers an optional inline debit card: it points to the same bank balance and is saved atomically with the product. Keep institution, artwork, organization and available-money preference in “Más opciones”. Existing products expose SMS identification status without claiming capture is connected; Editar producto retains alias editing and adding another debit card later. The iPhone connection is shared across products and never requires configuring the same alias again.

Expense category icons distinguish subscriptions (playback screen), online shopping (cart), shopping (bag), loans (document/clock), bank fees (bank/charge), internet (Wi-Fi) and phone service (phone). Their subcategories share the parent symbol, with visible category text carrying the exact label.

On iPhone-sized screens, forms keep native date pickers but explicitly contain their intrinsic width and align their values left. Use 16px input/select text, 44px select targets, and no cumulative indentation in nested product/card editors. Long product names wrap; balances and movement search/filter actions reflow into their own rows. At 420px and below, reports stack dates and summary figures. Buttons may wrap; never clip whole-page overflow to conceal a layout defect. Local WebKit regressions cover 320–430px; real-device verification remains distinct.

The mobile movement register reserves 18px side gutters independently of generic scroll-table styles. Use explicit block table sections with grid rows in WebKit: merchant and complete amount on top, notes/direction/date/category/status across the full row below. At 360px and narrower stack the amount beneath the merchant. Long names wrap; row separators span the content width and never touch the container edge. Desktop keeps its column layout. Regression checks assert gutter size, row bounds, complete text and editor access with long synthetic merchant names and large amounts.

Captured-location UI separates address, coordinates, sample time and optional precision from confirmed merchant identity. Use MapLibre for the primary map with blue evidence markers, green confirmed-place markers and visible provider attribution. Keep Apple Maps / Google Maps links usable if rendering fails. Postal components live in a collapsed details section; do not make location or map loading a prerequisite for saving. Capture setup documents a single request containing the optional location dictionary.

All movement editors, including manual creation and Review before-save correction, expose the same PlacePicker. Search opens Google Maps by merchant/city without requiring a browser key; paste a place link or enter coordinates and explicitly choose it. Camera-center links require an extra confirmation. The confirmed location remains separate from original Shortcut evidence. Show the selected place, coordinates, editable name and remove action; saving the movement persists the choice. Unsupported links show a recoverable inline error and retain the prior selection.

Location maps reserve the same frame height while loading, ready or failed. Render status messages inside that frame so provider errors never shift the movement-save controls during a touch interaction.


La edición de ubicación muestra solo enlace de Google Maps, latitud, longitud y mapa siempre presente. Resolver el enlace al pegarlo o salir del campo actualiza la vista; los centros aproximados requieren confirmación. Sin coordenadas se ofrece «Usar mi ubicación», únicamente por acción explícita y con permiso del navegador. La evidencia original del atajo queda en un desplegable y se conserva al corregir el lugar. Guardar el movimiento confirma los cambios.

Los enlaces compartidos de Google solo pueden situar un punto mediante coordenadas explícitas o datos de entidad ligados al mismo feature ID/CID del enlace. Nunca usar centros de imágenes de vista previa o de la cámara del servidor: pueden señalar otro país. Sin coincidencia verificable, mostrar el error y conservar la selección anterior, o el mapa sin pin si no había ubicación. Solo los centros explícitos de una URL escrita por el usuario requieren confirmación como aproximados. Pegar un enlace y después salir del campo no debe reiniciar una resolución ya completada.

Merchant location reuse is opt-in and independent from category/note memory. Within the location section, offer “Recordar esta ubicación para próximos movimientos de este comercio” and, for saved movements, “Aplicar esta ubicación a todos los movimientos de este comercio”. The latter replaces the chosen place in active matching movements; only the remember checkbox changes the future default; keep phone evidence unchanged. State that a shared name should identify the same branch. Show remembered coordinates in the editor, let a per-movement selection or removal override them, and retain checkbox choices when the section is collapsed. Bulk-location success copy names location rather than category. Never create a merchant-location rule from phone capture coordinates automatically.
