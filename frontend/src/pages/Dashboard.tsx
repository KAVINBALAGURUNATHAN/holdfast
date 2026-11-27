import { useRef, useState, type FormEvent, type RefObject } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, formatDate, type Contract, type MilestoneStatus } from "../api";
import { useAsync } from "../hooks";
import {
  ContractStatusBadge,
  EmptyState,
  ErrorBox,
  IconChevron,
  IconDocument,
  IconLock,
  IconSparkle,
  IconUpload,
  Money,
  PageHeader,
  SectionTitle,
  Skeleton,
  Spinner,
  StatTile,
} from "../components/ui";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain";

const IN_ESCROW: MilestoneStatus[] = ["funded", "submitted", "approved", "held"];
const AWAITING_DECISION: MilestoneStatus[] = ["submitted", "held"];

type BusyKind = "upload" | null;

/** Shared create-contract state so the header and the upload card drive the same flow. */
function useContractCreator(onCreated: (c: Contract) => void) {
  const [busy, setBusy] = useState<BusyKind>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: "upload", file: File | null, title: string) => {
    setBusy(kind);
    setError(null);
    try {
      if (!file) return;
      const c = await api.uploadContract(file, title);
      onCreated(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return { busy, error, run };
}

// ---------- Upload card ----------

function UploadPanel({
  busy,
  error,
  inputRef,
  onUpload,
}: {
  busy: BusyKind;
  error: string | null;
  inputRef: RefObject<HTMLInputElement>;
  onUpload: (file: File, title: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (file) onUpload(file, title);
  };

  return (
    <section className="card overflow-hidden" aria-labelledby="new-contract-heading">
      <div className="flex items-start gap-3 border-b border-ink-100 px-5 py-4 sm:px-6">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-50 text-accent-700">
          <IconSparkle className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 id="new-contract-heading" className="display text-lg">
            New contract
          </h2>
          <p className="mt-0.5 text-sm leading-relaxed text-ink-500">
            The document agent reads your contract (OCR + extraction) and drafts parties, milestones, amounts and
            acceptance criteria.
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="grid gap-5 p-5 sm:p-6">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) setFile(f);
          }}
          className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors sm:py-10 ${
            dragOver
              ? "border-accent-500 bg-accent-50"
              : file
                ? "border-accent-300 bg-accent-50/50"
                : "border-ink-200 bg-paper/60 hover:border-ink-300"
          }`}
        >
          <span
            className={`flex h-12 w-12 items-center justify-center rounded-full ring-1 ring-inset ${
              file || dragOver ? "bg-white text-accent-700 ring-accent-200" : "bg-white text-ink-500 ring-ink-200"
            }`}
          >
            {file ? <IconDocument className="h-5 w-5" /> : <IconUpload className="h-5 w-5" />}
          </span>
          {file ? (
            <p className="max-w-full break-all text-sm text-ink-800">
              <span className="font-medium">{file.name}</span>{" "}
              <span className="text-ink-500">({Math.max(1, Math.round(file.size / 1024))} KB)</span>
            </p>
          ) : (
            <div>
              <p className="display text-base">Drop your signed contract here</p>
              <p className="mt-0.5 text-sm text-ink-500">or choose a file from your device</p>
            </div>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => inputRef.current?.click()}>
              {file ? "Choose another" : "Choose file"}
            </button>
            {file && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => {
                  setFile(null);
                  if (inputRef.current) inputRef.current.value = "";
                }}
              >
                Clear
              </button>
            )}
          </div>
          <p className="eyebrow text-ink-400">PDF, PNG, JPG or TXT</p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            aria-label="Contract file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label htmlFor="title" className="label">
              Title (optional)
            </label>
            <input
              id="title"
              className="input"
              placeholder="e.g. Website redesign — Acme Traders"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={!file || busy !== null}>
            {busy === "upload" ? <Spinner /> : <IconDocument />}
            {busy === "upload" ? "Extracting…" : "Upload & extract"}
          </button>
        </div>

        <p className="flex items-center gap-1.5 text-xs text-ink-500">
          <IconLock className="h-3.5 w-3.5 shrink-0" />
          Funds are only released milestone by milestone, after review.
        </p>
      </form>

      {error && (
        <div className="px-5 pb-5 sm:px-6 sm:pb-6">
          <ErrorBox message={error} />
        </div>
      )}
    </section>
  );
}

// ---------- KPIs ----------

function sumMilestones(contracts: Contract[], statuses: MilestoneStatus[]): number {
  return contracts.reduce(
    (acc, c) =>
      acc + (c.milestones ?? []).reduce((s, m) => (statuses.includes(m.status) ? s + (m.amount || 0) : s), 0),
    0,
  );
}

function KpiRow({ contracts }: { contracts: Contract[] }) {
  const currencies = new Set(contracts.map((c) => c.currency || "INR"));
  // Money totals only make sense when every contract uses the same currency.
  const currency = currencies.size === 1 ? [...currencies][0] : null;
  const totalValue = contracts.reduce((s, c) => s + (c.total_amount || 0), 0);
  const inEscrow = sumMilestones(contracts, IN_ESCROW);
  const released = sumMilestones(contracts, ["released"]);
  const allMilestones = contracts.flatMap((c) => c.milestones ?? []);
  const awaiting = allMilestones.filter((m) => AWAITING_DECISION.includes(m.status)).length;
  const active = contracts.filter((c) => c.status === "active").length;

  return (
    <section aria-label="Workspace summary" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {currency && (
        <StatTile
          emphasis
          label="Currently in escrow"
          value={<Money amount={inEscrow} currency={currency} />}
          hint="Funded milestones not yet released"
        />
      )}
      {currency && (
        <StatTile
          label="Total under contract"
          value={<Money amount={totalValue} currency={currency} />}
          hint={`${contracts.length} contract${contracts.length === 1 ? "" : "s"} · ${active} active`}
        />
      )}
      {currency && (
        <StatTile
          label="Released to date"
          value={<Money amount={released} currency={currency} />}
          hint="Paid out after approval"
        />
      )}
      <StatTile
        label="Awaiting a decision"
        value={<span className="money">{awaiting}</span>}
        hint={`of ${allMilestones.length} milestone${allMilestones.length === 1 ? "" : "s"} · submitted or held`}
      />
    </section>
  );
}

// ---------- Contract list ----------

const segmentClass: Record<MilestoneStatus, string> = {
  pending: "bg-ink-200",
  funded: "bg-accent-300",
  submitted: "bg-accent-400",
  approved: "bg-accent-500",
  released: "bg-accent-700",
  held: "bg-amber-400",
  rejected: "bg-rose-400",
};

function MilestoneProgress({ c }: { c: Contract }) {
  const ms = [...(c.milestones ?? [])].sort((a, b) => a.seq - b.seq);
  const released = ms.filter((m) => m.status === "released").length;
  if (ms.length === 0) return <p className="text-xs text-ink-400">No milestones yet</p>;
  return (
    <div className="w-full">
      <div
        className="flex h-1.5 gap-0.5 overflow-hidden rounded-full"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={ms.length}
        aria-valuenow={released}
        aria-label={`${released} of ${ms.length} milestones released`}
      >
        {ms.map((m) => (
          <span key={m.id} className={`h-full flex-1 ${segmentClass[m.status] ?? "bg-ink-200"}`} />
        ))}
      </div>
      <p className="mt-1.5 text-xs text-ink-500">
        <span className="font-medium text-ink-700">
          {released} of {ms.length}
        </span>{" "}
        milestone{ms.length === 1 ? "" : "s"} released
      </p>
    </div>
  );
}

function ContractRow({ c }: { c: Contract }) {
  const client = c.parties?.find((p) => p.role === "client")?.name;
  const freelancer = c.parties?.find((p) => p.role === "freelancer")?.name;
  return (
    <li>
      <Link
        to={`/contracts/${c.id}`}
        className="group flex items-start gap-4 px-4 py-4 transition-colors hover:bg-ink-50 focus-visible:bg-ink-50 sm:items-center sm:px-5 sm:py-5"
      >
        <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-100 sm:flex">
          <IconDocument className="h-5 w-5" />
        </span>

        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-center sm:gap-6 lg:grid-cols-[minmax(0,1fr)_12rem_9rem]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="display min-w-0 truncate text-lg leading-snug">{c.title || "Untitled contract"}</p>
              <ContractStatusBadge status={c.status} />
            </div>
            <p className="mt-0.5 truncate text-sm text-ink-500">
              {[client, freelancer].filter(Boolean).join(" ↔ ") || "Parties not detected"} · {formatDate(c.created_at)}
            </p>
          </div>

          <div className="order-last sm:order-none lg:order-none">
            <MilestoneProgress c={c} />
          </div>

          <div className="flex items-baseline justify-between gap-2 sm:col-span-2 sm:justify-start lg:col-span-1 lg:block lg:text-right">
            <span className="eyebrow lg:hidden">Contract value</span>
            <Money amount={c.total_amount} currency={c.currency} className="text-xl text-ink-900" />
          </div>
        </div>

        <IconChevron className="mt-1 h-4 w-4 shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5 group-hover:text-ink-600 sm:mt-0" />
      </Link>
    </li>
  );
}

function ContractListSkeleton() {
  return (
    <div className="card divide-y divide-ink-100 overflow-hidden" role="status" aria-label="Loading contracts">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-5 sm:px-5">
          <Skeleton className="hidden h-10 w-10 shrink-0 rounded-xl sm:block" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="hidden h-2 w-32 sm:block" />
          <Skeleton className="h-5 w-20" />
        </div>
      ))}
      <span className="sr-only">Loading contracts…</span>
    </div>
  );
}

// ---------- Page ----------

export default function Dashboard() {
  const navigate = useNavigate();
  const contracts = useAsync(() => api.listContracts(), []);
  const creator = useContractCreator((c) => navigate(`/contracts/${c.id}`));
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sorted = [...(contracts.data ?? [])].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const initialLoading = contracts.loading && !contracts.data;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Workspace"
        title="Contracts"
        description="Turn a signed contract into milestone escrow with an auditable trail of every agent and human decision."
        actions={
          <>
            <button type="button" className="btn-primary" onClick={() => fileInputRef.current?.click()}>
              <IconUpload />
              Upload contract
            </button>
          </>
        }
      />

      {!initialLoading && !contracts.error && sorted.length > 0 && <KpiRow contracts={sorted} />}

      <UploadPanel
        busy={creator.busy}
        error={creator.error}
        inputRef={fileInputRef}
        onUpload={(file, title) => void creator.run("upload", file, title)}
      />

      <section aria-labelledby="all-contracts-heading">
        <SectionTitle
          aside={
            <button type="button" className="btn-ghost btn-sm" onClick={() => void contracts.reload()}>
              {contracts.loading && contracts.data ? <Spinner className="h-3 w-3" /> : null}
              Refresh
            </button>
          }
        >
          <span id="all-contracts-heading">All contracts</span>
        </SectionTitle>
        {initialLoading ? (
          <ContractListSkeleton />
        ) : contracts.error ? (
          <ErrorBox message={contracts.error} onRetry={() => void contracts.reload()} />
        ) : sorted.length === 0 ? (
          <EmptyState title="No contracts yet" icon={<IconDocument className="h-5 w-5" />}>
            Upload a signed contract (PDF, image or text). HoldFast extracts the parties, milestones, amounts and acceptance criteria for you to review.
          </EmptyState>
        ) : (
          <ul className="card divide-y divide-ink-100 overflow-hidden">
            {sorted.map((c) => (
              <ContractRow key={c.id} c={c} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
