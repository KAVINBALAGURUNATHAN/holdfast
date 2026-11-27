import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { api, API_BASE, APPROVALS_CHANGED } from "../api";
import { IconLock, IconShield } from "./ui";

function ApiOfflineNotice() {
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .health()
        .then(() => {
          if (!cancelled) setError(false);
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

  // The header only speaks up when the API is down.
  return null;
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
    <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gold-500 px-1.5 text-[11px] font-semibold text-white">
      {count}
    </span>
  );
}

const navCls = ({ isActive }: { isActive: boolean }) =>
  `relative inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
    isActive ? "bg-ink-900 text-paper" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900"
  }`;

export default function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-ink-200/70 bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center justify-between gap-6">
            <Link to="/" className="group flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-800 text-paper shadow-sm transition-transform group-hover:-rotate-3">
                <IconShield className="h-5 w-5" />
              </span>
              <span className="leading-none">
                <span className="display block text-xl">HoldFast</span>
                <span
                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-ink-500"
                  title="Sandbox payments only. AI verdicts are advisory — every money movement needs a human approval."
                >
                  <IconLock className="h-3 w-3" />
                  Sandbox mode
                </span>
              </span>
            </Link>
            <nav className="flex items-center gap-1" aria-label="Main">
              <NavLink to="/" end className={navCls}>
                Contracts
              </NavLink>
              <NavLink to="/approvals" className={navCls}>
                Approvals
                <PendingCount />
              </NavLink>
            </nav>
          </div>
          <ApiOfflineNotice />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="animate-fade-up">
          <Outlet />
        </div>
      </main>

      <footer className="border-t border-ink-200/70">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-6 text-xs text-ink-500 sm:flex-row sm:justify-between sm:px-6">
          <span>
            <span className="display text-sm text-ink-700">HoldFast</span> · auditable escrow for Indian freelancers &amp;
            MSMEs
          </span>
          <span>
            API <code className="break-all font-mono text-ink-600">{API_BASE}</code>
          </span>
        </div>
      </footer>
    </div>
  );
}
