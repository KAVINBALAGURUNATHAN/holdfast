# HoldFast API Contract (v1)

Backend: FastAPI at `VITE_API_URL` (default `http://localhost:8000`). All JSON. All routes under `/api`.
IDs are UUID strings. Amounts are numbers in INR (`currency: "INR"`); PayPal sandbox charges in USD using a fixed demo rate in config.

## Entities

```ts
Contract   { id, title, status: "draft"|"active"|"completed", raw_text, parties: Party[], currency, total_amount, created_at, milestones: Milestone[] }
Party      { name, role: "client"|"freelancer", email? }
Milestone  { id, contract_id, seq, title, description, acceptance_criteria: string[], amount, due_date: string|null,
             status: "pending"|"funded"|"submitted"|"approved"|"rejected"|"released"|"held",
             escrow_order_id: string|null }
Submission { id, milestone_id, notes, file_name|null, extracted_text, created_at, verdict: Verdict|null }
Verdict    { id, submission_id, decision: "approve"|"reject"|"needs_review", confidence: number /*0..1*/,
             reasoning: string, criteria_results: { criterion, met: boolean, evidence: string }[], created_at }
Approval   { id, milestone_id, action: "release"|"hold"|"refund", requested_by_agent: string, reason,
             status: "pending"|"approved"|"denied", decided_by: string|null, decided_at|null, created_at }
AuditEvent { id, contract_id, milestone_id|null, actor: string /*"document_agent"|"referee_agent"|"payment_agent"|"human:<name>"*/,
             action: string, details: object, created_at }
```

## Routes

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/health` | – | `{ ok, gemini: bool, paypal: bool, supabase: bool, ocr: bool }` (which integrations are configured) |
| POST | `/api/contracts/upload` | multipart `file` (pdf/png/jpg/txt) + optional `title` | `Contract` (document agent ran: OCR → Gemini extraction) |
| GET | `/api/contracts` | – | `Contract[]` |
| GET | `/api/contracts/{id}` | – | `Contract` |
| POST | `/api/milestones/{id}/fund` | – | `{ milestone, order_id, approve_url }` creates PayPal sandbox order (intent AUTHORIZE) |
| POST | `/api/milestones/{id}/capture-funding` | `{ order_id }` | `Milestone` (authorizes order after buyer approval; status → funded) |
| POST | `/api/milestones/{id}/submit` | multipart `notes` + optional `file` | `Submission` with `verdict` (referee agent ran) |
| GET | `/api/milestones/{id}/submissions` | – | `Submission[]` |
| GET | `/api/approvals?status=pending` | – | `Approval[]` (payment agent proposals awaiting human) |
| POST | `/api/approvals/{id}/decide` | `{ decision: "approved"|"denied", decided_by: string }` | `Approval` (if approved, payment agent executes capture/void) |
| GET | `/api/contracts/{id}/audit` | – | `AuditEvent[]` newest first |
| POST | `/api/demo/seed` | – | `Contract` (sample contract, no upload needed) |

## Agent flow

1. Document agent: OCR (Tesseract via pytesseract; pdfplumber text first for digital PDFs) → Gemini structured JSON → Contract + Milestones. Logs `contract.extracted`.
2. Client funds a milestone → PayPal sandbox order with intent AUTHORIZE (escrow = authorized, not captured). Logs `escrow.funded`.
3. Freelancer submits → referee agent compares deliverable text vs acceptance_criteria via Gemini → Verdict. Logs `verdict.issued`.
4. Payment agent proposes `release` (approve) or `hold` (reject / needs_review) → creates Approval (pending). Logs `approval.requested`. **Never moves money itself.**
5. Human decides → if approved+release: capture authorization; hold: keep authorized, status held; refund: void. Logs `approval.decided` + `escrow.released|held|voided`.

## Fallbacks (demo must run with zero keys)
- No `GEMINI_API_KEY` → deterministic heuristic extractor/referee, marked `"engine": "heuristic"` in audit details.
- No PayPal creds → simulated escrow with fake `SIM-` order ids, marked `simulated: true`.
- No Supabase creds → in-memory/SQLite store with the same repository interface.
- No Tesseract binary → skip OCR for images with a clear error; PDFs/txt still work.
