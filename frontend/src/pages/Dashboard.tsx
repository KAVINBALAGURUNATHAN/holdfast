import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, formatDate, formatMoney, type Contract } from "../api";
import { useAsync } from "../hooks";
import {
  ContractStatusBadge,
  EmptyState,
  ErrorBox,
  IconChevron,
  IconDocument,
  IconUpload,
  LoadingBlock,
  Spinner,
} from "../components/ui";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain";

function UploadPanel({ onCreated }: { onCreated: (c: Contract) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<"upload" | "seed" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = async (kind: "upload" | "seed") => {
    setBusy(kind);
    setError(null);
    try {
      const c = kind === "upload" && file ? await api.uploadContract(file, title) : await api.seedDemo();
      onCreated(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (file) void run("upload");
  };

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-slate-900">New contract</h2>
        <p className="text-sm text-slate-500">
          The document agent reads your contract (OCR + extraction) and drafts parties, milestones, amounts and
          acceptance criteria.
        </p>
      </div>

      <form onSubmit={onSubmit} className="mt-5 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <div className="grid gap-4 sm:grid-cols-2">
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
            className={`sm:col-span-2 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
              dragOver ? "border-accent-500 bg-accent-50" : "border-slate-300 bg-slate-50"
            }`}
          >
            <IconUpload className="h-6 w-6 text-slate-400" />
            {file ? (
              <p className="text-sm text-slate-700">
                <span className="font-medium">{file.name}</span>{" "}
                <span className="text-slate-500">({Math.max(1, Math.round(file.size / 1024))} KB)</span>
              </p>
            ) : (
              <p className="text-sm text-slate-600">Drag a contract here, or</p>
            )}
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" onClick={() => inputRef.current?.click()}>
                {file ? "Choose another" : "Choose file"}
              </button>
              {file && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setFile(null);
                    if (inputRef.current) inputRef.current.value = "";
                  }}
                >
                  Clear
                </button>
              )}
            </div>
            <p className="text-xs text-slate-400">PDF, PNG, JPG or TXT</p>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="sm:col-span-2">
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
        </div>

        <div className="flex flex-col gap-2 sm:flex-row md:flex-col">
          <button type="submit" className="btn-primary" disabled={!file || busy !== null}>
            {busy === "upload" ? <Spinner /> : <IconDocument />}
            {busy === "upload" ? "Extracting…" : "Upload & extract"}
          </button>
          <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => void run("seed")}>
            {busy === "seed" && <Spinner />}
            Load sample contract
          </button>
        </div>
      </form>

      {error && (
        <div className="mt-4">
          <ErrorBox message={error} />
        </div>
      )}
    </section>
  );
}

function ContractRow({ c }: { c: Contract }) {
  const ms = c.milestones ?? [];
  const released = ms.filter((m) => m.status === "released").length;
  const client = c.parties?.find((p) => p.role === "client")?.name;
  const freelancer = c.parties?.find((p) => p.role === "freelancer")?.name;
  return (
    <li>
      <Link
        to={`/contracts/${c.id}`}
        className="group flex items-center gap-4 px-4 py-4 transition-colors hover:bg-slate-50 sm:px-5"
      >
        <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 sm:flex">
          <IconDocument className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium text-slate-900">{c.title || "Untitled contract"}</p>
            <ContractStatusBadge status={c.status} />
          </div>
          <p className="mt-0.5 truncate text-sm text-slate-500">
            {[client, freelancer].filter(Boolean).join(" ↔ ") || "Parties not detected"} · {formatDate(c.created_at)}
          </p>
        </div>
        <div className="text-right">
          <p className="font-semibold tabular-nums text-slate-900">{formatMoney(c.total_amount, c.currency)}</p>
          <p className="text-xs text-slate-500">
            {released}/{ms.length} milestones released
          </p>
        </div>
        <IconChevron className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-slate-600" />
      </Link>
    </li>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const contracts = useAsync(() => api.listContracts(), []);

  const sorted = [...(contracts.data ?? [])].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Contracts</h1>
        <p className="mt-1 text-sm text-slate-500">
          Turn a signed contract into milestone escrow with an auditable trail of every agent and human decision.
        </p>
      </div>

      <UploadPanel onCreated={(c) => navigate(`/contracts/${c.id}`)} />

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">All contracts</h2>
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => void contracts.reload()}>
            Refresh
          </button>
        </div>
        {contracts.loading && !contracts.data ? (
          <LoadingBlock label="Loading contracts…" />
        ) : contracts.error ? (
          <ErrorBox message={contracts.error} onRetry={() => void contracts.reload()} />
        ) : sorted.length === 0 ? (
          <EmptyState title="No contracts yet">Upload one above, or load the sample contract to try the flow.</EmptyState>
        ) : (
          <ul className="card divide-y divide-slate-100 overflow-hidden">
            {sorted.map((c) => (
              <ContractRow key={c.id} c={c} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
