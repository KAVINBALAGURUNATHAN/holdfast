import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  api,
  formatDate,
  formatDateTime,
  isGoneError,
  isSimulatedOrder,
  notifyApprovalsChanged,
  type Approval,
  type Milestone,
  type Submission,
} from "../api";
import ApprovalCard from "./ApprovalCard";
import VerdictCard from "./VerdictCard";
import {
  ErrorBox,
  EscrowTimeline,
  GoneNotice,
  IconCheck,
  IconClock,
  IconDocument,
  IconExternal,
  IconLock,
  IconUpload,
  IconWallet,
  MilestoneStatusBadge,
  Money,
  Spinner,
} from "./ui";

interface Props {
  milestone: Milestone;
  currency: string;
  approvals: Approval[];
  reviewer: string;
  onChanged: () => void;
}

const SUBMITTABLE: Milestone["status"][] = ["funded", "rejected", "held"];
const HAS_SUBMISSIONS: Milestone["status"][] = ["submitted", "approved", "rejected", "released", "held"];

function isOverdue(m: Milestone): boolean {
  if (!m.due_date || m.status === "released") return false;
  const d = new Date(m.due_date);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now() - 86400000;
}

export default function MilestoneCard({ milestone: m, currency, approvals, reviewer, onChanged }: Props) {
  const [error, setError] = useState<string | null>(null);
  // Set when the server answers 404 for this milestone (in-memory backend restarted since page load).
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState<"fund" | "capture" | "submit" | null>(null);
  const [paypal, setPaypal] = useState<{ orderId: string; url: string } | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [subsError, setSubsError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const fail = (e: unknown) => {
    if (isGoneError(e)) {
      setGone(true);
      setError(null);
      setPaypal(null);
      onChanged(); // re-fetch the contract so the whole page reflects that it is gone
    } else {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Load submission history (and latest verdict) once the milestone has any.
  useEffect(() => {
    if (!HAS_SUBMISSIONS.includes(m.status)) return;
    let cancelled = false;
    api
      .listSubmissions(m.id)
      .then((s) => {
        if (!cancelled) {
          setSubmissions(s);
          setSubsError(null);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (isGoneError(e)) setGone(true);
        else setSubsError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [m.id, m.status]);

  // Order created earlier but buyer approval not yet captured (e.g. after a page reload).
  const resumableOrder =
    m.status === "pending" && m.escrow_order_id && !isSimulatedOrder(m.escrow_order_id) ? m.escrow_order_id : null;
  const awaitingOrder = paypal?.orderId ?? resumableOrder;

  const fund = async () => {
    setBusy("fund");
    setError(null);
    try {
      const res = await api.fundMilestone(m.id);
      if (/^https?:\/\//i.test(res.approve_url ?? "") && !isSimulatedOrder(res.order_id)) {
        setPaypal({ orderId: res.order_id, url: res.approve_url });
        window.open(res.approve_url, "_blank", "noopener,noreferrer");
      } else {
        // Simulated escrow (SIM- order): no buyer approval step.
        setBusy("capture");
        await api.captureFunding(m.id, res.order_id);
        onChanged();
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const capture = async () => {
    if (!awaitingOrder) return;
    setBusy("capture");
    setError(null);
    try {
      await api.captureFunding(m.id, awaitingOrder);
      setPaypal(null);
      onChanged();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!notes.trim() && !file) {
      setError("Add notes or attach a file describing the deliverable.");
      return;
    }
    setBusy("submit");
    setError(null);
    try {
      const s = await api.submitDeliverable(m.id, notes, file);
      setSubmissions((prev) => [s, ...(prev ?? []).filter((x) => x.id !== s.id)]);
      setShowForm(false);
      setNotes("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      notifyApprovalsChanged();
      onChanged();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const sortedSubs = [...(submissions ?? [])].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const latest = sortedSubs[0];
  const earlier = sortedSubs.slice(1);
  const pendingApprovals = approvals.filter((a) => a.status === "pending");
  const overdue = isOverdue(m);
  const criteria = m.acceptance_criteria ?? [];

  return (
    <article className="card overflow-hidden" aria-labelledby={`ms-title-${m.id}`}>
      {/* Header */}
      <div className="px-4 pb-5 pt-5 sm:px-6 sm:pt-6">
        <div className="flex items-center justify-between gap-3">
          <p className="eyebrow">Milestone {m.seq}</p>
          <MilestoneStatusBadge status={m.status} />
        </div>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <h3 id={`ms-title-${m.id}`} className="display break-words text-xl leading-snug sm:text-2xl">
              {m.title}
            </h3>
            {m.description && (
              <p className="mt-1.5 max-w-prose break-words text-sm leading-relaxed text-ink-600">{m.description}</p>
            )}
          </div>
          <div className="shrink-0 sm:text-right">
            <p className="text-[11px] font-medium text-ink-500">Milestone value</p>
            <Money amount={m.amount} currency={currency} className="mt-0.5 block text-3xl leading-none text-ink-900" />
          </div>
        </div>

        <dl className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <div className="flex items-center gap-1.5">
            <dt className="flex items-center gap-1.5 text-ink-500">
              <IconClock className="h-3.5 w-3.5" />
              Due
            </dt>
            <dd className={overdue ? "font-medium text-rose-700" : "font-medium text-ink-800"}>
              {formatDate(m.due_date)}
              {overdue && " · overdue"}
            </dd>
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <dt className="flex shrink-0 items-center gap-1.5 text-ink-500">
              <IconLock className="h-3.5 w-3.5" />
              Escrow order
            </dt>
            <dd className="min-w-0 break-all font-mono text-[11px] text-ink-700">
              {m.escrow_order_id ?? "—"}
              {m.escrow_order_id && isSimulatedOrder(m.escrow_order_id) && (
                <span className="ml-1.5 rounded bg-gold-50 px-1.5 py-0.5 font-sans text-[10px] font-medium text-gold-700">
                  simulated
                </span>
              )}
            </dd>
          </div>
        </dl>

        <div className="mt-5 rounded-xl border border-ink-200/70 bg-paper-2/40 px-2 pb-2.5 pt-3 sm:px-4">
          <EscrowTimeline status={m.status} />
        </div>
      </div>

      {/* Acceptance criteria */}
      <div className="border-t border-ink-100 px-4 py-5 sm:px-6">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <p className="eyebrow">Acceptance criteria</p>
          {criteria.length > 0 && <p className="text-xs text-ink-400">{criteria.length} to verify</p>}
        </div>
        {criteria.length ? (
          <ul className="space-y-2.5">
            {criteria.map((c, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed text-ink-700">
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-ink-200 bg-white font-serif text-[11px] text-ink-500"
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <span className="min-w-0 break-words">{c}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-400">None extracted.</p>
        )}
      </div>

      {/* Actions */}
      <div className="space-y-4 border-t border-ink-100 bg-paper-2/40 px-4 py-4 sm:px-6 sm:py-5">
        {gone && <GoneNotice />}

        {!gone && m.status === "pending" && !awaitingOrder && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-accent-700 ring-1 ring-inset ring-ink-200">
                <IconWallet className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-900">Fund this milestone</p>
                <p className="text-sm text-ink-600">
                  {m.amount > 0
                    ? "Client funds go into sandbox escrow (authorized, not captured)."
                    : "This milestone has no amount in the contract, so it can't be funded."}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="btn-primary w-full shrink-0 sm:w-auto"
              disabled={busy !== null || !(m.amount > 0)}
              title={m.amount > 0 ? undefined : "No amount was found for this milestone"}
              onClick={() => void fund()}
            >
              {busy ? <Spinner /> : <IconWallet />}
              {busy === "capture" ? "Authorizing…" : busy === "fund" ? "Creating order…" : "Fund escrow"}
            </button>
          </div>
        )}

        {!gone && m.status === "pending" && awaitingOrder && (
          <div className="rounded-xl border border-accent-200 bg-accent-50/70 p-4">
            <p className="text-sm font-medium text-accent-800">Approve the payment in the PayPal sandbox window</p>
            <p className="mt-1 text-sm text-ink-600">
              Order <code className="break-all font-mono text-xs text-ink-800">{awaitingOrder}</code>. After you approve it,
              PayPal returns you to HoldFast and the escrow is funded automatically. If that tab was closed, confirm
              below to authorize the escrow hold.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button type="button" className="btn-primary" disabled={busy !== null} onClick={() => void capture()}>
                {busy === "capture" && <Spinner />}
                I've approved in PayPal
              </button>
              {paypal?.url && (
                <a href={paypal.url} target="_blank" rel="noopener noreferrer" className="btn-secondary">
                  <IconExternal />
                  Open PayPal again
                </a>
              )}
              <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => void fund()}>
                Start a new order
              </button>
            </div>
          </div>
        )}

        {!gone && SUBMITTABLE.includes(m.status) && !showForm && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-accent-700 ring-1 ring-inset ring-ink-200">
                {m.status === "funded" ? <IconLock className="h-4 w-4" /> : <IconUpload className="h-4 w-4" />}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-900">
                  {m.status === "funded" ? "Funds secured in escrow" : "Revision needed"}
                </p>
                <p className="text-sm text-ink-600">
                  {m.status === "funded"
                    ? "Funds are held in escrow. The freelancer can now submit the deliverable."
                    : "Submit a revised deliverable for a fresh review."}
                </p>
              </div>
            </div>
            <button type="button" className="btn-primary w-full shrink-0 sm:w-auto" onClick={() => setShowForm(true)}>
              <IconUpload />
              {m.status === "funded" ? "Submit deliverable" : "Resubmit"}
            </button>
          </div>
        )}

        {!gone && showForm && (
          <form onSubmit={submit} className="space-y-4 rounded-xl border border-ink-200/70 bg-white p-4 shadow-soft sm:p-5">
            <div>
              <p className="display text-lg">Submit deliverable</p>
              <p className="mt-0.5 text-xs text-ink-500">
                The referee agent checks your submission against each acceptance criterion.
              </p>
            </div>
            <div>
              <label htmlFor={`notes-${m.id}`} className="label">
                Delivery notes
              </label>
              <textarea
                id={`notes-${m.id}`}
                className="input min-h-[120px] resize-y leading-relaxed"
                placeholder="Describe what was delivered and how it meets each acceptance criterion…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor={`file-${m.id}`} className="label">
                Attachment (optional)
              </label>
              <div className="relative">
                <input
                  id={`file-${m.id}`}
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.txt,.md"
                  aria-describedby={`file-hint-${m.id}`}
                  className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <div
                  className={`flex items-center gap-3 rounded-lg border border-dashed px-3 py-3 transition-colors peer-hover:border-accent-400 peer-hover:bg-accent-50/40 peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500 peer-focus-visible:ring-offset-2 ${
                    file ? "border-accent-300 bg-accent-50/50" : "border-ink-300 bg-ink-50"
                  }`}
                  aria-hidden="true"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-accent-700 ring-1 ring-inset ring-ink-200">
                    {file ? <IconDocument className="h-4 w-4" /> : <IconUpload className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-800">{file ? file.name : "Choose a file"}</p>
                    <p className="text-xs text-ink-500">{file ? "Click to replace" : "or drop it here"}</p>
                  </div>
                </div>
              </div>
              <p id={`file-hint-${m.id}`} className="mt-1.5 text-xs text-ink-400">
                PDF, PNG, JPG, TXT or Markdown.
              </p>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-ink-100 pt-4 sm:flex-row sm:justify-end">
              <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={busy !== null}>
                {busy === "submit" && <Spinner />}
                {busy === "submit" ? "Referee agent reviewing…" : "Submit for review"}
              </button>
            </div>
          </form>
        )}

        {m.status === "released" && (
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-inset ring-emerald-200">
              <IconCheck className="h-3 w-3" />
            </span>
            Payment released to the freelancer after human approval.
          </p>
        )}

        {error && <ErrorBox message={error} />}
      </div>

      {/* Verdict & approvals */}
      {(latest || pendingApprovals.length > 0 || subsError) && (
        <div className="space-y-4 border-t border-ink-100 px-4 py-5 sm:px-6">
          {subsError && <ErrorBox message={`Could not load submissions: ${subsError}`} />}
          {latest && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <p className="eyebrow">Latest submission</p>
                <p className="text-xs text-ink-500">
                  {formatDateTime(latest.created_at)}
                  {latest.file_name && (
                    <>
                      {" "}
                      · <span className="break-all font-medium text-ink-700">{latest.file_name}</span>
                    </>
                  )}
                </p>
              </div>
              {latest.notes && (
                <p className="whitespace-pre-line break-words rounded-xl border border-ink-200/70 bg-ink-50 p-3 text-sm leading-relaxed text-ink-700">
                  {latest.notes}
                </p>
              )}
              {latest.verdict ? (
                <VerdictCard verdict={latest.verdict} />
              ) : (
                <p className="text-sm text-ink-500">No verdict recorded for this submission yet.</p>
              )}
            </div>
          )}

          {pendingApprovals.map((a) => (
            <ApprovalCard key={a.id} approval={a} reviewer={reviewer} onDecided={() => onChanged()} />
          ))}

          {earlier.length > 0 && (
            <div>
              <button
                type="button"
                className="btn-ghost btn-sm -ml-3 text-accent-700 hover:text-accent-800"
                aria-expanded={showHistory}
                onClick={() => setShowHistory((s) => !s)}
              >
                {showHistory ? "Hide" : "Show"} {earlier.length} earlier submission{earlier.length > 1 ? "s" : ""}
              </button>
              {showHistory && (
                <ul className="mt-3 space-y-4">
                  {earlier.map((s) => (
                    <li key={s.id} className="space-y-2 border-l-2 border-ink-200 pl-3 sm:pl-4">
                      <p className="text-xs text-ink-500">
                        {formatDateTime(s.created_at)}
                        {s.file_name && ` · ${s.file_name}`}
                      </p>
                      {s.notes && <p className="break-words text-sm text-ink-600">{s.notes}</p>}
                      {s.verdict && <VerdictCard verdict={s.verdict} />}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
