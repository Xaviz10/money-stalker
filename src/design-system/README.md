# Money Stalker design system

The approved direction is **Accounts first**. The selected visual reference is `.impeccable/mocks/accounts-first.png`; the running component catalog is `#/design-system`.

## Source and ownership

- `tokens.css`: live color, type, spacing, shape, focus, overlay, and motion primitives. The variable font is self-hosted in `fonts/`; the license is in `public/fonts/OFL-Inter.txt`.
- `ui.tsx`: typed `Icon`, `Eyes`, `Badge`, `Button`, `Panel`, `EmptyState`, `SectionHeading`, `DisclosureEditor`, and `Field` components.
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

## Financial patterns

`AccountRail` uses `domain/account-groups.ts`; do not infer an institution from a display name. `institution` is an optional explicit group name. Bank accounts hold cash balances; debit instruments point to those accounts. Credit accounts have separate debt and optional `parentAccountId` pointing to a bank account. Omitting that association creates an independent credit card. Cash accounts stay separate.

Grouping never changes money calculations. Do not add debit instrument balances, sum debt into cash, or infer that linking a credit account pays it. Existing accounts without new metadata remain valid. The accounts screen can organize an existing card without changing its opening balance.

The dashboard's available amount is global. Selecting a rail account filters activity and category spending; show that scope explicitly. The net-worth rail summary means all account balances minus credit debt, including accounts excluded from spendable cash. Use the existing exact minor-unit helpers, never floating-point currency math.

Source/candidate review must show amount/date/account context, explain statement-driven amount changes, require an explicit decision, preserve failure state, and offer correction undo. Initial loading, incomplete evidence, and stale refresh are distinct from an empty ledger or a zero balance.

## Responsive behavior and accessibility

Desktop has top navigation, an account rail, main ledger, and right insights workspace. Below 1100px the insights move below the ledger. At 850px and below the rail is an in-flow, scrollable disclosure opened by “Mis cuentas y tarjetas.” It closes after selection. Narrow transactions keep merchant and amount together and move account/date beneath the name.

Use visible focus, native keyboard behavior, labeled controls, `aria-current` for navigation, and `aria-pressed` for account/filter selection. Restrict motion to clear state changes; respect reduced motion. Keep localized COP formatting and America/Bogota dates. Do not ship screenshot text, example balances, bank logos, or generated analytics as real data.

## Extend the system

Reuse existing tokens/components before adding a new one. Promote a repeated, same-purpose pattern; keep one-off screen behavior local. Update the catalog and root design reference with a new reusable variant. Check the actual page at desktop, tablet, and narrow-phone sizes and run the relevant browser flow. Add behavior tests when financial state, grouping, filtering, or recovery changes.
