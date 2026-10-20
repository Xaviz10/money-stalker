# Money Stalker

## Platform

web

## Product purpose

Personal finance for Colombia: follow spending, reconcile captured evidence with statements, and understand money available after credit cards, upcoming bills, and a protected reserve.

## Users and context

The current project serves the owner's personal finances. The broader project plan includes household use. The interface is Spanish, uses COP, and uses America/Bogota for dates. It runs on desktop and mobile web.

## Current capabilities and constraints

The implementation supports accounts, manual movements, CSV/XLSX import with preview, SMS/Wallet evidence, suggested matches with user confirmation, correction history and undo. Money calculations are deterministic. The Bancolombia quarterly savings-account XLSX profile is verified against three original 2025 statements. The Bancolombia SMS parser is verified against the supplied purchase, QR payment, account payment and transfer messages. This is file and message-format support, not bank synchronization; automatic device capture still requires device-specific verification. Do not imply complete evidence or autonomous financial decisions.

Categories have one optional subcategory level and an explicit expense or income scope. Manual creation and editing show only choices compatible with the movement type. Deleting a movement is an audited soft deletion: it stops affecting balances and reports and can be restored from correction history.

Reports provide a compact spending analysis for a custom period and optional account: net spending after refunds, gross expenses, refunds, daily average, a time trend, category/subcategory distribution, and leading merchants. Income, transfers and deleted movements stay outside expense totals.

## Import and capture rules

The importer detects the verified Bancolombia savings statement or the COP interchange format. Repeated page headers and statement metadata are skipped, while dated movement rows are preserved. Signed statement amounts use exact minor-unit arithmetic. Credit-card payments and transfers to a configured owned account are transfers, so they do not become expenses twice. A transfer without a configured owned destination is an expense.

Import is part of the selected product’s Movements register, not a separate destination. The modal fixes the destination to the visible account or card, shows a preview, and requires confirmation before adding rows. Possible duplicates are compared only with movements saved before the current file; equal rows within that file retain their multiplicity. The owner can omit or explicitly keep each match in the preview. Statement imports never create Pistas. Exports from this register are scoped to the same product, including transfers where it is either the source or destination.

Bancolombia SMS capture reads masked source suffixes, amounts, transaction dates and merchant or destination descriptions from text delivered by an iPhone Messages Shortcut. Screenshots are parser references only. A separate Wallet transaction Shortcut sends structured fields exposed by the device. Account and card suffixes resolve through instrument aliases. Store only masked suffixes configured by the owner at runtime, never full account or card numbers. OTP and security messages remain excluded before persistence.

Both Shortcuts attempt a one-time location sample. Preserve coordinates, accuracy and the location timestamp after reconciliation and in exports. Location is optional supporting evidence, never a reason to drop a capture or automatic proof of merchant identity.

Pistas contains only unconfirmed SMS and Wallet Shortcut captures. A manual movement with an exact prior match asks for confirmation in its form and never enters Pistas.

Transactions may also store an owner-confirmed Google Place with its place ID, display name, address and coordinates. The movement editor centers the map on Shortcut evidence, lets the owner search or tap a visible business, and uses that selection as the merchant name. Captured coordinates and a confirmed place remain distinct: the first records where the phone was when the automation ran; the second records the business the owner selected.

## Brand commitments

The user likes MoneyWiz's design and financial organization. The user explicitly selected the Accounts first preview after rejecting a generic card-based sidekick design. Preserve the curious eye mark, top navigation, blue account rail and expressive financial typography. The user requested a shared design system for current and future improvements. Financial labels and warnings must stay understandable. The user controls evidence matching.

## Evidence

Current product implementation is in src/App.tsx, src/finance/, src/design-system/, domain/, and server/. The initial plan is in docs/INITIAL_PLAN.md. No claims about bank integrations or future capabilities should be inferred from the plan.

## Account and card organization

