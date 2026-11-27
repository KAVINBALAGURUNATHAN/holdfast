import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatDate, type Approval, type Contract, type Milestone } from "../api";
import { useAsync, useReviewerName } from "../hooks";
import ApprovalCard from "../components/ApprovalCard";
import {
  EmptyState,
  ErrorBox,
  IconCheck,
  IconDocument,
  IconShield,
  LoadingBlock,
  MilestoneStatusBadge,
  Money,
  PageHeader,
} from "../components/ui";

type View = "pending" | "all";

function MilestoneContext({ milestone, contract }: { milestone?: Milestone; contract?: Contract }) {
  if (!milestone || !contract) return null;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-ink-200/70 bg-white p-3.5 sm:flex-row sm:items-center sm:justify-between sm:p-4">
      <div className="min-w-0">
        <Link
          to={`/contracts/${contract.id}`}
          className="inline-flex max-w-full items-center gap-1.5 rounded text-xs font-medium text-accent-700 hover:text-accent-800 hover:underline"
        >
          <IconDocument className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{contract.title || "Untitled contract"}</span>
        </Link>
        <p className="mt-1 truncate text-sm font-medium text-ink-900">
          <span className="text-ink-400">#{milestone.seq}</span> {milestone.title}
        </p>
        <p className="mt-0.5 text-xs text-ink-500">Due {formatDate(milestone.due_date)}</p>
      </div>
      <div className="flex items-end justify-between gap-3 border-t border-ink-100 pt-3 sm:flex-col sm:items-end sm:gap-1.5 sm:border-0 sm:pt-0">
        <div className="sm:text-right">
          <p className="eyebrow">Amount</p>
          <Money amount={milestone.amount} currency={contract.currency} className="text-2xl leading-tight text-ink-900 sm:text-3xl" />
        </div>
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

  // Newest first, with pending proposals always floated to the top.
  const list = [...(approvals.data ?? [])].sort((a, b) => {
    const pa = a.status === "pending" ? 0 : 1;
    const pb = b.status === "pending" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return (b.created_at ?? "").localeCompare(a.created_at ?? "");
  });

  // Counts we can derive from the data already loaded for the current view.
  const loaded = !!approvals.data;
  const pendingCount = list.filter((a) => a.status === "pending").length;
  const counts: Record<View, number | null> = {
    pending: loaded ? pendingCount : null,
    all: loaded && view === "all" ? list.length : null,
  };

  const onDecided = (updated: Approval) => {
    approvals.setData((prev) =>
      view === "pending"
        ? (prev ?? []).filter((a) => a.id !== updated.id)
        : (prev ?? []).map((a) => (a.id === updated.id ? updated : a)),
    );
    void contracts.reload();
  };

  const firstDecidedIndex = list.findIndex((a) => a.status !== "pending");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Human in the loop"
        title="Approvals"
        description="AI agents propose; you decide. The payment agent never moves money on its own — every release, hold or refund it proposes waits here for a human decision."
        actions={
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
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="inline-flex max-w-full rounded-xl border border-ink-200/70 bg-paper-2/70 p-1 text-sm"
          role="group"
          aria-label="Filter approvals"
        >
          {(["pending", "all"] as const).map((v) => {
            const active = view === v;
            const count = counts[v];
            return (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={active}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-medium transition-[background-color,color,box-shadow] duration-150 sm:px-4 ${
                  active ? "bg-white text-ink-900 shadow-soft ring-1 ring-ink-200/70" : "text-ink-500 hover:text-ink-900"
                }`}
              >
                {v === "pending" ? "Pending" : "All decisions"}
                {count !== null && (
                  <span
                    className={`min-w-[1.25rem] rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums leading-5 ${
                      v === "pending" && count > 0
                        ? "bg-gold-50 text-gold-700 ring-1 ring-inset ring-gold-100"
                        : "bg-ink-100 text-ink-600"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="flex items-center gap-1.5 text-xs text-ink-500">
          <IconShield className="h-3.5 w-3.5 text-accent-600" />
          Every decision is written to the audit trail.
        </p>
      </div>

      {approvals.loading && !approvals.data ? (
        <LoadingBlock label="Loading approvals…" />
      ) : approvals.error ? (
        <ErrorBox message={approvals.error} onRetry={() => void approvals.reload()} />
      ) : list.length === 0 ? (
        <EmptyState
          title={view === "pending" ? "Inbox zero" : "No approvals yet"}
          icon={view === "pending" ? <IconCheck className="h-5 w-5" /> : <IconShield className="h-5 w-5" />}
        >
          {view === "pending"
            ? "No payment proposals are waiting for a decision."
            : "Approvals appear after the referee agent reviews a submitted deliverable."}
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {contracts.error && <ErrorBox message={`Could not load contract details: ${contracts.error}`} />}
          {list.map((a, i) => {
            const ctx = lookup.get(a.milestone_id);
            return (
              <div key={a.id} className={i === firstDecidedIndex && i > 0 ? "pt-4" : undefined}>
                {i === firstDecidedIndex && (
                  <p className="eyebrow mb-3">{i > 0 ? "Already decided" : "Past decisions"}</p>
                )}
                <ApprovalCard
                  approval={a}
                  reviewer={reviewer}
                  onDecided={onDecided}
                  context={<MilestoneContext milestone={ctx?.milestone} contract={ctx?.contract} />}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
