import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ApprovalAction, ApprovalStatus, ContractStatus, MilestoneStatus, VerdictDecision } from "../api";

// ---------- Badges ----------

type Tone = "slate" | "accent" | "green" | "amber" | "rose" | "violet" | "gold";

const toneClasses: Record<Tone, { pill: string; dot: string }> = {
  slate: { pill: "bg-ink-100 text-ink-700 ring-ink-200", dot: "bg-ink-400" },
  accent: { pill: "bg-accent-50 text-accent-800 ring-accent-200", dot: "bg-accent-500" },
  green: { pill: "bg-emerald-50 text-emerald-800 ring-emerald-200", dot: "bg-emerald-500" },
  amber: { pill: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
  rose: { pill: "bg-rose-50 text-rose-700 ring-rose-200", dot: "bg-rose-500" },
  violet: { pill: "bg-indigo-50 text-indigo-700 ring-indigo-200", dot: "bg-indigo-500" },
  gold: { pill: "bg-gold-50 text-gold-700 ring-gold-100", dot: "bg-gold-500" },
};

export function Badge({
  tone = "slate",
  children,
  className = "",
  dot = true,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  const t = toneClasses[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${t.pill} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.dot}`} aria-hidden="true" />}
      {children}
    </span>
  );
}

const milestoneTone: Record<MilestoneStatus, Tone> = {
  pending: "slate",
  funded: "accent",
  submitted: "violet",
  approved: "green",
  rejected: "rose",
  released: "green",
  held: "amber",
};

const milestoneLabel: Record<MilestoneStatus, string> = {
  pending: "Awaiting funding",
  funded: "Funded · in escrow",
  submitted: "Submitted · under review",
  approved: "Approved",
  rejected: "Rejected",
  released: "Released",
  held: "Held",
};

export function MilestoneStatusBadge({ status }: { status: MilestoneStatus }) {
  return <Badge tone={milestoneTone[status] ?? "slate"}>{milestoneLabel[status] ?? status}</Badge>;
}

const contractTone: Record<ContractStatus, Tone> = { draft: "slate", active: "accent", completed: "green" };
export function ContractStatusBadge({ status }: { status: ContractStatus }) {
  return <Badge tone={contractTone[status] ?? "slate"}>{capitalize(status)}</Badge>;
}

const decisionTone: Record<VerdictDecision, Tone> = { approve: "green", reject: "rose", needs_review: "amber" };
const decisionLabel: Record<VerdictDecision, string> = {
  approve: "Approve",
  reject: "Reject",
  needs_review: "Needs review",
};
export function DecisionBadge({ decision, large = false }: { decision: VerdictDecision; large?: boolean }) {
  return (
    <Badge tone={decisionTone[decision] ?? "slate"} className={large ? "px-3 py-1 text-sm" : ""}>
      {decisionLabel[decision] ?? decision}
    </Badge>
  );
}

const actionTone: Record<ApprovalAction, Tone> = { release: "green", hold: "amber", refund: "rose" };
export function ActionBadge({ action }: { action: ApprovalAction }) {
  return (
    <Badge tone={actionTone[action] ?? "slate"} className="uppercase tracking-wider">
      {action}
    </Badge>
  );
}

const approvalTone: Record<ApprovalStatus, Tone> = { pending: "amber", approved: "green", denied: "rose" };
export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  return <Badge tone={approvalTone[status] ?? "slate"}>{capitalize(status)}</Badge>;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ---------- Money ----------

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** Rupee amount in the serif display face with Indian digit grouping (₹1,50,000). */
export function Money({ amount, currency = "INR", className = "" }: { amount: number; currency?: string; className?: string }) {
  const safe = Number.isFinite(amount) ? amount : 0;
  if (currency !== "INR") {
    return (
      <span className={`money ${className}`}>
        {new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(safe)}
      </span>
    );
  }
  return (
    <span className={`money ${className}`}>
      <span className="mr-[0.06em] text-[0.82em] opacity-70">₹</span>
      {inr.format(safe)}
    </span>
  );
}

// ---------- Layout primitives ----------

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="display text-3xl leading-tight sm:text-4xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-600">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="display text-xl">{children}</h2>
      {aside && <div className="text-xs text-ink-500">{aside}</div>}
    </div>
  );
}

/** A KPI tile: label on top, a large value, optional hint underneath. */
export function StatTile({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div
      className={
        emphasis
          ? "rounded-2xl bg-accent-800 p-5 text-white shadow-lift"
          : "rounded-2xl border border-ink-200/70 bg-white p-5 shadow-soft"
      }
    >
      <p className={`text-xs font-medium ${emphasis ? "text-accent-100/80" : "text-ink-500"}`}>{label}</p>
      <div className={`mt-2 text-3xl leading-none ${emphasis ? "text-white" : "text-ink-900"}`}>{value}</div>
      {hint && <p className={`mt-2 text-xs ${emphasis ? "text-accent-100/70" : "text-ink-500"}`}>{hint}</p>}
    </div>
  );
}

// ---------- Escrow timeline ----------

const TIMELINE_STEPS = ["Funded", "Submitted", "Verdict", "Released"] as const;

/** Index of the last completed step for a milestone status (-1 = nothing yet). */
function timelineProgress(status: MilestoneStatus): { done: number; stopped?: "held" | "rejected" } {
  switch (status) {
    case "funded":
      return { done: 0 };
    case "submitted":
      return { done: 1 };
    case "approved":
      return { done: 2 };
    case "released":
      return { done: 3 };
    case "held":
      return { done: 2, stopped: "held" };
    case "rejected":
      return { done: 2, stopped: "rejected" };
    default:
      return { done: -1 };
  }
}

/** Four-step escrow progress: Funded → Submitted → Verdict → Released. */
export function EscrowTimeline({ status, compact = false }: { status: MilestoneStatus; compact?: boolean }) {
  const { done, stopped } = timelineProgress(status);
  return (
    <ol className="flex w-full items-start" aria-label="Escrow progress">
      {TIMELINE_STEPS.map((step, i) => {
        const complete = i <= done;
        const isStop = !!stopped && i === done + 1;
        const current = !stopped && i === done + 1;
        const stopTone = stopped === "rejected" ? "rose" : "amber";
        const nodeCls = complete
          ? "border-accent-600 bg-accent-600 text-white"
          : isStop
            ? stopTone === "rose"
              ? "border-rose-400 bg-rose-50 text-rose-600"
              : "border-amber-400 bg-amber-50 text-amber-700"
            : current
              ? "border-accent-500 bg-white text-accent-600 ring-4 ring-accent-100"
              : "border-ink-200 bg-white text-ink-300";
        const textCls = complete
          ? "text-ink-800"
          : isStop
            ? stopTone === "rose"
              ? "text-rose-600"
              : "text-amber-700"
            : current
              ? "text-accent-700"
              : "text-ink-400";
        const label = isStop ? (stopped === "rejected" ? "Rejected" : "Held") : step;
        return (
          <li key={step} className="relative flex flex-1 flex-col items-center">
            {i > 0 && (
              <span
                className={`absolute right-1/2 top-[9px] h-0.5 w-full -translate-y-1/2 ${i <= done ? "bg-accent-600" : "bg-ink-200"}`}
                aria-hidden="true"
              />
            )}
            <span
              className={`relative z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 transition-colors ${nodeCls}`}
            >
              {complete && <IconCheck className="h-2.5 w-2.5" />}
              {isStop && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
            </span>
            {!compact && (
              <span className={`mt-1.5 text-[11px] font-medium ${textCls}`}>
                {label}
                <span className="sr-only">{complete ? " (done)" : current ? " (next)" : ""}</span>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ---------- Feedback states ----------

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-500" role="status">
      <Spinner className="h-4 w-4 text-accent-600" />
      {label}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-ink-100 ${className}`} aria-hidden="true" />;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-800 sm:flex-row sm:items-center sm:justify-between"
      role="alert"
    >
      <span className="break-words">{message}</span>
      {onRetry && (
        <button type="button" className="btn-danger btn-sm shrink-0" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

/** Shown when the server no longer has the contract this page is showing (e.g. after a restart). */
export function GoneNotice({ what = "This contract" }: { what?: string }) {
  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-800 sm:flex-row sm:items-center sm:justify-between"
      role="alert"
    >
      <span className="break-words">
        {what} is no longer on the server (it may have restarted). Upload it again.
      </span>
      <Link to="/" className="btn-secondary btn-sm shrink-0">
        Go to Contracts
      </Link>
    </div>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-ink-300 bg-white/60 px-6 py-14 text-center">
      {icon && (
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent-50 text-accent-700">
          {icon}
        </div>
      )}
      <p className="display text-lg">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-ink-500">{children}</div>}
    </div>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100);
  const color = pct >= 75 ? "bg-emerald-600" : pct >= 50 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Confidence"
      >
        <div className={`h-full rounded-full ${color} transition-[width] duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="money w-12 text-right text-base text-ink-800">{pct}%</span>
    </div>
  );
}

// ---------- Icons (inline, stroke-based) ----------

type IconProps = { className?: string };
function svgProps(className = "h-4 w-4") {
  return {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

export const IconDocument = ({ className }: IconProps) => (
  <svg {...svgProps(className)}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </svg>
);
export const IconScale = ({ className }: IconProps) => (
  <svg {...svgProps(className)}>
    <path d="M12 3v18M7 21h10M5 7h14M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z" />
  </svg>
);
export const IconWallet = ({ className }: IconProps) => (
  <svg {...svgProps(className)}>
    <path d="M3 7a2 2 0 0 1 2-2h12v4" />
    <path d="M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z" />
    <circle cx="16" cy="14" r="1" />
  </svg>
);
export const IconUser = ({ className }: IconProps) => (
  <svg {...svgProps(className)}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);
export const IconCog = ({ className }: IconProps) => (
  <svg {...svgProps(className)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
  </svg>
);
export const IconCheck = ({ className }: IconProps) => (
  <svg {...svgProps(className)}>
    <path d="m5 12 5 5L20 7" />
  </svg>
);
export const IconX = ({ className }: IconProps) => (
  <svg {...svgProps(className)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const IconUpload = ({ className }: IconProps) => (
  <svg {...svgProps(className)}>
    <path d="M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </svg>
);
export const IconShield = ({ className }: IconProps) => (
  <svg {...svgProps(className)}>
    <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);
export const IconChevron = ({ className }: IconProps) => (
  <svg {...svgProps(className)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);
export const IconArrowLeft = ({ className }: IconProps) => (
  <svg {...svgProps(className)}>
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </svg>
);
export const IconExternal = ({ className }: IconProps) => (
  <svg {...svgProps(className)}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
);
export const IconClock = ({ className }: IconProps) => (
  <svg {...svgProps(className)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
export const IconLock = ({ className }: IconProps) => (
  <svg {...svgProps(className)}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);
export const IconSparkle = ({ className }: IconProps) => (
  <svg {...svgProps(className)}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
  </svg>
);
