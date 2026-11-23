import { useState } from "react";
import { formatDateTime, type AuditEvent, type Milestone } from "../api";
import { IconChevron, IconDocument, IconScale, IconUser, IconWallet, IconCog } from "./ui";

function actorMeta(actor: string) {
  if (actor === "document_agent")
    return { label: "Document agent", icon: IconDocument, cls: "bg-indigo-100 text-indigo-700 ring-indigo-200" };
  if (actor === "referee_agent")
    return { label: "Referee agent", icon: IconScale, cls: "bg-violet-100 text-violet-700 ring-violet-200" };
  if (actor === "payment_agent")
    return { label: "Payment agent", icon: IconWallet, cls: "bg-sky-100 text-sky-700 ring-sky-200" };
  if (actor.startsWith("human:"))
    return { label: actor.slice(6) || "Human", icon: IconUser, cls: "bg-emerald-100 text-emerald-700 ring-emerald-200", human: true };
  return { label: actor, icon: IconCog, cls: "bg-slate-100 text-slate-600 ring-slate-200" };
}

function flags(details: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (details && details.engine === "heuristic") out.push("heuristic engine");
  if (details && details.simulated === true) out.push("simulated escrow");
  return out;
}

function EventItem({ ev, milestoneTitle, last }: { ev: AuditEvent; milestoneTitle?: string; last: boolean }) {
  const [open, setOpen] = useState(false);
  const meta = actorMeta(ev.actor);
  const Icon = meta.icon;
  const hasDetails = ev.details && typeof ev.details === "object" && Object.keys(ev.details).length > 0;
  const tags = flags(ev.details ?? {});

  return (
    <li className="relative flex gap-3 pb-6">
      {!last && <span className="absolute left-4 top-9 -ml-px h-[calc(100%-2.25rem)] w-0.5 bg-slate-200" aria-hidden="true" />}
      <span className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${meta.cls}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-sm text-slate-900">
            <span className="font-medium">{meta.label}</span>
            {"human" in meta && meta.human && <span className="ml-1 text-xs text-emerald-700">(human)</span>}{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">{ev.action}</code>
          </p>
          <time className="text-xs tabular-nums text-slate-500" dateTime={ev.created_at}>
            {formatDateTime(ev.created_at)}
          </time>
        </div>
        {(milestoneTitle || tags.length > 0) && (
          <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-slate-500">
            {milestoneTitle && <span>Milestone: {milestoneTitle}</span>}
            {tags.map((t) => (
              <span key={t} className="rounded bg-amber-50 px-1.5 text-amber-800 ring-1 ring-inset ring-amber-200">
                {t}
              </span>
            ))}
          </div>
        )}
        {hasDetails && (
          <div className="mt-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-medium text-accent-700 hover:text-accent-800"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              <IconChevron className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
              {open ? "Hide details" : "Show details"}
            </button>
            {open && (
              <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-100">
                {JSON.stringify(ev.details, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export default function AuditTrail({ events, milestones }: { events: AuditEvent[]; milestones: Milestone[] }) {
  const titles = new Map(milestones.map((m) => [m.id, `#${m.seq} ${m.title}`]));
  return (
    <ol className="pt-1">
      {events.map((ev, i) => (
        <EventItem
          key={ev.id}
          ev={ev}
          milestoneTitle={ev.milestone_id ? titles.get(ev.milestone_id) : undefined}
          last={i === events.length - 1}
        />
      ))}
    </ol>
  );
}
