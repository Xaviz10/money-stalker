# Money Stalker

A personal finance app for Colombia, starting with one person and growing to a household.

The aim is to capture spending with minimal effort, reconcile it with bank statements, and make credit-card commitments, upcoming bills, mortgages in UVR or pesos, and major purchase decisions easier to understand.

**Current stage:** working application with local and AWS-backed server implementations.

Current import support includes the verified Bancolombia quarterly savings-account XLSX export and a COP interchange CSV/XLSX format. Bancolombia SMS evidence can extract card purchases, QR payments, account payments and transfers using masked account/card aliases. Every file is previewed before commit. Its possible duplicates are compared only with previously saved movements and resolved there; Pistas is reserved for unconfirmed SMS and Wallet Shortcut captures.

- [Initial product and implementation plan](docs/INITIAL_PLAN.md)
- [iPhone capture feasibility test](docs/IOS_CAPTURE_SPIKE.md)
- [iPhone Shortcut capture contract](docs/SHORTCUT_CAPTURE.md)
- [Google Maps setup](docs/GOOGLE_MAPS.md)
- [Loan affordability and ChatGPT integration](docs/DECISIONS_AND_CHATGPT.md)

Proposed foundation: React and TypeScript, an installable web app, iPhone Shortcuts, and a small AWS serverless backend. The household operating budget is **less than US$5/month**, with free service allowances preferred. Financial calculations work without AI; a financial-summary export and then an authenticated ChatGPT connection are the preferred conversational interfaces. Embedded paid AI remains optional.

## Repository safety

Keep credentials, device tokens, real statements, SMS bodies, coordinates, personal identifiers and exported iPhone Shortcut files out of Git. Local `.env*`, `.local/`, `private/`, CDK output and common key formats are ignored. Deployment configuration is supplied through the hosting platform and AWS CDK context. Run `npm run check:secrets` before pushing.
