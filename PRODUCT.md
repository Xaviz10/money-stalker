# Money Stalker

## Platform

web

## Product purpose

Personal finance for Colombia: follow spending, reconcile captured evidence with statements, and understand money available after credit cards, upcoming bills, and a protected reserve.

## Users and context

The current project serves the owner's personal finances. The broader project plan includes household use. The interface is Spanish, uses COP, and uses America/Bogota for dates. It runs on desktop and mobile web.

## Current capabilities and constraints

The implementation supports accounts, manual movements, CSV/XLSX import with preview, SMS/Wallet evidence, suggested matches with user confirmation, correction history and undo. Money calculations are deterministic. The Bancolombia quarterly savings-account XLSX profile is verified against three original 2025 statements. The Bancolombia SMS parser is verified against the supplied purchase, QR payment, account payment and transfer messages. This is file and message-format support, not bank synchronization; automatic device capture still requires device-specific verification. Do not imply complete evidence or autonomous financial decisions.

## Import and capture rules

The importer detects the verified Bancolombia savings statement or the COP interchange format. Repeated page headers and statement metadata are skipped, while dated movement rows are preserved. Signed statement amounts use exact minor-unit arithmetic. Credit-card payments and transfers to a configured Nequi account are transfers, so they do not become expenses twice. Ambiguous or unresolved destinations stay in Review.

Bancolombia SMS capture reads masked source suffixes, amounts, transaction dates and merchant or destination descriptions from text delivered by an iPhone Messages Shortcut. Screenshots are parser references only. A separate Wallet transaction Shortcut sends structured fields exposed by the device. Account and card suffixes resolve through instrument aliases. Store only masked suffixes configured by the owner at runtime, never full account or card numbers. OTP and security messages remain excluded before persistence.

Both Shortcuts attempt a one-time location sample. Preserve coordinates, accuracy and the location timestamp after reconciliation and in exports. Location is optional supporting evidence, never a reason to drop a capture or automatic proof of merchant identity.

## Brand commitments

The user likes MoneyWiz's design and financial organization. The user explicitly selected the Accounts first preview after rejecting a generic card-based sidekick design. Preserve the curious eye mark, top navigation, blue account rail and expressive financial typography. The user requested a shared design system for current and future improvements. Financial labels and warnings must stay understandable. The user controls evidence matching.

## Evidence

Current product implementation is in src/App.tsx, src/finance/, src/design-system/, domain/, and server/. The initial plan is in docs/INITIAL_PLAN.md. No claims about bank integrations or future capabilities should be inferred from the plan.

## Account and card organization

Bank institutions group bank accounts. A bank account holds a cash balance and can have multiple debit instruments pointing to that balance. A credit account holds a separate debt balance and may optionally link to a bank account for organization. Credit-only setups are supported; no bank account is required. Organizing a card must not alter or duplicate balances.
