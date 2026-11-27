import { useState, type ReactNode } from "react";
import { api, formatDateTime, isGoneError, notifyApprovalsChanged, type Approval } from "../api";
import {
  ActionBadge,
  ApprovalStatusBadge,
  ErrorBox,
  GoneNotice,
  IconCheck,
  IconClock,
  IconSparkle,
  IconUser,
  IconWallet,
  IconX,
  Spinner,
} from "./ui";

const actionCopy: Record<Approval["action"], string> = {
  release: "Capture the escrow authorization and pay the freelancer.",
  hold: "Keep funds authorized in escrow; milestone marked as held.",
  refund: "Void the escrow authorization and return funds to the client.",
};

interface Props {
  approval: Approval;
  reviewer: string;
  context?: ReactNode;
  onDecided: (a: Approval) => void;
}

function agentLabel(agent: string): string {
  const s = (agent || "").replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Agent";
}

export default function ApprovalCard({ approval, reviewer, context, onDecided }: Props) {
  const [busy, setBusy] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);

  const decide = async (decision: "approved" | "denied") => {
    setBusy(decision);
    setError(null);
    try {
      const updated = await api.decideApproval(approval.id, decision, reviewer.trim() || "Demo Reviewer");
      notifyApprovalsChanged();
      onDecided(updated);
    } catch (e) {
      if (isGoneError(e)) setGone(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const pending = approval.status === "pending";
  const approved = approval.status === "approved";

  return (
    <article
      className={
        pending
          ? "card overflow-hidden shadow-lift ring-1 ring-gold-100"
          : "card-muted overflow-hidden"
      }
      aria-label={`${approval.action} proposal, ${approval.status}`}
    >
      {pending && <div className="h-1 bg-gradient-to-r from-gold-500 via-gold-100 to-transparent" aria-hidden="true" />}

      <div className="p-4 sm:p-5">
        {/* Header: who proposes what */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                pending ? "bg-gold-50 text-gold-700 ring-1 ring-inset ring-gold-100" : "bg-ink-100 text-ink-500"
              }`}
            >
              <IconWallet className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="eyebrow">{pending ? "Awaiting your decision" : "Decision recorded"}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className={`text-sm font-medium ${pending ? "text-ink-900" : "text-ink-700"}`}>
                  Payment agent proposes
                </span>
                <ActionBadge action={approval.action} />
              </div>
            </div>
          </div>
          <ApprovalStatusBadge status={approval.status} />
        </div>

        {/* Milestone / amount context supplied by the page */}
        {context && <div className="mt-4">{context}</div>}

        {/* Agent reasoning */}
        <div className={`mt-4 rounded-xl border p-3.5 sm:p-4 ${pending ? "border-ink-200/70 bg-paper/70" : "border-ink-200/60 bg-white/50"}`}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
            <IconSparkle className="h-3.5 w-3.5 text-accent-600" />
            <span className="font-medium text-ink-700">{agentLabel(approval.requested_by_agent)}</span>
            <span aria-hidden="true">·</span>
            <time className="font-mono text-[11px] tabular-nums" dateTime={approval.created_at}>
              {formatDateTime(approval.created_at)}
            </time>
          </div>
          <p className={`mt-2 whitespace-pre-line break-words text-sm leading-relaxed ${pending ? "text-ink-800" : "text-ink-600"}`}>
            {approval.reason}
          </p>
          <p className="mt-3 border-t border-ink-200/70 pt-2.5 text-xs leading-relaxed text-ink-500">
            <span className="font-medium text-ink-600">If approved:</span> {actionCopy[approval.action]}
          </p>
        </div>

        {pending ? (
          <div className="mt-4 flex flex-col gap-3 border-t border-ink-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-1.5 text-xs text-ink-500">
              <IconUser className="h-3.5 w-3.5" />
              Deciding as <span className="font-medium text-ink-800">{reviewer || "Demo Reviewer"}</span>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-danger flex-1 sm:flex-none"
                disabled={busy !== null}
                aria-busy={busy === "denied"}
                onClick={() => void decide("denied")}
              >
                {busy === "denied" ? <Spinner /> : <IconX />}
                Deny
              </button>
              <button
                type="button"
                className="btn-primary flex-1 sm:flex-none"
                disabled={busy !== null}
                aria-busy={busy === "approved"}
                onClick={() => void decide("approved")}
              >
                {busy === "approved" ? <Spinner /> : <IconCheck />}
                Approve {approval.action}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full ${
                approved ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
              }`}
              aria-hidden="true"
            >
              {approved ? <IconCheck className="h-3 w-3" /> : <IconX className="h-3 w-3" />}
            </span>
            <span>
              {approved ? "Approved" : "Denied"} by{" "}
              <span className="font-medium text-ink-700">{approval.decided_by ?? "—"}</span>
            </span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <IconClock className="h-3 w-3" />
              <time className="font-mono text-[11px] tabular-nums" dateTime={approval.decided_at ?? undefined}>
                {formatDateTime(approval.decided_at)}
              </time>
            </span>
          </div>
        )}

        {gone && (
          <div className="mt-3">
            <GoneNotice what="This approval" />
          </div>
        )}
        {error && (
          <div className="mt-3">
            <ErrorBox message={error} />
          </div>
        )}
      </div>
    </article>
  );
}
