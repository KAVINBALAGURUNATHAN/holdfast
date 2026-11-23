import type { ReactNode } from "react";
import type { ApprovalAction, ApprovalStatus, ContractStatus, MilestoneStatus, VerdictDecision } from "../api";

type Tone = "slate" | "accent" | "green" | "amber" | "rose" | "violet";

const toneClasses: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  accent: "bg-accent-50 text-accent-700 ring-accent-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  rose: "bg-rose-50 text-rose-700 ring-rose-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};

export function Badge({ tone = "slate", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${toneClasses[tone]} ${className}`}
    >
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
    <Badge tone={actionTone[action] ?? "slate"} className="uppercase tracking-wide">
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
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500" role="status">
      <Spinner />
      {label}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 sm:flex-row sm:items-center sm:justify-between"
      role="alert"
    >
      <span className="break-words">{message}</span>
      {onRetry && (
        <button type="button" className="btn-danger shrink-0" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <p className="text-sm font-medium text-slate-900">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100);
  const color = pct >= 75 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Confidence"
      >
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right text-sm font-semibold tabular-nums text-slate-700">{pct}%</span>
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
