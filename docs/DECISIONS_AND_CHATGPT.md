# Loan affordability and ChatGPT integration

Planning extension, October 17, 2026. Requested scope: mortgages in both UVR and pesos; natural-language purchase/credit questions; a low-cost connection to ChatGPT. No connector, financial calculation or bank eligibility check has been implemented yet.

## Product behavior

Example request: “We own a Mazda 3 and want to buy a Subaru Crosstrek 2024. Can we afford a loan for that?”

The app should identify the missing inputs, calculate the household impact, and explain the options. It can assess affordability from the user's records and supplied assumptions. It cannot determine bank approval without the bank's underwriting decision. Do not invent credit scores or approval probabilities.

The same capability should later support questions such as “Should I increase my mortgage payment or save for the car?” and “What purchase price would preserve our cash reserve?” These are scenario comparisons; no universal percentage-of-income rule should override the actual household budget.

## Required data and assumptions

| Area | Inputs |
| --- | --- |
| Household | Net reliable income and dates; variable income separately; essential spending; card commitments; existing debts; known annual expenses; savings goals and chosen reserve |
| Current Mazda | Whether it will be sold or retained; realistic sale/trade-in quote; outstanding loan settlement; selling/transfer costs; current ownership expenses |
| Proposed Subaru | Specific 2024 variant and condition, dated local asking/negotiated price, upfront costs, purchase date, expected ownership period |
| Financing | Cash down payment, loan quote, rate and convention, term, fees/insurance, payment dates, any balloon payment or variable-rate condition |
| Evidence | Quote/source dates, last reconciled account dates, months of usable history, known omissions, and whether values are confirmed or estimated |

Use actual offers or user-supplied scenarios. A vehicle's model/year alone is insufficient to price it. Optional later market research can provide dated comparable listings; advertised prices remain estimates, and live search costs are outside the initial calculator. Inspect at least several representative months when available and include annual/seasonal expenses. If the history is too short, collect a manual budget and label the result provisional.

Only include household accounts/income the requesting user is authorized to see. Unknown private balances are not zero and cannot silently become available cash.

## Calculation model

1. Reconcile existing balances and identify reserved cash, unpaid card purchases and scheduled obligations.
2. Compute net Mazda sale proceeds after outstanding debt and selling costs. Negative equity is a funding shortfall, not a positive down payment.
3. Build a dated funding schedule: new-car price and acquisition costs versus sale proceeds, available cash and proposed loan disbursement. If the Mazda sells later, model that timing gap. Distinguish costs paid in cash from costs the lender agrees to finance; do not assume the whole shortfall is financeable.
4. Calculate the proposed loan schedule using a reusable loan engine. For a standard constant-payment COP loan, use the effective period rate derived from the quote; handle zero interest, fees and rounding explicitly. Unsupported balloon/grace/variable-rate structures require their own schedule rather than silently using the standard formula.
5. Compare the household cash forecast before and after the change. Remove the Mazda's future loan payments only when its debt is settled. If the Mazda is sold, replace its running costs with the Subaru's; if it is retained, include both.
6. Include SOAT, comprehensive insurance, vehicle taxes, fuel, maintenance, parking and one-off costs. Show monthly planning provisions and actual due-date cash requirements without charging both twice. Depreciation can appear in economic ownership cost but is not a monthly cash payment.
7. Stress the plan with explicit scenarios: lower income, higher expenses, repairs, delayed sale, or higher UVR mortgage payments. Stress a new loan's interest rate only if its contract allows the rate to change; do not make a fixed peso loan fluctuate with IPC.
8. Compare keep/replace/keep-both/wait options with the same household assumptions. Solve for a financing amount or purchase budget that respects the selected reserve and cash-flow constraints, and show which constraint limits it.

Bancolombia's vehicle-credit guidance highlights both financing term/total interest and ownership expenses beyond the installment. Use these as cost categories, not as evidence that this user qualifies for a particular credit product. [Vehicle credit and ownership costs](https://blog.bancolombia.com/vida-cotidiana/cuanto-credito-necesitas-para-comprar-carro-calcula-tu-cuota-gmcv/)

Each result should show proposed principal, down payment, installment including required add-ons, total interest/financing costs, upfront cash, lowest forecast cash balance, reserve remaining, and the effect on mortgage/savings goals. Label the result “fits the selected budget,” “tight,” “does not fit,” or “insufficient information,” with configurable criteria and the reasons. Bank approval remains a separate unanswered question.

Answer pattern, not an assessment of the owner's current finances:

> Under the quoted price and rate, this option leaves [calculated cash] after your existing obligations and car costs. It [preserves/uses] your chosen reserve. With [stress assumption], the lowest balance becomes [calculated cash]. A larger down payment, lower purchase price, or waiting [calculated period] changes that result as follows. Lender approval has not been assessed.

## Shared loan engine

Represent product type, principal denomination/indexation, rate convention, amortization method, fees/insurance, payment dates, extra payments and the evidence behind the terms. Keep product-specific constraints separate from generic arithmetic.

- **Peso mortgage:** COP principal and contracted amortization; separate principal/interest from insurance and fees.
- **UVR mortgage:** UVR principal and schedule, official dated conversion for history, explicit future inflation paths.
- **Vehicle loan:** COP financing with the actual quoted repayment structure; extend to further consumer-loan products only after their rules are implemented.

