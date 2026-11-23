import { useCallback, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, formatDateTime, formatMoney, type Approval, type AuditEvent, type Contract } from "../api";
import { useAsync, useReviewerName } from "../hooks";
import AuditTrail from "../components/AuditTrail";
import MilestoneCard from "../components/MilestoneCard";
import { ContractStatusBadge, EmptyState, ErrorBox, IconArrowLeft, IconUser, LoadingBlock, Spinner } from "../components/ui";

type Tab = "milestones" | "audit" | "text";

function PartiesPanel({ contract }: { contract: Contract }) {
  const parties = contract.parties ?? [];
  if (!parties.length) return <p className="text-sm text-slate-400">No parties extracted.</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {parties.map((p, i) => (
        <li key={i} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
            <IconUser className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{p.role}</p>
            <p className="truncate font-medium text-slate-900">{p.name}</p>
            {p.email && <p className="truncate text-sm text-slate-500">{p.email}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Summary({ contract }: { contract: Contract }) {
  const ms = contract.milestones ?? [];
  const sum = (pred: (s: string) => boolean) => ms.filter((m) => pred(m.status)).reduce((a, m) => a + (m.amount || 0), 0);
  const inEscrow = sum((s) => ["funded", "submitted", "approved", "rejected", "held"].includes(s));
  const released = sum((s) => s === "released");
  const stats = [
    { label: "Contract value", value: formatMoney(contract.total_amount, contract.currency) },
    { label: "In escrow", value: formatMoney(inEscrow, contract.currency) },
    { label: "Released", value: formatMoney(released, contract.currency) },
    { label: "Milestones", value: String(ms.length) },
  ];
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 lg:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="bg-white px-4 py-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{s.label}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function ContractDetail() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (["milestones", "audit", "text"] as const).includes(params.get("tab") as Tab)
    ? (params.get("tab") as Tab)
    : "milestones";
  const setTab = (t: Tab) => setParams(t === "milestones" ? {} : { tab: t }, { replace: true });
  const [reviewer] = useReviewerName();

  const contract = useAsync(() => api.getContract(id), [id]);
  const approvals = useAsync<Approval[]>(() => api.listApprovals("pending"), [id]);
  const audit = useAsync<AuditEvent[]>(() => api.getAudit(id), [id]);
  const [refreshing, setRefreshing] = useState(false);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([contract.reload(), approvals.reload(), audit.reload()]);
    setRefreshing(false);
  }, [contract, approvals, audit]);

  if (contract.loading && !contract.data) return <LoadingBlock label="Loading contract…" />;
  if (contract.error && !contract.data)
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorBox message={contract.error} onRetry={() => void contract.reload()} />
      </div>
    );
  const c = contract.data;
  if (!c) return null;

  const milestones = [...(c.milestones ?? [])].sort((a, b) => a.seq - b.seq);
  const milestoneIds = new Set(milestones.map((m) => m.id));
  const contractApprovals = (approvals.data ?? []).filter((a) => milestoneIds.has(a.milestone_id));
  const auditEvents = [...(audit.data ?? [])].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "milestones", label: "Milestones", count: milestones.length },
    { key: "audit", label: "Audit trail", count: audit.data?.length },
    { key: "text", label: "Contract text" },
  ];

  return (
    <div className="space-y-6">
      <BackLink />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{c.title || "Untitled contract"}</h1>
            <ContractStatusBadge status={c.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Extracted by document agent · {formatDateTime(c.created_at)} · <span className="font-mono text-xs">{c.id}</span>
          </p>
        </div>
        <button type="button" className="btn-secondary shrink-0" disabled={refreshing} onClick={() => void refreshAll()}>
          {refreshing && <Spinner />}
          Refresh
        </button>
      </div>

      <Summary contract={c} />

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Parties</h2>
        <PartiesPanel contract={c} />
      </section>

      {contractApprovals.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {contractApprovals.length} payment proposal{contractApprovals.length > 1 ? "s" : ""} awaiting human approval.
          </span>
          <Link to="/approvals" className="font-medium underline underline-offset-2">
            Open approvals inbox
          </Link>
        </div>
      )}

      <div>
        <div className="border-b border-slate-200" role="tablist">
          <div className="-mb-px flex gap-4 overflow-x-auto sm:gap-6">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`whitespace-nowrap border-b-2 px-1 py-2.5 text-sm font-medium transition-colors ${
                  tab === t.key
                    ? "border-accent-600 text-accent-700"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
                }`}
              >
                {t.label}
                {t.count !== undefined && (
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{t.count}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-5">
          {tab === "milestones" &&
            (milestones.length === 0 ? (
              <EmptyState title="No milestones extracted">
                The document agent could not find milestones in this contract.
              </EmptyState>
            ) : (
              <div className="space-y-4">
                {approvals.error && <ErrorBox message={`Could not load approvals: ${approvals.error}`} />}
                {milestones.map((m) => (
                  <MilestoneCard
                    key={m.id}
                    milestone={m}
                    currency={c.currency}
                    approvals={contractApprovals.filter((a) => a.milestone_id === m.id)}
                    reviewer={reviewer}
                    onChanged={() => void refreshAll()}
                  />
                ))}
              </div>
            ))}

          {tab === "audit" &&
            (audit.loading && !audit.data ? (
              <LoadingBlock label="Loading audit trail…" />
            ) : audit.error ? (
              <ErrorBox message={audit.error} onRetry={() => void audit.reload()} />
            ) : auditEvents.length === 0 ? (
              <EmptyState title="No audit events yet" />
            ) : (
              <div className="card p-4 sm:p-6">
                <AuditTrail events={auditEvents} milestones={milestones} />
              </div>
            ))}

          {tab === "text" && (
            <div className="card p-4 sm:p-6">
              {c.raw_text ? (
                <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-slate-700">
                  {c.raw_text}
                </pre>
              ) : (
                <p className="text-sm text-slate-400">No text was extracted from this document.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
      <IconArrowLeft className="h-4 w-4" />
      All contracts
    </Link>
  );
}
