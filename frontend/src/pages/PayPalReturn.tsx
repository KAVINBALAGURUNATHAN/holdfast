import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError, isGoneError, notifyApprovalsChanged, type Contract, type Milestone } from "../api";
import { ErrorBox, IconArrowLeft, IconLock, IconWallet, Money, Spinner } from "../components/ui";

/**
 * One capture request per (milestone, order), shared across effect re-runs. React StrictMode runs
 * effects twice in development; both runs await the same promise instead of posting twice.
 */
const inflight = new Map<string, Promise<Milestone>>();

function captureOnce(milestoneId: string, orderId: string): Promise<Milestone> {
  const key = `${milestoneId}:${orderId}`;
  let p = inflight.get(key);
  if (!p) {
    p = api.captureFunding(milestoneId, orderId);
    inflight.set(key, p);
    p.catch(() => inflight.delete(key)); // allow a retry after a failure
  }
  return p;
}

/** Find the contract holding a milestone: by id when we have it, otherwise by scanning the list. */
async function findContract(milestoneId: string, contractId: string | null): Promise<Contract | null> {
  if (contractId) {
    try {
      return await api.getContract(contractId);
    } catch {
      /* fall through to the list */
    }
  }
  const all = await api.listContracts();
  return all.find((c) => c.milestones.some((m) => m.id === milestoneId)) ?? null;
}

type State =
  | { kind: "working" }
  | { kind: "funded"; milestone: Milestone; contract: Contract | null }
  | { kind: "error"; message: string; retryable: boolean };

export function PaymentShell({ icon, eyebrow, title, children }: { icon: ReactNode; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-lg py-10 sm:py-16">
      <div className="card px-5 py-7 sm:px-8 sm:py-9">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-50 text-accent-700">{icon}</div>
        <p className="eyebrow mt-5">{eyebrow}</p>
        <h1 className="display mt-2 text-2xl leading-snug sm:text-3xl">{title}</h1>
        <div className="mt-3 text-sm leading-relaxed text-ink-600">{children}</div>
      </div>
    </div>
  );
}

export default function PayPalReturn() {
  const [params] = useSearchParams();
  const orderId = params.get("token");
  const milestoneId = params.get("milestone_id");
  const contractId = params.get("contract_id");
  const [state, setState] = useState<State>({ kind: "working" });
  const [attempt, setAttempt] = useState(0);

  const run = useCallback(async (): Promise<State> => {
    if (!orderId || !milestoneId) {
      return {
        kind: "error",
        retryable: false,
        message: "This link is missing the PayPal order or milestone. Open the contract and fund the milestone again.",
      };
    }
    try {
      const milestone = await captureOnce(milestoneId, orderId);
      const contract = await findContract(milestone.id, contractId ?? milestone.contract_id).catch(() => null);
      return { kind: "funded", milestone, contract };
    } catch (e) {
      if (isGoneError(e)) {
        return {
          kind: "error",
          retryable: false,
          message: "This milestone is no longer on the server (it may have restarted). Nothing was captured.",
        };
      }
      // The escrow may already be funded (e.g. confirmed from the contract page, or a newer order).
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        const contract = await findContract(milestoneId, contractId).catch(() => null);
        const m = contract?.milestones.find((x) => x.id === milestoneId);
        if (m && m.status !== "pending") return { kind: "funded", milestone: m, contract };
      }
      // 4xx means this order can't be used (retrying won't help); 5xx / network errors may be transient.
      const clientError = e instanceof ApiError && e.status >= 400 && e.status < 500;
      return { kind: "error", retryable: !clientError, message: e instanceof Error ? e.message : String(e) };
    }
  }, [orderId, milestoneId, contractId]);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "working" });
    void run().then((s) => {
      if (cancelled) return;
      setState(s);
      if (s.kind === "funded") notifyApprovalsChanged();
    });
    return () => {
      cancelled = true;
    };
  }, [run, attempt]);

  const backTo = (state.kind === "funded" && state.contract?.id) || contractId;
  const backLink = backTo ? (
    <Link to={`/contracts/${encodeURIComponent(backTo)}`} className="btn-primary">
      <IconArrowLeft />
      Back to the contract
    </Link>
  ) : (
    <Link to="/" className="btn-secondary">
      <IconArrowLeft />
      Back to contracts
    </Link>
  );

  if (state.kind === "working") {
    return (
      <PaymentShell icon={<IconWallet className="h-5 w-5" />} eyebrow="PayPal sandbox" title="Securing your escrow…">
        <p className="flex items-center gap-2" role="status">
          <Spinner className="h-4 w-4 text-accent-600" />
          Authorizing the approved payment. Please keep this page open.
        </p>
      </PaymentShell>
    );
  }

  if (state.kind === "error") {
    return (
      <PaymentShell icon={<IconWallet className="h-5 w-5" />} eyebrow="PayPal sandbox" title="We couldn't fund the escrow">
        <p>Your payment was not captured. You can try again, or go back and start a new order.</p>
        <div className="mt-5">
          <ErrorBox message={state.message} onRetry={state.retryable ? () => setAttempt((n) => n + 1) : undefined} />
        </div>
        <div className="mt-6 flex flex-wrap gap-2">{backLink}</div>
      </PaymentShell>
    );
  }

  const { milestone, contract } = state;
  return (
    <PaymentShell icon={<IconLock className="h-5 w-5" />} eyebrow="Escrow funded" title="Funds are authorized and held">
      <p>
        PayPal authorized the payment, but nothing has been captured yet. The money is released to the freelancer only
        after the deliverable is reviewed and a person approves the release.
      </p>
      <dl className="mt-5 divide-y divide-ink-100 rounded-xl border border-ink-200/70 bg-paper-2/40 text-sm">
        {contract && (
          <div className="flex items-baseline justify-between gap-4 px-4 py-3">
            <dt className="text-ink-500">Contract</dt>
            <dd className="min-w-0 break-words text-right font-medium text-ink-900">{contract.title}</dd>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-4 px-4 py-3">
          <dt className="text-ink-500">Milestone</dt>
          <dd className="min-w-0 break-words text-right font-medium text-ink-900">
            {milestone.seq}. {milestone.title}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 px-4 py-3">
          <dt className="text-ink-500">Amount held</dt>
          <dd>
            <Money amount={milestone.amount} currency={contract?.currency ?? "INR"} className="text-lg text-ink-900" />
          </dd>
        </div>
        <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
          <dt className="shrink-0 text-ink-500">PayPal order</dt>
          <dd className="min-w-0 break-all font-mono text-xs text-ink-700 sm:text-right">{milestone.escrow_order_id ?? orderId}</dd>
        </div>
      </dl>
      <div className="mt-6 flex flex-wrap gap-2">{backLink}</div>
    </PaymentShell>
  );
}
