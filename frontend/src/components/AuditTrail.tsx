import { useState } from "react";
import { formatDateTime, type AuditEvent, type Milestone } from "../api";
import { IconChevron, IconDocument, IconScale, IconUser, IconWallet, IconCog } from "./ui";

type Kind = "agent" | "human" | "system";

function actorMeta(actor: string): { label: string; icon: typeof IconCog; cls: string; kind: Kind } {
  if (actor === "document_agent")
    return { label: "Document agent", icon: IconDocument, cls: "bg-accent-50 text-accent-700 ring-accent-200", kind: "agent" };
  if (actor === "referee_agent")
    return { label: "Referee agent", icon: IconScale, cls: "bg-accent-50 text-accent-700 ring-accent-200", kind: "agent" };
  if (actor === "payment_agent")
    return { label: "Payment agent", icon: IconWallet, cls: "bg-gold-50 text-gold-700 ring-gold-100", kind: "agent" };
  if (actor.startsWith("human:"))
    return { label: actor.slice(6) || "Human", icon: IconUser, cls: "bg-accent-700 text-white ring-accent-700", kind: "human" };
  return { label: actor, icon: IconCog, cls: "bg-ink-100 text-ink-600 ring-ink-200", kind: "system" };
}

const kindLabel: Record<Kind, string> = { agent: "AI agent", human: "Human", system: "System" };

function humanizeAction(action: string): string {
  const s = action.replace(/[_.:-]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : action;
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
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {!last && (
        <span className="absolute bottom-0 left-[13px] top-7 w-px bg-ink-200" aria-hidden="true" />
      )}
      <span
        className={`relative z-10 mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${meta.cls}`}
        title={kindLabel[meta.kind]}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
          <p className="min-w-0 break-words text-sm font-medium text-ink-900">{humanizeAction(ev.action)}</p>
          <time className="shrink-0 font-mono text-[11px] tabular-nums text-ink-500" dateTime={ev.created_at}>
            {formatDateTime(ev.created_at)}
          </time>
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-500">
          <span className="font-medium text-ink-700">{meta.label}</span>
          <span className="sr-only">({kindLabel[meta.kind]})</span>
          {meta.kind === "human" && (
            <span className="rounded-full bg-accent-50 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-accent-700">
              Human
            </span>
          )}
          <span aria-hidden="true">·</span>
          <code className="break-all font-mono text-[11px] text-ink-500">{ev.action}</code>
        </p>
        {(milestoneTitle || tags.length > 0) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
            {milestoneTitle && <span className="min-w-0 break-words">Milestone {milestoneTitle}</span>}
            {tags.map((t) => (
              <span key={t} className="rounded-full bg-gold-50 px-2 py-px text-[11px] text-gold-700 ring-1 ring-inset ring-gold-100">
                {t}
              </span>
            ))}
          </div>
        )}
        {hasDetails && (
          <div className="mt-1.5">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded text-xs font-medium text-accent-700 hover:text-accent-800"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              <IconChevron className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
              {open ? "Hide details" : "Show details"}
            </button>
            {open && (
              <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-ink-200/70 bg-paper-2/60 p-3 font-mono text-[11px] leading-relaxed text-ink-700">
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
