import type { ButtonHTMLAttributes, ReactNode } from "react";
export type IconName =
  | "eye"
  | "overview"
  | "arrows"
  | "check"
  | "upload"
  | "wallet"
  | "plus"
  | "download"
  | "arrow"
  | "close"
  | "search"
  | "incoming"
  | "outgoing"
  | "source"
  | "shield"
  | "card"
  | "bank"
  | "chevron"
  | "refresh"
  | "calendar"
  | "location"
  | "food"
  | "groceries"
  | "restaurant"
  | "car"
  | "delivery"
  | "utilities"
  | "home"
  | "transport"
  | "heart"
  | "leisure"
  | "other"
  | "minus"
  | "coin"
  | "receipt"
  | "pocket"
  | "investment"
  | "subscription"
  | "online-shopping"
  | "shopping"
  | "loan"
  | "bank-fees"
  | "internet"
  | "phone";
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    subscription: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m10 9 5 3-5 3V9ZM7 2v3m10-3v3" /></>,
    "online-shopping": <><path d="M3 4h2l3 11h11l2-8H6M9 20h.01M18 20h.01M12 3h6m-3-2 3 2-3 2" /><circle cx="9" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></>,
    shopping: <><path d="M5 7h14l2 14H3L5 7Z" /><path d="M8 8V6a4 4 0 0 1 8 0v2" /></>,
    loan: <><path d="M3 4h13v6M3 4v16h7M6 8h6M6 12h3" /><circle cx="16" cy="16" r="6" /><path d="M16 13v3l2 1" /></>,
    "bank-fees": <><path d="m3 8 8-5 8 5H3Zm2 3v6m6-6v6M3 20h9" /><circle cx="18" cy="17" r="4" /><path d="M16 17h4" /></>,
    internet: <><path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0m-11 4a6 6 0 0 1 8 0" /><circle cx="12" cy="20" r="1" /></>,
    phone: <><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M10 5h4m-3 14h2" /></>,
    coin: <><circle cx="12" cy="12" r="9" /><path d="M15 8c-1-2-7-2-7 1 0 4 8 1 8 5 0 3-6 4-8 1m4-10v14" /></>,
    receipt: <><path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3Z" /><path d="M9 8h6m-6 4h6m-6 4h3" /></>,
    pocket: <><path d="M4 5h16v9c0 4-8 7-8 7s-8-3-8-7V5Z" /><path d="m4 9 8 5 8-5" /></>,
    investment: <><path d="M4 20h16M6 16v-3m6 3V9m6 7V5M4 9l6-5 5 2 5-4" /></>,
    eye: (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    overview: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    arrows: <path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4" />,
    check: <path d="m5 12 4 4L19 6" />,
    upload: <path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" />,
    wallet: (
      <>
        <rect x="3" y="5" width="18" height="15" rx="3" />
        <path d="M3 8V4l14-2v3M21 11h-6v5h6" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    minus: <path d="M5 12h14" />,
    download: <path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 6 6" />
      </>
    ),
    incoming: <path d="M18 6 6 18m0-8v8h8" />,
    outgoing: <path d="M6 18 18 6m-8 0h8v8" />,
    source: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="3" />
        <path d="M9 8h6M9 12h6M9 16h3" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
        <path d="m8 11 3 3 5-5" />
      </>
    ),
    card: (
      <>
        <rect x="2" y="5" width="20" height="14" rx="3" />
        <path d="M2 10h20M6 15h4" />
      </>
    ),
    bank: (
      <>
        <path d="m3 9 9-6 9 6H3ZM4 21h16M6 12v5m6-5v5m6-5v5" />
      </>
    ),
    chevron: <path d="m9 5 7 7-7 7" />,
    refresh: (
      <>
        <path d="M3 12a9 9 0 0 1 15.36-6.36L21 9m0-6v6h-6" />
        <path d="M21 12a9 9 0 0 1-15.36 6.36L3 15m0 6v-6h6" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M7 3v4m10-4v4M3 11h18" />
      </>
    ),
    location: (
      <>
        <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    food: (
      <path d="M5 3v7m3-7v7M3 7h7m-4 3v11M17 3c-4 5-4 9 0 9h2V3h-2Zm2 9v9" />
    ),
    groceries: (
      <>
        <path d="M4 9h16l-2 11H6L4 9Z" />
        <path d="m8 9 4-6 4 6M8 13v3m4-3v3m4-3v3" />
      </>
    ),
    restaurant: (
      <>
        <path d="M4 4v5a3 3 0 0 0 3 3V4m-3 4h6M7 12v8" />
        <path d="M17 4c-3 3-3 8 0 8h2V4h-2Zm2 8v8" />
      </>
    ),
    car: (
      <>
        <path d="m5 11 2-5h10l2 5M4 11h16v7H4v-7Z" />
        <path d="M7 18v2m10-2v2M7 14h2m6 0h2" />
      </>
    ),
    delivery: (
      <>
        <path d="M3 7h10v10H3V7Zm10 4h4l3 3v3h-7v-6Z" />
        <circle cx="7" cy="19" r="2" />
        <circle cx="17" cy="19" r="2" />
      </>
    ),
    utilities: <path d="M13 2 5 14h7l-1 8 8-12h-7l1-8Z" />,
    home: (
      <>
        <path d="m3 11 9-8 9 8M5 10v11h14V10M10 21v-7h4v7" />
      </>
    ),
    transport: (
      <>
        <rect x="5" y="3" width="14" height="16" rx="4" />
        <path d="M5 10h14M8 19v2m8-2v2M8 15h1m6 0h1" />
      </>
    ),
    heart: <path d="M12 21 3 12C-3 5 7-1 12 6c5-7 15-1 9 6l-9 9Z" />,
    leisure: (
      <>
        <path d="m7 7-3 2-2 9 3 2 5-5h4l5 5 3-2-2-9-3-2H7Z" />
        <path d="M6 11v4m-2-2h4m7-2h1m2 3h1" />
      </>
    ),
    other: (
      <>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
/** Decorative evidence trail: no labels, status, interaction or financial meaning. */
export function EvidenceTrail({ variant = "evidence", className = "" }: {
  variant?: "evidence" | "funds" | "holdings";
  className?: string;
}) {
  const symbols: Record<typeof variant, [IconName, IconName, IconName]> = {
    evidence: ["receipt", "search", "card"],
    funds: ["coin", "wallet", "receipt"],
    holdings: ["pocket", "coin", "investment"],
  };
  return <span className={`evidence-trail ${className}`} aria-hidden="true">
    <svg className="evidence-trail-path" viewBox="0 0 180 90" fill="none"><path d="M27 52c12 31 47 28 58 2s36-34 63-18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="1 8" /></svg>
    {symbols[variant].map((name, index) => <span key={name} className={`evidence-trail-symbol trail-symbol-${index}`}><Icon name={name} size={30} /></span>)}
  </span>;
}
export function Eyes({
  happy = false,
  className = "",
}: {
  happy?: boolean;
  className?: string;
}) {
  return (
    <svg
      className={`eyes ${className}`}
      viewBox="0 0 120 78"
      fill="none"
      aria-hidden="true"
    >
      <rect x="2" y="4" width="116" height="70" rx="35" fill="currentColor" />
      <ellipse cx="42" cy="37" rx="17" ry="23" fill="#fff" />
      <ellipse cx="81" cy="37" rx="17" ry="23" fill="#fff" />
      {happy ? (
        <g stroke="#0c1730" strokeWidth="5" strokeLinecap="round">
          <path d="m33 39 9-7 9 7M72 39l9-7 9 7" />
        </g>
      ) : (
        <g fill="#0c1730">
          <ellipse cx="47" cy="40" rx="7" ry="11" />
          <ellipse cx="86" cy="40" rx="7" ry="11" />
        </g>
      )}
    </svg>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "blue";
}) {
  return <span className={`ds-badge ds-badge--${tone}`}>{children}</span>;
}
export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  children: ReactNode;
}) {
  return (
    <button {...props} className={`button ${variant} ${className}`}>
      {children}
    </button>
  );
}
export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="section-heading">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function EmptyState({
  title,
  children,
  action,
  icon = "search",
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="ds-empty">
      <span className="ds-empty-art" aria-hidden="true">
        <EvidenceTrail variant={icon === "wallet" || icon === "bank" ? "funds" : "evidence"} />
        <span className="ds-empty-icon"><Icon name={icon} size={28} /></span>
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function SectionHeading({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

export function DisclosureEditor({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={`settings-editor ${className}`}>
      <summary>
        {label} <Icon name="chevron" size={14} />
      </summary>
      {children}
    </details>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