Bank institutions group bank accounts. A bank account holds a cash balance and can have multiple debit instruments pointing to that balance. A credit account holds a separate debt balance and may optionally link to a bank account for organization. Credit-only setups are supported; no bank account is required. Organizing a card must not alter or duplicate balances.

## Cash, pockets and investments

A complete Bancolombia ATM-withdrawal SMS with an exact configured bank alias, a financial date on/after the source and destination opening snapshots and no possible prior match is automatically recorded as a bank-to-cash transfer. Create the zero-opening Efectivo product if there is no cash account; reuse the only cash product or the configured cash destination. Multiple destinations, incomplete/historical captures and possible matches require Review. Stable event IDs remain idempotent; linked observations, location, and undo history are retained. Verified savings statement rows explicitly described as ATM withdrawals are previewed as transfers to the same cash destination before confirmation.

Receiving cash for another concept is a normal income into a cash account; it increases cash and eligible available money. ATM withdrawals themselves do not create expense or additional available money.

Bolsillo and Inversión are separate asset products. For manual movements, the owner explicitly chooses any source account, including cash, and the destination product; no SMS is required. Fund and release them with transfers; compatible SMS with an exact configured source and unambiguous owned destination name or masked-suffix alias can record the transfer automatically, while uncertain captures stay in Review; their balances remain outside global available money and inside net worth. Initial amounts represent money already separate from other account balances. The summary shows cash, money available in pockets, and money in investments as distinct totals.

Investment values are declared manually, with a dated history of before/declared values, adjustment, note and record time. Adjustments affect the investment balance and net worth, never liquid available money or income/expense reports. Contributions and withdrawals remain transactions. There are no market prices, forecasts or automatic return calculations. Valuations are entered in date order, retried idempotently, persisted independently, exported, and the latest active valuation can be reversibly annulled.


Manual investment contributions offer existing investment products or inline product creation in the movement modal. The new product name defaults to the merchant until the owner changes it, starts at zero, and is saved atomically with the transfer. An explicit remember option saves the merchant, compatible category and investment destination for future CSV/XLSX imports, including the original merchant name when renamed. Import preview displays this classification before duplicate comparison and confirmation; its classification is retained through commit. Only transactions existing before upload are duplicate candidates, and repeated equal rows within one file remain independent.

Investment entry is hierarchical: choose Inversión in the expense-category selector, then select an existing investment product or create one inline. It is stored as a transfer, without requiring a separate investment movement type.

The approved visual identity extends the tilted eye companion with faint coins, receipts, pockets and financial evidence trails across the frontend. These are decorative brand details; they do not imply extra transactions, analysis or evidence.

Initial product setup includes the SMS alias on each non-cash product. A bank may include its debit card in the same atomic save, sharing one balance; debit cards can also be added later from the product editor or capture setup. Product identity and shared iPhone connection remain distinct. Optional institution/artwork/organization settings are collapsed to keep the opening setup short.

Default expense categories include Suscripciones (Netflix, Prime, Disney, ChatGPT, Google, Spotify), Compras online (Electrónicas, Ropa, Hogar), Compras (Electrónicas, Ropa, Antojos), Créditos (Vivienda, Carro, Libre inversión, Otros) and Gastos bancarios (Cuota de manejo, Intereses). Domicilios includes Mercado, Farmacia and Restaurantes. Servicios separates Internet from Telefonía. Internet retains the former combined category ID, preserving existing movement and merchant-rule references; historical combined charges are not inferred or split automatically. All new children inherit expense scope and use the existing single-level hierarchy.

SMS/Wallet captures may include optional full address/components and a source URL with the location sample in the same capture request. Precision is optional and never fabricated. MapLibre displays the recorded coordinates with OpenStreetMap tiles by default; links open the same coordinates in Apple Maps or Google Maps. Google business confirmation remains optional and separate. Rich location evidence survives reconciliation and exports.
