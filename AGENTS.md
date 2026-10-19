# Money Stalker project steering

These instructions apply to the whole repository.

## Release approval

- Never push commits, tags or branches to any remote without the owner's explicit approval for that specific push.
- Never start, trigger or promote a deployment to Vercel, AWS or any other environment without the owner's explicit approval for that specific deployment.
- A request to implement, fix, test or continue work authorizes local changes and verification only. It does not authorize a push or deployment.
- Prepare the complete reviewable result first: make the local changes, run the relevant checks, and report the changed files, test results and any material risks. Then ask for approval to push or deploy.
- Approval from an earlier task does not carry over to a later push or deployment. Automatic deployment from `main` means approval to push to `main` is also approval to trigger that deployment; state this consequence when requesting approval.
- Local commits are allowed when useful for review, but keep them local until the owner explicitly approves the push.

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
- A credit-card purchase creates expense plus card debt. Paying the card is a transfer that reduces cash and debt.
- Moving money between the owner's Bancolombia, Nequi or other accounts is a transfer. Paying another person or merchant through those rails is an expense unless the owner confirms an internal destination.
- Uncertain destinations, matches or incomplete captures go to Review. Do not invent missing values or silently merge ambiguous observations.
- Store COP in integer minor units and preserve date-only financial dates separately from received and location timestamps.

## Privacy and verification

- Keep original statements, SMS bodies, screenshots, coordinates, tokens and personal identifiers out of Git and external documentation services. Tests use synthetic or redacted fixtures.
- Never hardcode deployment credentials, account IDs, personal email addresses, real masked account/card suffixes or absolute home-directory paths. Runtime secrets belong in AWS or local ignored files; public frontend configuration belongs in deployment environment variables.
- Run `npm run check:secrets` before a commit intended for a remote repository. Exported `.shortcut` files can contain tokens and must remain ignored.
- Use original private files only for local read-only validation when the owner supplies them.
- Preserve offline/retry idempotency, locked-phone behavior, location-denied behavior and statement reconciliation tests when changing capture.
- The device experiment in `docs/IOS_CAPTURE_SPIKE.md` remains required before claiming hands-free capture reliability. Parser tests do not prove that iOS runs every automation reliably.

