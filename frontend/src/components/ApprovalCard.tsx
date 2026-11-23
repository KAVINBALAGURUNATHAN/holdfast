import { useState, type ReactNode } from "react";
import { api, formatDateTime, notifyApprovalsChanged, type Approval } from "../api";
import { ActionBadge, ApprovalStatusBadge, ErrorBox, IconCheck, IconWallet, IconX, Spinner } from "./ui";

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

export default function ApprovalCard({ approval, reviewer, context, onDecided }: Props) {
  const [busy, setBusy] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: "approved" | "denied") => {
    setBusy(decision);
    setError(null);
    try {
      const updated = await api.decideApproval(approval.id, decision, reviewer.trim() || "Demo Reviewer");
      notifyApprovalsChanged();
      onDecided(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const pending = approval.status === "pending";

  return (
    <div className={`rounded-lg border p-4 ${pending ? "border-amber-200 bg-amber-50/40" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sky-100 text-sky-700">
            <IconWallet className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">Payment agent proposes</span>
              <ActionBadge action={approval.action} />
              <ApprovalStatusBadge status={approval.status} />
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {approval.requested_by_agent} · {formatDateTime(approval.created_at)}
            </p>
          </div>
        </div>
      </div>

      {context && <div className="mt-3">{context}</div>}

      <div className="mt-3 space-y-1">
        <p className="text-sm text-slate-700">{approval.reason}</p>
        <p className="text-xs text-slate-500">If approved: {actionCopy[approval.action]}</p>
      </div>

      {pending ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            Deciding as <span className="font-medium text-slate-700">{reviewer || "Demo Reviewer"}</span>
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn-danger flex-1 sm:flex-none" disabled={busy !== null} onClick={() => void decide("denied")}>
              {busy === "denied" ? <Spinner /> : <IconX />}
              Deny
            </button>
            <button type="button" className="btn-primary flex-1 sm:flex-none" disabled={busy !== null} onClick={() => void decide("approved")}>
              {busy === "approved" ? <Spinner /> : <IconCheck />}
              Approve {approval.action}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500">
          {approval.status === "approved" ? "Approved" : "Denied"} by{" "}
          <span className="font-medium text-slate-700">{approval.decided_by ?? "—"}</span> ·{" "}
          {formatDateTime(approval.decided_at)}
        </p>
      )}

      {error && (
        <div className="mt-3">
          <ErrorBox message={error} />
        </div>
      )}
    </div>
  );
}
