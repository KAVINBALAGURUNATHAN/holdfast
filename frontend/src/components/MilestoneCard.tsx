import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  api,
  formatDate,
  formatDateTime,
  formatMoney,
  isSimulatedOrder,
  notifyApprovalsChanged,
  type Approval,
  type Milestone,
  type Submission,
} from "../api";
import ApprovalCard from "./ApprovalCard";
import VerdictCard from "./VerdictCard";
import { ErrorBox, IconExternal, IconUpload, IconWallet, MilestoneStatusBadge, Spinner } from "./ui";

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
  const [busy, setBusy] = useState<"fund" | "capture" | "submit" | null>(null);
  const [paypal, setPaypal] = useState<{ orderId: string; url: string } | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [subsError, setSubsError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

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
      .catch((e: unknown) => !cancelled && setSubsError(e instanceof Error ? e.message : String(e)));
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
      setError(e instanceof Error ? e.message : String(e));
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
      setError(e instanceof Error ? e.message : String(e));
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
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const sortedSubs = [...(submissions ?? [])].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const latest = sortedSubs[0];
  const earlier = sortedSubs.slice(1);
  const pendingApprovals = approvals.filter((a) => a.status === "pending");

  return (
    <article className="card overflow-hidden">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
            {m.seq}
          </span>
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900">{m.title}</h3>
            {m.description && <p className="mt-1 text-sm text-slate-600">{m.description}</p>}
          </div>
        </div>
        <div className="flex shrink-0 flex-row items-center justify-between gap-3 sm:flex-col sm:items-end">
          <p className="text-lg font-semibold tabular-nums text-slate-900">{formatMoney(m.amount, currency)}</p>
          <MilestoneStatusBadge status={m.status} />
        </div>
      </div>

      <div className="grid gap-4 border-t border-slate-100 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_200px] sm:px-5">
        <div>
          <p className="label">Acceptance criteria</p>
          {m.acceptance_criteria?.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700 marker:text-slate-400">
              {m.acceptance_criteria.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">None extracted.</p>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-1">
          <div>
            <dt className="label">Due date</dt>
            <dd className={isOverdue(m) ? "font-medium text-rose-700" : "text-slate-700"}>
              {formatDate(m.due_date)}
              {isOverdue(m) && " · overdue"}
            </dd>
          </div>
          <div>
            <dt className="label">Escrow order</dt>
            <dd className="break-all font-mono text-xs text-slate-600">
              {m.escrow_order_id ?? "—"}
              {m.escrow_order_id && isSimulatedOrder(m.escrow_order_id) && (
                <span className="ml-1 font-sans text-amber-700">(simulated)</span>
              )}
            </dd>
          </div>
        </dl>
      </div>

      {/* Actions */}
      <div className="space-y-4 border-t border-slate-100 bg-slate-50/60 px-4 py-4 sm:px-5">
        {m.status === "pending" && !awaitingOrder && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600">Client funds this milestone into sandbox escrow (authorized, not captured).</p>
            <button type="button" className="btn-primary shrink-0" disabled={busy !== null} onClick={() => void fund()}>
              {busy ? <Spinner /> : <IconWallet />}
              {busy === "capture" ? "Authorizing…" : busy === "fund" ? "Creating order…" : "Fund escrow"}
            </button>
          </div>
        )}

        {m.status === "pending" && awaitingOrder && (
          <div className="rounded-lg border border-accent-200 bg-accent-50 p-4">
            <p className="text-sm font-medium text-accent-800">Approve the payment in the PayPal sandbox window</p>
            <p className="mt-1 text-sm text-slate-600">
              Order <code className="font-mono text-xs">{awaitingOrder}</code>. Once you have approved it in PayPal,
              confirm below to authorize the escrow hold.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
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

        {SUBMITTABLE.includes(m.status) && !showForm && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600">
              {m.status === "funded"
                ? "Funds are held in escrow. The freelancer can now submit the deliverable."
                : "Submit a revised deliverable for a fresh review."}
            </p>
            <button type="button" className="btn-primary shrink-0" onClick={() => setShowForm(true)}>
              <IconUpload />
              {m.status === "funded" ? "Submit deliverable" : "Resubmit"}
            </button>
          </div>
        )}

        {showForm && (
          <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
            <div>
              <label htmlFor={`notes-${m.id}`} className="label">
                Delivery notes
              </label>
              <textarea
                id={`notes-${m.id}`}
                className="input min-h-[110px]"
                placeholder="Describe what was delivered and how it meets each acceptance criterion…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor={`file-${m.id}`} className="label">
                Attachment (optional)
              </label>
              <input
                id={`file-${m.id}`}
                ref={fileRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.txt,.md"
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
          <p className="text-sm text-emerald-700">Payment released to the freelancer after human approval.</p>
        )}

        {error && <ErrorBox message={error} />}
      </div>

      {/* Verdict & approvals */}
      {(latest || pendingApprovals.length > 0 || subsError) && (
        <div className="space-y-4 border-t border-slate-100 px-4 py-4 sm:px-5">
          {subsError && <ErrorBox message={`Could not load submissions: ${subsError}`} />}
          {latest && (
            <div className="space-y-3">
              <div className="text-xs text-slate-500">
                Latest submission · {formatDateTime(latest.created_at)}
                {latest.file_name && (
                  <>
                    {" "}
                    · <span className="font-medium text-slate-700">{latest.file_name}</span>
                  </>
                )}
              </div>
              {latest.notes && (
                <p className="whitespace-pre-line rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
                  {latest.notes}
                </p>
              )}
              {latest.verdict ? (
                <VerdictCard verdict={latest.verdict} />
              ) : (
                <p className="text-sm text-slate-500">No verdict recorded for this submission yet.</p>
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
                className="text-xs font-medium text-accent-700 hover:text-accent-800"
                onClick={() => setShowHistory((s) => !s)}
              >
                {showHistory ? "Hide" : "Show"} {earlier.length} earlier submission{earlier.length > 1 ? "s" : ""}
              </button>
              {showHistory && (
                <ul className="mt-3 space-y-3">
                  {earlier.map((s) => (
                    <li key={s.id} className="space-y-2 border-l-2 border-slate-200 pl-3">
                      <p className="text-xs text-slate-500">
                        {formatDateTime(s.created_at)}
                        {s.file_name && ` · ${s.file_name}`}
                      </p>
                      {s.notes && <p className="text-sm text-slate-600">{s.notes}</p>}
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
