import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, formatDateTime, type Approval, type AuditEvent, type Contract, type Party } from "../api";
import { useAsync, useReviewerName } from "../hooks";
import AuditTrail from "../components/AuditTrail";
import MilestoneCard from "../components/MilestoneCard";
import {
  ContractStatusBadge,
  EmptyState,
  ErrorBox,
  GoneNotice,
  IconArrowLeft,
  IconChevron,
  IconDocument,
  IconScale,
  IconShield,
  IconUser,
  LoadingBlock,
  Money,
  SectionTitle,
  Spinner,
  StatTile,
} from "../components/ui";

function PartyCell({ party, role }: { party?: Party; role: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-100">
        <IconUser className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="eyebrow">{role}</p>
        <p className="truncate font-medium text-ink-900">{party?.name ?? "Not extracted"}</p>
        {party?.email && <p className="truncate text-xs text-ink-500">{party.email}</p>}
      </div>
    </div>
  );
}

function DealSummary({ contract }: { contract: Contract }) {
  const parties = contract.parties ?? [];
  const client = parties.find((p) => p.role === "client");
  const freelancer = parties.find((p) => p.role === "freelancer");
  const others = parties.filter((p) => p !== client && p !== freelancer);
  return (
    <div className="card p-4 sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-0 flex-1">
            <PartyCell party={client} role="Client" />
          </div>
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center self-start rounded-full border border-ink-200 bg-paper text-ink-500 sm:self-center"
            aria-hidden="true"
          >
            <span className="text-sm leading-none">⇄</span>
          </span>
          <div className="min-w-0 flex-1">
            <PartyCell party={freelancer} role="Freelancer" />
          </div>
        </div>
        <div className="border-t border-ink-100 pt-4 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0 lg:text-right">
          <p className="eyebrow">Contract value</p>
          <Money amount={contract.total_amount} currency={contract.currency} className="mt-1 block text-4xl leading-none text-ink-900" />
        </div>
      </div>
      {others.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2 border-t border-ink-100 pt-4">
          {others.map((p, i) => (
            <li key={i} className="rounded-full bg-ink-50 px-3 py-1 text-xs text-ink-700 ring-1 ring-inset ring-ink-200">
              <span className="text-ink-500">{p.role}:</span> {p.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KpiStrip({ contract }: { contract: Contract }) {
  const ms = contract.milestones ?? [];
  const sum = (pred: (s: string) => boolean) => ms.filter((m) => pred(m.status)).reduce((a, m) => a + (m.amount || 0), 0);
  const total = sum(() => true);
  const inEscrow = sum((s) => ["funded", "submitted", "approved", "rejected", "held"].includes(s));
  const released = sum((s) => s === "released");
  const releasedCount = ms.filter((m) => m.status === "released").length;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <StatTile
        label="Total across milestones"
        value={<Money amount={total} currency={contract.currency} />}
        hint={`${ms.length} milestone${ms.length === 1 ? "" : "s"}`}
      />
      <StatTile
        emphasis
        label="In escrow"
        value={<Money amount={inEscrow} currency={contract.currency} />}
        hint="Held safely until a human approves release"
      />
      <StatTile
        label="Released"
        value={<Money amount={released} currency={contract.currency} />}
        hint={`${releasedCount} of ${ms.length} paid out`}
      />
    </div>
  );
}

export default function ContractDetail() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
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

  // Re-check the contract when the tab regains focus: the in-memory backend may have restarted while
  // this page sat open, and it is better to say so up front than to fail on the next button click.
  const reloadContract = contract.reload;
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void reloadContract();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reloadContract]);

  if (contract.errorStatus === 404)
    return (
      <div className="space-y-4">
        <BackLink />
        <GoneNotice />
      </div>
    );
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

  return (
    <div className="min-w-0 space-y-6 sm:space-y-8">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <Link to="/" className="inline-flex items-center gap-1 text-ink-500 transition-colors hover:text-ink-900">
              <IconArrowLeft className="h-3.5 w-3.5" />
              Contracts
            </Link>
            <span className="text-ink-300" aria-hidden="true">/</span>
            <span className="text-ink-700">Escrow contract</span>
            <ContractStatusBadge status={c.status} />
          </nav>
          <h1 className="display break-words text-3xl leading-tight sm:text-4xl">{c.title || "Untitled contract"}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-500">
            <span className="inline-flex items-center gap-1.5">
              <IconDocument className="h-3.5 w-3.5" />
              Extracted by document agent
            </span>
            <span aria-hidden="true">·</span>
            <span>{formatDateTime(c.created_at)}</span>
            <span aria-hidden="true">·</span>
            <span className="break-all font-mono text-xs text-ink-400">{c.id}</span>
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary w-full shrink-0 sm:w-auto"
          disabled={refreshing}
          onClick={() => void refreshAll()}
        >
          {refreshing && <Spinner />}
          Refresh
        </button>
      </header>

      <ExtractionWarning contract={c} />

      <DealSummary contract={c} />

      <KpiStrip contract={c} />

      {contractApprovals.length > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-gold-100 bg-gold-50 px-4 py-3.5 text-sm text-gold-700 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-start gap-2.5">
            <IconScale className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="font-medium">{contractApprovals.length}</span> payment proposal
              {contractApprovals.length > 1 ? "s" : ""} awaiting human approval.
            </span>
          </span>
          <Link to="/approvals" className="btn-secondary btn-sm shrink-0">
            Open approvals inbox
          </Link>
        </div>
      )}

      <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* Milestones */}
        <section className="min-w-0" aria-labelledby="milestones-heading">
          <SectionTitle aside={`${milestones.length} milestone${milestones.length === 1 ? "" : "s"}`}>
            <span id="milestones-heading">Milestones</span>
          </SectionTitle>
          {milestones.length === 0 ? (
            <EmptyState title="No milestones extracted" icon={<IconDocument className="h-5 w-5" />}>
              The document agent could not find milestones in this contract.
            </EmptyState>
          ) : (
            <div className="space-y-5">
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
          )}

          {/* Contract text */}
          <details
            className="group card mt-8 overflow-hidden"
            open={params.get("tab") === "text" ? true : undefined}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 hover:bg-ink-50 sm:px-6 [&::-webkit-details-marker]:hidden">
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-50 text-ink-600 ring-1 ring-inset ring-ink-200">
                  <IconDocument className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="display block text-base">Original contract text</span>
                  <span className="block text-xs text-ink-500">As extracted by the document agent</span>
                </span>
              </span>
              <IconChevron className="h-4 w-4 shrink-0 text-ink-400 transition-transform group-open:rotate-90" />
            </summary>
            <div className="border-t border-ink-100 bg-paper-2/40 px-4 py-4 sm:px-6">
              {c.raw_text ? (
                <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-ink-700">
                  {c.raw_text}
                </pre>
              ) : (
                <p className="text-sm text-ink-400">No text was extracted from this document.</p>
              )}
            </div>
          </details>
        </section>

        {/* Audit trail */}
        <aside className="min-w-0" aria-labelledby="audit-heading">
          <div className="lg:sticky lg:top-6">
            <SectionTitle aside={audit.data ? `${audit.data.length} event${audit.data.length === 1 ? "" : "s"}` : undefined}>
              <span id="audit-heading">Audit trail</span>
            </SectionTitle>
            {audit.loading && !audit.data ? (
              <LoadingBlock label="Loading audit trail…" />
            ) : audit.error ? (
              <ErrorBox message={audit.error} onRetry={() => void audit.reload()} />
            ) : auditEvents.length === 0 ? (
              <EmptyState title="No audit events yet" icon={<IconShield className="h-5 w-5" />} />
            ) : (
              <div className="card p-4 sm:p-5 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
                <AuditTrail events={auditEvents} milestones={milestones} />
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/"
      className="inline-flex items-center gap-1.5 rounded-md text-sm text-ink-500 transition-colors hover:text-ink-900"
    >
      <IconArrowLeft className="h-4 w-4" />
      All contracts
    </Link>
  );
}

/** Problems that mean the uploaded document probably isn't a usable contract. */
/** A party "name" that is only a role word (e.g. "Client") means the extractor didn't find a real name. */
const PLACEHOLDER_NAME =
  /^(the\s+)?(client|customer|buyer|company|freelancer|service provider|provider|contractor|consultant|vendor|designer|developer|party\s*[a-z0-9]?|unknown|n\/?a|-+)$/i;

function realParties(c: Contract) {
  return c.parties.filter((p) => p.name && !PLACEHOLDER_NAME.test(p.name.trim()));
}

function extractionProblems(c: Contract): string[] {
  const problems: string[] = [];
  const parties = realParties(c);
  const roles = new Set(parties.map((p) => p.role));
  if (parties.length === 0) problems.push("No client or freelancer was found.");
  else if (!roles.has("client") || !roles.has("freelancer"))
    problems.push(`Only one party was found (${parties.map((p) => p.name).join(", ")}).`);
  if (c.milestones.length === 0) problems.push("No milestones were found.");
  const unpriced = c.milestones.filter((m) => !(m.amount > 0));
  if (unpriced.length > 0)
    problems.push(
      unpriced.length === c.milestones.length
        ? "No milestone has an amount, so nothing can be funded."
        : `${unpriced.length} milestone${unpriced.length > 1 ? "s have" : " has"} no amount and can't be funded.`,
    );
  return problems;
}

function ExtractionWarning({ contract }: { contract: Contract }) {
  const problems = extractionProblems(contract);
  if (problems.length === 0) return null;
  const severe = realParties(contract).length === 0 && !contract.milestones.some((m) => m.amount > 0);
  return (
    <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3.5 text-sm text-amber-900 sm:px-5">
      <p className="font-medium">
        {severe ? "This doesn't look like a contract." : "Some contract details are missing."}
      </p>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-amber-800">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <p className="mt-2 text-amber-800">
        {severe
          ? "Check that you uploaded the signed contract — not a delivery note or invoice — then upload it again."
          : "Check the original document; if it's correct, the amounts may be written in a format HoldFast couldn't read."}{" "}
        <Link to="/" className="font-medium underline underline-offset-2">
          Upload another contract
        </Link>
      </p>
    </div>
  );
}
