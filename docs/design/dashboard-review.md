# Dashboard and review surface brief

Mode: Operate.

Approved direction: playful sidekick. Approved scope: dashboard and review first.

The user should feel accompanied in finding where their money went. Keep the MoneyWiz-inspired financial organization, with more personality in the companion and completion moments. The dashboard answers what is available, what needs attention, and where money went. The review connects evidence to a movement with enough context to make a confident decision.

Important states: initial load, load failure, stale refresh, no accounts, no movements, negative available amount, missing evidence value, pending candidate, mismatched amount/date, action in progress/error, cleared queue, correction undo, and mobile layouts. No sample data is shipped as user data.

## Approved Accounts first replacement

The user rejected the first implementation, then explicitly selected the Accounts first preview (`.impeccable/mocks/accounts-first.png`). This is the active composition reference: white top navigation, ultramarine account rail, primary ledger area, and right review/category workspace. Build path: code-led (Operate). The earlier comp-led draft metadata is archived because its asset gates do not apply to this code-led product screen. No raster UI is shipped.

New confirmed requirement: bank accounts can own debit instruments and associated credit accounts. A credit account can also exist independently. Association organizes the UI; debit instruments do not create balances and credit cards retain separate debt.

THESIS: recognizable account management, expressive but precise financial typography, and an eye companion that helps inspect evidence.
OWN-WORLD: ultramarine account rail, white workspace, ink type, citron available funds, blue actions, semantic green/amber/red states.
FIRST VIEWPORT: top navigation; grouped accounts at left; global funds minus commitments and available in the main work area; recent activity below; pending evidence and category spending at right.
SIGNATURE: account selection narrows the activity and spending work areas while the global available amount stays explicitly labeled as total across accounts.
FORM: preserve the selected reference's spatial hierarchy; use real components, native controls, a single typography family and token-driven styling.
