# iPhone capture feasibility experiment

Purpose: prove that Money Stalker can reduce forgotten transactions before investing in the complete interface. The server contracts and Bancolombia SMS parser are implemented and tested with supplied examples. The screenshots were format references only. The SMS and Wallet Shortcuts themselves, their available fields and locked-device behavior have not yet been verified on the owner's iPhone.

The concrete server payloads are documented in [SHORTCUT_CAPTURE.md](SHORTCUT_CAPTURE.md).

Budget: use Shortcuts and a small authenticated AWS endpoint or an existing controlled test endpoint. Do not send financial payloads to a public request-inspection service. A native developer membership is outside the initial under-US$5/month operating budget.

## Inputs

- Actual iPhone model, iOS version, region, notification privacy settings, and any Apple Watch payment usage.
- Card/account identifiers represented by aliases or masked suffixes, including any difference between Wallet and physical-card suffixes.
- Redacted examples of purchase, transfer, receipt, refund and security/OTP messages.
- Original-format bank CSV/XLSX examples with fake names/account numbers but preserved layout and useful matching fields.

Keep bank credentials, OTPs, full card numbers, real statements and private messages out of Git and external documentation queries.

## Three capture experiments

1. **Wallet:** configure the card-tap transaction trigger. Inspect its supplied fields rather than assuming amount, merchant or currency exists. Try a normal purchase and any routinely used Watch/online payment route separately.
2. **Messages:** configure sender/content filters for bank transaction messages. Establish whether the message body reaches the shortcut, whether it executes without interaction, and whether the filters exclude login/security messages.
3. **Notifications:** only if the installed version exposes the trigger, select Bancolombia/Nequi and inspect the available payload. Test hidden previews and locked-device behavior. Record unsupported behavior explicitly.

For all three, capture the event first and enrich it with optional location without blocking delivery. If an amount or account is unknown, preserve an incomplete observation for review rather than inventing a value.

## Event contract to validate

Use a stable event ID generated once and retained on retry, device ID, source type, observed/received timestamps, source-provided transaction time if available, account/card hint, amount/currency when supplied, merchant/recipient text when supplied, and parser/schema version. Location has its own timestamp and accuracy.

Authenticate with a revocable device token scoped to capture only. Reject excessive payloads, invalid tokens and unsupported formats. Report success only after the server has durably saved the observation and its processing marker. Do not place credentials in URLs.

Test whether Shortcuts can persist an unsent event on this actual device. Do not assume iOS grants arbitrary background execution or eventual retry. If local persistence cannot be made reliable, provide a visible failure notification and a resubmission action; use statements to recover missed events. A PWA background queue is also not an unconditional delivery guarantee.

## Validation matrix

| Test | Evidence to record |
| --- | --- |
| Phone unlocked / locked | Trigger fires, available fields, permissions, receipt time |
| First use / permission already granted | Setup friction and any confirmation dialogs |
| Focus mode / hidden previews / low power | Capture and notification behavior |
| Offline / server unavailable / timeout after save | Failure visibility, persistence, safe replay |
| Location allowed / denied / slow / inaccurate | Capture still succeeds; timestamp/accuracy preserved |
| SMS delayed after leaving the merchant | Location does not become a falsely certain merchant identity |
| Same purchase reported by Wallet and SMS | Two observations, one purchase |
| Two same-value purchases close together | Distinct purchases survive matching |
| Statement arrives days later | Correct posting match; user's merchant/category preserved |
| Refund / cancellation / security message | Correct reversal or ignored nontransaction message |
| Wife's phone later | Separate setup, separate token and access boundary |

## Completion decision

Observe 20–30 representative real transactions over roughly one to two weeks, using the eventual statement and a minimal temporary checklist as ground truth. Do not manufacture unnecessary purchases to reach a sample size. Initial setup/analysis is a 3–5 day effort; observation can overlap other work.

Measure coverage by channel, capture latency, missing fields, manual steps, duplicate observations, false matches, and delivery failures. A proposed useful target is at least 90% hands-free capture for the specific channels declared supported, with zero false merges in this small validation sample. It is a starting criterion, not statistical proof of reliability.

Classify each channel as automatic, assisted, or unsupported. Keep routes with acceptable reliability. If the main Bre-B/Nequi route fails, evaluate whether a one-tap note plus unchanged-statement import is sufficient before expanding the product. Do not advertise universal iPhone transaction capture.

References: [Apple transaction triggers](https://support.apple.com/guide/shortcuts/apd65c67538a/ios), [message triggers](https://support.apple.com/guide/shortcuts/apdd711f9dff/ios), [automatic execution](https://support.apple.com/guide/shortcuts/apd602971e63/ios), [current event triggers](https://support.apple.com/guide/shortcuts/apd932ff833f/ios), [iOS 26 event triggers](https://support.apple.com/guide/shortcuts/apd932ff833f/9.0/ios/26).
