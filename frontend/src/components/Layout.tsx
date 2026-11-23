import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { api, API_BASE, APPROVALS_CHANGED, type Health } from "../api";
import { IconShield } from "./ui";

const INTEGRATIONS: { key: keyof Omit<Health, "ok">; label: string }[] = [
  { key: "gemini", label: "Gemini" },
  { key: "paypal", label: "PayPal" },
  { key: "supabase", label: "Supabase" },
  { key: "ocr", label: "OCR" },
];

function HealthChips() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .health()
        .then((h) => {
          if (!cancelled) {
            setHealth(h);
            setError(false);
          }
        })
        .catch(() => {
          if (!cancelled) setError(true);
        });
    void load();
    const t = window.setInterval(load, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  if (error) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200"
        title={`Cannot reach ${API_BASE}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
        API offline
      </span>
    );
  }

  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label="Integration status">
      {INTEGRATIONS.map(({ key, label }) => {
        const live = health ? health[key] : null;
        const cls =
          live === null
            ? "bg-slate-100 text-slate-500 ring-slate-200"
            : live
              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
              : "bg-amber-50 text-amber-800 ring-amber-200";
        const dot = live === null ? "bg-slate-300" : live ? "bg-emerald-500" : "bg-amber-500";
        return (
          <li
            key={key}
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}
            title={live === null ? "Checking…" : live ? `${label} is configured (live)` : `${label} not configured — using fallback`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
            {label}
            <span className="font-normal opacity-75">{live === null ? "…" : live ? "live" : "fallback"}</span>
          </li>
        );
      })}
    </ul>
  );
}

function PendingCount() {
  const location = useLocation();
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .listApprovals("pending")
        .then((a) => !cancelled && setCount(a.length))
        .catch(() => !cancelled && setCount(null));
    };
    load();
    window.addEventListener(APPROVALS_CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(APPROVALS_CHANGED, load);
    };
  }, [location.pathname, location.key]);
  if (!count) return null;
  return (
    <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-600 px-1.5 text-[11px] font-semibold text-white">
      {count}
    </span>
  );
}

const navCls = ({ isActive }: { isActive: boolean }) =>
  `inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
  }`;

export default function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center justify-between gap-4">
            <Link to="/" className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-700 text-white">
                <IconShield className="h-5 w-5" />
              </span>
              <span className="text-lg font-semibold tracking-tight text-slate-900">HoldFast</span>
            </Link>
            <nav className="flex items-center gap-1">
              <NavLink to="/" end className={navCls}>
                Contracts
              </NavLink>
              <NavLink to="/approvals" className={navCls}>
                Approvals
                <PendingCount />
              </NavLink>
            </nav>
          </div>
          <HealthChips />
        </div>
        <div className="border-t border-slate-100 bg-slate-50">
          <p className="mx-auto max-w-6xl px-4 py-1.5 text-xs text-slate-500 sm:px-6">
            <span className="font-medium text-slate-700">Sandbox payments only</span> · verdicts are advisory and every
            money movement requires human approval.
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-4 text-xs text-slate-500 sm:px-6">
          HoldFast · auditable escrow for Indian freelancers &amp; MSMEs · API: <code className="break-all">{API_BASE}</code>
        </div>
      </footer>
    </div>
  );
}
