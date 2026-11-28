# HoldFast

**Agentic contract-to-escrow workflow for Indian freelancers and small businesses.**

Indian freelancers and MSMEs lose time and money on disputes over unpaid invoices, vague contracts and missed milestones, and most can't afford legal help. HoldFast turns a contract into an auditable workflow. AI agents extract the obligations, check delivered work against them and propose payment actions. A human approves anything irreversible, and every step is logged.

> **Prototype limits:** PayPal **sandbox** payments only. AI verdicts are **advisory** until validated on real cases.

---

## How it works

```
 Contract (PDF / image / text)
        │
        ▼
 ┌────────────────┐   OCR (Tesseract) + Gemini
 │ Document agent │──► parties, milestones, amounts (₹), deadlines, acceptance criteria
 └────────────────┘
        │  client funds a milestone
        ▼
 PayPal Sandbox order (intent = AUTHORIZE)  ← funds held, not captured = escrow
        │  freelancer submits deliverable
        ▼
 ┌────────────────┐   Gemini, criterion-by-criterion
 │ Referee agent  │──► verdict: approve / reject / needs_review + confidence + quoted evidence
 └────────────────┘
        │
        ▼
 ┌────────────────┐
 │ Payment agent  │──► PROPOSES release / hold / refund (never moves money itself)
 └────────────────┘
        │
        ▼
 Human approval gate ──► capture (release) · keep authorized (hold) · void (refund)
        │
        ▼
 Audit trail: every agent and human action, with engine, inputs and outcome
```

## Demo flow

1. **Upload a contract** or click **Load sample contract**.
2. Review the **extracted milestones**: amount, due date and acceptance criteria.
3. **Fund** a milestone through PayPal Sandbox escrow.
4. **Submit a deliverable** (notes and an optional file).
5. Read the **AI verdict**: per-criterion met or not met, with evidence.
6. **Approve or deny** the payment agent's proposal in the Approvals inbox.
7. Check the **audit trail**.

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, deployed on **Vercel** |
| Backend | Python 3.10, **FastAPI**, deployed on **Render** (Docker) |
| AI | **Gemini API** (free tier), structured JSON output |
| OCR | **Tesseract OCR** (pytesseract) + pdfplumber for digital PDFs |
| Payments | **PayPal Sandbox** REST API (Orders v2, authorize / capture / void) |
| Database | **Supabase** (PostgreSQL) |

## Repository layout

```
backend/     FastAPI app: agents, services (OCR, Gemini, PayPal), store, tests
frontend/    React + Vite app
supabase/    schema.sql: run in the Supabase SQL editor
docs/        API contract
render.yaml  Render blueprint for the backend
```

## Run locally

The app **runs with zero API keys**. Each integration falls back automatically: heuristic extraction and refereeing, simulated escrow and an in-memory store. Add keys to switch each one to the live service. The header shows which integrations are live.

### Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate   macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # fill in keys (optional)
uvicorn app.main:app --reload --port 8000
```

API docs: http://localhost:8000/docs. Tests: `pytest`.

To OCR scanned images, install Tesseract (`apt install tesseract-ocr`, `brew install tesseract`, or the Windows installer from UB-Mannheim) and set `TESSERACT_CMD` if it isn't on your PATH. Text-based PDFs and .txt files work without it.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env        # VITE_API_URL=http://localhost:8000
npm run dev
```

### Supabase

Create a project, run `supabase/schema.sql` in the SQL editor, then set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in `backend/.env`.

### PayPal Sandbox

Create a sandbox app at developer.paypal.com and set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`. Approve the payment with a sandbox **personal** test account. Amounts are stored in INR and charged in USD at the demo rate set by `INR_PER_USD`.

## Deploy

- **Backend → Render:** New → Blueprint → select this repo (`render.yaml`). Set the env vars in the dashboard.
- **Frontend → Vercel:** import the repo, set **Root Directory** to `frontend`, and set `VITE_API_URL` to the Render URL. Add the Vercel URL to `CORS_ORIGINS` on Render.

## Safety design

- Agents **propose** and humans **approve**. The payment agent can't capture or void funds without an approved `Approval` record.
- Every decision is written to `audit_events`, along with the engine that produced it (Gemini or heuristic, live or simulated).
- Verdicts include quoted evidence per criterion. When the evidence is insufficient, the verdict is `needs_review` instead of a guess.

## Evaluation

There is an offline, reproducible evaluation in [`backend/eval/`](backend/eval/). Full method, confusion matrices and limitations are in [`backend/eval/RESULTS.md`](backend/eval/RESULTS.md). **All data is synthetic and labelled by the author, the sample is small, and the numbers come from a single run**, using `gemini-3.5-flash-lite`.

| | Gemini | Heuristic fallback |
|---|---|---|
| Contracts fully correct (parties, milestone count, every amount, due date and criteria count); N=24 | 23/24 (95.8%) | 10/24 (41.7%) |
| Milestone amounts exact; N=62 | 62/62 | 56/62 |
| Referee criterion accuracy; N=41 | 37/41 (90.2%) | 32/41 (78.0%) |
| Unproven or unmet criteria wrongly marked met; N=17 | 1/17 | 3/17 |
| Unsafe approvals (approve when gold isn't approve); N=12 | 1/12 | 2/12 |
| Referee decision accuracy; N=17 | 11/17 (64.7%) | 5/17 (29.4%) |

- **Gemini latency:** median 1.8 s per call, p95 2.9 s (N=41).
- **Rate limits:** without client-side pacing, 10 of 41 calls hit HTTP 429 and fell back to the heuristic.
- **Referee decision misses (6 of 17):** 3 sent fully evidenced work to human review, 2 rejected where review was expected, and 1 approved a milestone whose "no vulnerabilities" criterion was only claimed, never shown.

Reproduce from `backend/`: `.venv\Scripts\python -m eval.run_eval --pace-s 8`

## Impact

HoldFast aims to cut milestone dispute resolution from weeks to minutes for MSMEs and freelancers, with a transparent record both sides can trust.

## License

MIT
