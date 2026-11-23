import type { Verdict } from "../api";
import { formatDateTime } from "../api";
import { ConfidenceBar, DecisionBadge, IconCheck, IconScale, IconX } from "./ui";

export default function VerdictCard({ verdict }: { verdict: Verdict }) {
  const results = verdict.criteria_results ?? [];
  const metCount = results.filter((r) => r.met).length;
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-100 text-violet-700">
            <IconScale className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-slate-900">Referee agent verdict</span>
          <DecisionBadge decision={verdict.decision} />
        </div>
        <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-amber-800">
          Advisory — requires human approval
        </span>
      </div>

      <div className="mt-4">
        <p className="label">Confidence</p>
        <ConfidenceBar value={verdict.confidence} />
      </div>

      {verdict.reasoning && (
        <div className="mt-4">
          <p className="label">Reasoning</p>
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{verdict.reasoning}</p>
        </div>
      )}

      {results.length > 0 && (
        <div className="mt-4">
          <p className="label">
            Acceptance criteria · {metCount}/{results.length} met
          </p>
          <ul className="space-y-2">
            {results.map((r, i) => (
              <li key={i} className="flex gap-3 rounded-md border border-slate-200 bg-white p-3">
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                    r.met ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                  }`}
                  aria-label={r.met ? "Met" : "Not met"}
                >
                  {r.met ? <IconCheck className="h-3.5 w-3.5" /> : <IconX className="h-3.5 w-3.5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">{r.criterion}</p>
                  {r.evidence ? (
                    <blockquote className="mt-1 border-l-2 border-slate-300 pl-2 text-sm italic text-slate-600 break-words">
                      “{r.evidence}”
                    </blockquote>
                  ) : (
                    <p className="mt-1 text-xs text-slate-400">No evidence found in deliverable.</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 text-xs text-slate-400">Issued {formatDateTime(verdict.created_at)}</p>
    </div>
  );
}
