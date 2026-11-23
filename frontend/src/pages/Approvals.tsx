import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatDate, formatMoney, type Approval, type Contract, type Milestone } from "../api";
import { useAsync, useReviewerName } from "../hooks";
import ApprovalCard from "../components/ApprovalCard";
import { EmptyState, ErrorBox, LoadingBlock, MilestoneStatusBadge } from "../components/ui";

type View = "pending" | "all";

function MilestoneContext({ milestone, contract }: { milestone?: Milestone; contract?: Contract }) {
  if (!milestone || !contract) return null;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <Link to={`/contracts/${contract.id}`} className="text-xs font-medium text-accent-700 hover:underline">
          {contract.title || "Untitled contract"}
        </Link>
        <p className="truncate text-sm font-medium text-slate-900">
          #{milestone.seq} {milestone.title}
        </p>
        <p className="text-xs text-slate-500">Due {formatDate(milestone.due_date)}</p>
      </div>
      <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
        <span className="font-semibold tabular-nums text-slate-900">{formatMoney(milestone.amount, contract.currency)}</span>
        <MilestoneStatusBadge status={milestone.status} />
      </div>
    </div>
  );
}

export default function Approvals() {
  const [view, setView] = useState<View>("pending");
  const [reviewer, setReviewer] = useReviewerName();
  const approvals = useAsync<Approval[]>(() => api.listApprovals(view === "pending" ? "pending" : undefined), [view]);
  const contracts = useAsync<Contract[]>(() => api.listContracts(), []);

  const lookup = useMemo(() => {
    const map = new Map<string, { milestone: Milestone; contract: Contract }>();
    for (const c of contracts.data ?? []) for (const m of c.milestones ?? []) map.set(m.id, { milestone: m, contract: c });
    return map;
  }, [contracts.data]);

  const list = [...(approvals.data ?? [])].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

  const onDecided = (updated: Approval) => {
    approvals.setData((prev) =>
      view === "pending"
        ? (prev ?? []).filter((a) => a.id !== updated.id)
        : (prev ?? []).map((a) => (a.id === updated.id ? updated : a)),
    );
    void contracts.reload();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Approvals</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            The payment agent never moves money on its own. Every release, hold or refund it proposes waits here for a
            human decision.
          </p>
        </div>
        <div className="w-full sm:w-64">
          <label htmlFor="reviewer" className="label">
            Deciding as
          </label>
          <input
            id="reviewer"
            className="input"
            value={reviewer}
            onChange={(e) => setReviewer(e.target.value)}
            placeholder="Your name"
          />
        </div>
      </div>

      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
        {(["pending", "all"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
              view === v ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {v === "pending" ? "Pending" : "All decisions"}
          </button>
        ))}
      </div>

      {approvals.loading && !approvals.data ? (
        <LoadingBlock label="Loading approvals…" />
      ) : approvals.error ? (
        <ErrorBox message={approvals.error} onRetry={() => void approvals.reload()} />
      ) : list.length === 0 ? (
        <EmptyState title={view === "pending" ? "Inbox zero" : "No approvals yet"}>
          {view === "pending"
            ? "No payment proposals are waiting for a decision."
            : "Approvals appear after the referee agent reviews a submitted deliverable."}
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {contracts.error && <ErrorBox message={`Could not load contract details: ${contracts.error}`} />}
          {list.map((a) => {
            const ctx = lookup.get(a.milestone_id);
            return (
              <ApprovalCard
                key={a.id}
                approval={a}
                reviewer={reviewer}
                onDecided={onDecided}
                context={<MilestoneContext milestone={ctx?.milestone} contract={ctx?.contract} />}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
