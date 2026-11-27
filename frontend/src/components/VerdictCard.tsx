import type { Verdict } from "../api";
import { formatDateTime } from "../api";
import { ConfidenceBar, DecisionBadge, IconCheck, IconScale, IconShield, IconX } from "./ui";

export default function VerdictCard({ verdict }: { verdict: Verdict }) {
  const results = verdict.criteria_results ?? [];
  const metCount = results.filter((r) => r.met).length;
  return (
    <section className="overflow-hidden rounded-2xl border border-ink-200/70 bg-white" aria-label="Referee agent verdict">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-ink-100 bg-paper-2/40 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-100">
            <IconScale className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <p className="eyebrow">Referee agent verdict</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <DecisionBadge decision={verdict.decision} large />
            </div>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-gold-50 px-2.5 py-1 text-[11px] font-medium text-gold-700 ring-1 ring-inset ring-gold-100">
          <IconShield className="h-3.5 w-3.5" />
          Advisory · a human approves payment
        </span>
      </div>

      <div className="space-y-5 px-4 py-4 sm:px-5 sm:py-5">
        <div>
          <p className="label">Confidence</p>
          <ConfidenceBar value={verdict.confidence} />
        </div>

        {verdict.reasoning && (
          <div>
            <p className="label">Reasoning</p>
            <p className="whitespace-pre-line break-words text-sm leading-relaxed text-ink-700">{verdict.reasoning}</p>
          </div>
        )}

        {results.length > 0 && (
          <div>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <p className="label mb-0">Acceptance criteria</p>
              <p className="text-xs text-ink-500">
                <span className="money text-sm text-ink-800">
                  {metCount}/{results.length}
                </span>{" "}
                met
              </p>
            </div>
            <ul className="divide-y divide-ink-100 rounded-xl border border-ink-200/70">
              {results.map((r, i) => (
                <li key={i} className="flex gap-3 px-3 py-3 sm:px-4">
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                      r.met ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200" : "bg-rose-50 text-rose-600 ring-1 ring-inset ring-rose-200"
                    }`}
                    role="img"
                    aria-label={r.met ? "Met" : "Not met"}
                  >
                    {r.met ? <IconCheck className="h-3 w-3" /> : <IconX className="h-3 w-3" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium text-ink-900">{r.criterion}</p>
                    {r.evidence ? (
                      <blockquote className="mt-1.5 break-words border-l-2 border-ink-300 pl-3 text-sm italic leading-relaxed text-ink-600">
                        {quoteEvidence(r.evidence)}
                      </blockquote>
                    ) : (
                      <p className="mt-1 text-xs text-ink-400">No evidence found in deliverable.</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs text-ink-400">Issued {formatDateTime(verdict.created_at)}</p>
      </div>
    </section>
  );
}

/** Wrap evidence in quotes unless the agent already quoted it (the heuristic engine does). */
function quoteEvidence(evidence: string): string {
  const t = evidence.trim();
  return /^["“'‘]/.test(t) ? t : `“${t}”`;
}
