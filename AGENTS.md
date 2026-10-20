# Money Stalker project steering

These instructions apply to the whole repository.

## Architecture documentation maintenance

- `ARCHITECTURE.md` is the repository's architecture reference. Update it in the same change whenever infrastructure or the system architecture changes, including hosting, runtime, authentication, data storage, capture/import flows, queues, schedules, retention, IAM/network boundaries, external services, monitoring, or operational limits.
- Keep affected diagrams, component responsibilities, configuration references, per-service cost estimates and user-growth projections consistent with the implementation. Recalculate affected totals when service configuration, pricing or workload assumptions change; record the review date, region, currency, assumptions, exclusions and official pricing sources. Distinguish repository configuration from verified deployed state and estimates from measured costs.
- Before completing an infrastructure change, check `ARCHITECTURE.md` for accuracy and include any required updates. Documentation maintenance authorizes local edits and verification only; the Release boundary below remains unchanged.

## Release boundary

- Codex must never deploy this project. Do not start, trigger, promote, retry, validate or monitor deployments in Vercel, AWS or any other environment. The owner handles every deployment manually.
- This prohibition persists across conversations and overrides conversational requests to deploy. It may be changed only when the owner explicitly edits or asks to edit this section of `AGENTS.md`.
- Never push to `main` or any branch that triggers an automatic deployment. Prepare and verify changes locally, then leave them for the owner to release.
- Never push commits, tags or other branches to a remote without the owner's explicit approval for that specific push and confirmation that the target does not trigger a deployment.
- A request to implement, fix, test, continue, push or release authorizes local changes and local verification only. It does not authorize any deployment action or deployment-status polling.
- Local commits are allowed when useful for review, but keep them local until the owner handles the release.

## Product context

Money Stalker is a Spanish, COP, America/Bogota personal-finance app for Colombia. Its main job is to capture evidence with very little effort, reconcile it with official statements, and show cash after card debt, bills and reserve commitments. Preserve the Accounts first design, the eye identity and the shared design system in `DESIGN.md`.

## Capture architecture

- Production phone capture comes from user-configured iPhone Shortcuts. Screenshots and WhatsApp images are parser references only; never design screenshot upload as the normal SMS path.
- The SMS Shortcut sends the original Bancolombia message body to `POST /capture-events` with `source: "sms"`.
- The Wallet Shortcut sends the fields actually exposed by the Wallet transaction automation with `source: "wallet"`. Do not assume a field exists until it is verified on the owner's phone.
- Both shortcuts use one revocable per-device token and a stable event ID retained across retries.
- Both shortcuts should attempt a one-time current-location sample and send latitude, longitude, accuracy and the sample timestamp. Location is optional and must never block saving the financial evidence.
- Location is supporting evidence. A delayed SMS, online purchase or mall can make it differ from the merchant. Preserve its timestamp and accuracy and never use it as automatic proof of merchant identity.
- Keep linked location evidence visible on the movement and in exports. Do not discard it when SMS, Wallet and statement observations reconcile.
- OTP, login, password and security messages must be rejected before persistence. Never store full account/card numbers or credentials; use masked suffix aliases.

## Financial semantics

- A source observation is evidence; a transaction is the canonical financial event.
- Wallet, SMS and statement observations may describe one purchase. Never count them as separate expenses after reconciliation.
- Only SMS and Wallet captures from iPhone Shortcuts may enter Review. Statement rows are confirmed in the import preview, and manual movements resolve possible duplicates inside the movement form.
- Compare an imported row only with transactions that existed before its file was uploaded. Preserve repeated equal rows inside one CSV/XLSX because they can represent separate real movements.
- A credit-card purchase creates expense plus card debt. Paying the card is a transfer that reduces cash and debt.
- Moving money between the owner's Bancolombia, Nequi or other accounts is a transfer. Paying another person or merchant through those rails is an expense unless the owner confirms an internal destination.
- Uncertain matches or incomplete Shortcut captures go to Review. A Shortcut transfer without a configured owned destination becomes an expense. Do not invent missing values or silently merge ambiguous observations.
- Store COP in integer minor units and preserve date-only financial dates separately from received and location timestamps.
- Keep expense/refund categories separate from income categories. A subcategory inherits the scope of its parent, and movement editors must show only compatible choices.
- Deleting a movement removes it from balances and reports through a reversible, audited soft deletion; never erase its financial history silently.
- Expense reports use posted and provisional expense/refund movements in the selected date range. Refunds reduce spending; income, transfers, future dates and deleted movements do not count as expense.

## Privacy and verification

- Keep original statements, SMS bodies, screenshots, coordinates, tokens and personal identifiers out of Git and external documentation services. Tests use synthetic or redacted fixtures.
- Never hardcode deployment credentials, account IDs, personal email addresses, real masked account/card suffixes or absolute home-directory paths. Runtime secrets belong in AWS or local ignored files; public frontend configuration belongs in deployment environment variables.
- Run `npm run check:secrets` before a commit intended for a remote repository. Exported `.shortcut` files can contain tokens and must remain ignored.
- Use original private files only for local read-only validation when the owner supplies them.
- Preserve offline/retry idempotency, locked-phone behavior, location-denied behavior and statement reconciliation tests when changing capture.
- The device experiment in `docs/IOS_CAPTURE_SPIKE.md` remains required before claiming hands-free capture reliability. Parser tests do not prove that iOS runs every automation reliably.

