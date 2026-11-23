// Typed client for the HoldFast API — mirrors docs/API_CONTRACT.md (v1).

export const API_BASE: string = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/+$/, "");

// ---------- Entities ----------

export type ContractStatus = "draft" | "active" | "completed";
export type PartyRole = "client" | "freelancer";
export type MilestoneStatus =
  | "pending"
  | "funded"
  | "submitted"
  | "approved"
  | "rejected"
  | "released"
  | "held";
export type VerdictDecision = "approve" | "reject" | "needs_review";
export type ApprovalAction = "release" | "hold" | "refund";
export type ApprovalStatus = "pending" | "approved" | "denied";

export interface Party {
  name: string;
  role: PartyRole;
  email?: string | null;
}

export interface Milestone {
  id: string;
  contract_id: string;
  seq: number;
  title: string;
  description: string;
  acceptance_criteria: string[];
  amount: number;
  due_date: string | null;
  status: MilestoneStatus;
  escrow_order_id: string | null;
}

export interface Contract {
  id: string;
  title: string;
  status: ContractStatus;
  raw_text: string;
  parties: Party[];
  currency: string;
  total_amount: number;
  created_at: string;
  milestones: Milestone[];
}

export interface CriterionResult {
  criterion: string;
  met: boolean;
  evidence: string;
}

export interface Verdict {
  id: string;
  submission_id: string;
  decision: VerdictDecision;
  confidence: number; // 0..1
  reasoning: string;
  criteria_results: CriterionResult[];
  created_at: string;
}

export interface Submission {
  id: string;
  milestone_id: string;
  notes: string;
  file_name: string | null;
  extracted_text: string;
  created_at: string;
  verdict: Verdict | null;
}

export interface Approval {
  id: string;
  milestone_id: string;
  action: ApprovalAction;
  requested_by_agent: string;
  reason: string;
  status: ApprovalStatus;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface AuditEvent {
  id: string;
  contract_id: string;
  milestone_id: string | null;
  /** "document_agent" | "referee_agent" | "payment_agent" | "human:<name>" */
  actor: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface Health {
  ok: boolean;
  gemini: boolean;
  paypal: boolean;
  supabase: boolean;
  ocr: boolean;
}

export interface FundResponse {
  milestone: Milestone;
  order_id: string;
  approve_url: string;
}

// ---------- Transport ----------

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      // FastAPI validation errors
      return detail
        .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : String(d)))
        .join("; ");
    }
  }
  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError(0, `Cannot reach the HoldFast API at ${API_BASE}. Is the backend running?`);
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, errorMessage(body, `Request failed (${res.status} ${res.statusText})`));
  }
  return body as T;
}

function json(method: string, data?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  };
}

// ---------- Endpoints ----------

export const api = {
  health: () => request<Health>("/api/health"),

  listContracts: () => request<Contract[]>("/api/contracts"),
  getContract: (id: string) => request<Contract>(`/api/contracts/${encodeURIComponent(id)}`),
  uploadContract: (file: File, title?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    if (title && title.trim()) fd.append("title", title.trim());
    return request<Contract>("/api/contracts/upload", { method: "POST", body: fd });
  },
  seedDemo: () => request<Contract>("/api/demo/seed", { method: "POST" }),
  getAudit: (contractId: string) => request<AuditEvent[]>(`/api/contracts/${encodeURIComponent(contractId)}/audit`),

  fundMilestone: (id: string) => request<FundResponse>(`/api/milestones/${encodeURIComponent(id)}/fund`, { method: "POST" }),
  captureFunding: (id: string, orderId: string) =>
    request<Milestone>(`/api/milestones/${encodeURIComponent(id)}/capture-funding`, json("POST", { order_id: orderId })),
  submitDeliverable: (id: string, notes: string, file?: File | null) => {
    const fd = new FormData();
    fd.append("notes", notes);
    if (file) fd.append("file", file);
    return request<Submission>(`/api/milestones/${encodeURIComponent(id)}/submit`, { method: "POST", body: fd });
  },
  listSubmissions: (id: string) => request<Submission[]>(`/api/milestones/${encodeURIComponent(id)}/submissions`),

  listApprovals: (status?: ApprovalStatus) =>
    request<Approval[]>(`/api/approvals${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  decideApproval: (id: string, decision: "approved" | "denied", decidedBy: string) =>
    request<Approval>(`/api/approvals/${encodeURIComponent(id)}/decide`, json("POST", { decision, decided_by: decidedBy })),
};

/** Window event fired after anything that may change the pending-approvals count. */
export const APPROVALS_CHANGED = "holdfast:approvals-changed";
export function notifyApprovalsChanged(): void {
  window.dispatchEvent(new Event(APPROVALS_CHANGED));
}

// ---------- Formatting helpers ----------

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

export function formatMoney(amount: number, currency = "INR"): string {
  if (currency === "INR") return inrFormatter.format(amount);
  return new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(amount);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function isSimulatedOrder(orderId: string | null | undefined, approveUrl?: string): boolean {
  if (orderId && orderId.startsWith("SIM-")) return true;
  return !!approveUrl && !/^https?:\/\//i.test(approveUrl);
}