Both mortgage types have complete onboarding, schedules, balance tracking and extra-payment scenarios. Validate them independently against lender schedules; a passing UVR test does not validate the peso implementation. Comparing a switch of denomination requires an actual new quote and its costs. [Bancolombia mortgage alternatives](https://www.bancolombia.com/personas/creditos/vivienda/credito-hipotecario-para-comprar-vivienda)

## ChatGPT connection options

| Option | User experience | App's model cost | Decision |
| --- | --- | --- | --- |
| Financial summary export | Review a dated summary and question, then copy/download it for ChatGPT | None | First release; reliable fallback |
| ChatGPT calls Money Stalker tools | Ask inside ChatGPT; it requests authorized live summaries and simulations | None if our backend only runs ordinary calculation/data code | Preferred live integration |
| Eligible Sign in with ChatGPT plan usage | Converse inside Money Stalker using a supported user's plan | Subject to approved integration and plan terms | Investigate later; hosted-app eligibility is not assumed |
| Embedded model API | Converse directly in Money Stalker using an app-funded model | Usage-based provider billing | Optional later, with a strict application quota |

**Export:** include an as-of timestamp, permitted accounts, income/spending aggregates, debts, reserve, proposed purchase and calculation results. Let the user preview/exclude fields. Exclude full account identifiers, exact locations and raw bank messages by default. It is a snapshot, not ongoing synchronization. Start with explicit copy/download; do not put financial data or credentials in a ChatGPT URL or promise an undocumented automatic mobile handoff.

**Live tools:** OpenAI documents connecting a custom MCP server to ChatGPT as a personal plugin. Use a small authenticated remote service, without a custom ChatGPT UI initially. ChatGPT supplies the conversational model; our service returns financial data and deterministic results. No OpenAI API key or model inference call is needed on our server for this architecture. Backend hosting/request costs still apply. [Custom MCP connection](https://developers.openai.com/api/docs/guides/custom-mcp-server), [building focused tools](https://developers.openai.com/plugins/build/mcp-server)

The documented personal-plugin setup is on the web. OpenAI also documents using account-available plugins in ChatGPT on web, desktop and mobile, with exceptions for desktop-only plugins. Validate the user's actual account, workspace policy, app version and OAuth flow in an early prototype. Private setup is distinct from later public distribution/review. [Personal plugin quickstart](https://developers.openai.com/plugins/quickstart), [plugin surfaces](https://learn.chatgpt.com/docs/plugins)

**Plan-funded embedded AI:** Sign in with ChatGPT can grant eligible Plus/Pro users permission to use their plan in participating apps. OpenAI's developer guidance currently limits availability: open-source/local personal use is documented, while paid or remotely hosted apps should request access. Our AWS web app must not assume that it qualifies. Identity sign-in alone does not grant inference usage or access to ChatGPT conversations. If considered later, validate the hosted deployment's eligibility first. [Sign-in quickstart](https://developers.openai.com/siwc/quickstart), [integration eligibility](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)

Existing ChatGPT usage limits still apply; connecting an app does not create a new allowance. An ordinary API integration is billed separately from subscription usage. Buying a new ChatGPT subscription solely for this project must be counted separately and cannot be hidden inside the under-US$5 app budget. No subscription upgrade is required for the core financial app. [ChatGPT connected-plan usage](https://learn.chatgpt.com/docs/sign-in-with-chatgpt), [usage and pricing](https://learn.chatgpt.com/docs/pricing), [API pricing](https://developers.openai.com/api/docs/pricing)

## Proposed tool boundary

Expose a small API through an MCP adapter:

- `get_financial_snapshot`: permitted balances, commitments, summarized income/spending, freshness and missing data.
- `get_loan_schedule`: current permitted mortgage/card/loan obligations and their terms.
- `simulate_purchase`: proposed car/purchase assumptions, financing schedule, ownership costs and household impact.
- `compare_scenarios`: evaluate alternatives under the same explicit assumptions and data snapshot.

These are proposed domain tools, not existing endpoints. The web UI invokes the same calculation functions. Return structured exact amounts, currency, assumptions, source references and a scenario/snapshot version so follow-up comparisons remain consistent. Run simulations without writing live account data. Saving a plan is a separate explicit app action.

Require OAuth for financial tools and validate issuer, audience, expiry, scopes and user permissions on the server. Tool metadata alone does not enforce authorization. Derive identity and accessible household records from the token; never trust an arbitrary household ID supplied in a prompt. Support disconnection/revocation and test cross-household access, expired tokens and changed sharing permissions. [OpenAI MCP authentication](https://developers.openai.com/plugins/build/auth)

A read-only connection still shares data with ChatGPT. Explain what is sent and use aggregates first. Each spouse authorizes their own access; no shared ChatGPT credentials. Imported descriptions remain untrusted text. Never expose bank passwords, raw database queries, loan submission or money-movement tools.

## Delivery and validation

Ship the export alongside phase 1. Build COP/UVR mortgage calculations in phase 4A and purchase affordability in phase 4B. Integrate ChatGPT after the functions are reliable, with account/transport/OAuth feasibility checked earlier. A stateless, bounded request design is the intended fit for Lambda; prove MCP transport compatibility and latency before choosing the deployment rather than adding an always-on server by default.

Completion requires matching UI/tool outputs for the same snapshot, correct vehicle sale/debt timing, no double-counted card/ownership costs, explicit treatment of missing quotes, independent COP/UVR calculation checks, successful access/revocation tests, and acceptable cost in the actual AWS bill. If ChatGPT access is unavailable or limits are exhausted, the calculator and summary export continue to work.
