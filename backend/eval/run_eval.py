"""Reproducible offline evaluation of HoldFast's Document Agent and Referee Agent.

SYNTHETIC, AUTHOR-LABELED DATA: see eval/ground_truth.json and eval/referee_cases.json.

Run from backend/:
    .venv\\Scripts\\python -m eval.run_eval                       # both engines
    .venv\\Scripts\\python -m eval.run_eval --engines heuristic   # no API calls
    .venv\\Scripts\\python -m eval.run_eval --tag after_fix --out eval/results_after_fix.json

What it does
- Calls the production agent entry points (app.agents.document_agent.run / referee_agent.run) in-process,
  with an in-memory store. Supabase and PayPal are forced OFF (env vars blanked, .env file not loaded by
  Settings), so nothing is written to any database and no deployed service is touched.
- "gemini" engine: GEMINI_API_KEY / GEMINI_MODEL / GEMINI_TIMEOUT_MS are read from backend/.env (the key is
  never printed or written). If a Gemini call fails, the agent's own fallback runs and the item is
  counted as a fallback; it is still scored as the system output.
- "heuristic" engine: same entry points with no Gemini key, i.e. the deterministic fallback.
- PDF contracts go through the production text extractor (app.services.ocr, pdfplumber).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
sys.path.insert(0, str(BACKEND))

# Force every external integration off BEFORE app modules read settings.
for _k in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"):
    os.environ[_k] = ""

from dotenv import dotenv_values  # noqa: E402

from app.agents import document_agent, referee_agent  # noqa: E402
from app.config import Settings  # noqa: E402
from app.deps import build_context  # noqa: E402
from app.models import Milestone, Submission  # noqa: E402
from app.store.memory_store import MemoryStore  # noqa: E402

GT_PATH = HERE / "ground_truth.json"
CASES_PATH = HERE / "referee_cases.json"
CONTRACTS_DIR = HERE / "contracts"


# --------------------------------------------------------------------------- #
# Context / instrumentation
# --------------------------------------------------------------------------- #

def make_ctx(engine: str):
    env = dotenv_values(BACKEND / ".env") if engine == "gemini" else {}
    key = (env.get("GEMINI_API_KEY") or "") if engine == "gemini" else ""
    if engine == "gemini" and not key.strip():
        raise SystemExit("GEMINI_API_KEY not found in backend/.env; cannot run the gemini engine.")
    settings = Settings(
        _env_file=None,
        gemini_api_key=key,
        gemini_model=env.get("GEMINI_MODEL") or "gemini-3.5-flash-lite",
        gemini_timeout_ms=int(env.get("GEMINI_TIMEOUT_MS") or 20_000),
        supabase_url="",
        supabase_service_key="",
        paypal_client_id="",
        paypal_client_secret="",
    )
    assert not settings.supabase_enabled and not settings.paypal_enabled
    ctx = build_context(settings, MemoryStore())
    assert isinstance(ctx.store, MemoryStore)
    calls: list[dict[str, Any]] = []
    original = ctx.gemini.generate_json

    def timed_generate_json(*args, **kwargs):
        t0 = time.perf_counter()
        try:
            out = original(*args, **kwargs)
            calls.append({"seconds": time.perf_counter() - t0, "ok": True})
            return out
        except Exception as exc:
            calls.append({"seconds": time.perf_counter() - t0, "ok": False, "error": str(exc)[:200]})
            raise

    ctx.gemini.generate_json = timed_generate_json  # type: ignore[method-assign]
    return ctx, calls


def _audit_details(ctx, contract_id: str, action: str) -> dict[str, Any]:
    events = [e for e in ctx.store.list_audit(contract_id) if e.action == action]
    return events[-1].details if events else {}


# --------------------------------------------------------------------------- #
# Normalisation / scoring helpers
# --------------------------------------------------------------------------- #

_HONORIFICS = {"mr", "mrs", "ms", "dr", "shri", "smt", "adv", "ca", "col", "retd", "prof"}


def norm_name(s: Optional[str]) -> str:
    s = (s or "").lower().replace("&", " and ")
    s = re.sub(r"[^\w\s]", "", s)  # punctuation removed (D'Souza -> dsouza, Pvt. -> pvt)
    s = re.sub(r"\bprivate limited\b", "pvt ltd", s)
    s = re.sub(r"\blimited\b", "ltd", s)
    toks = [t for t in s.split() if t not in _HONORIFICS]
    return " ".join(toks)


def party_match(pred: Optional[str], gt: dict[str, Any]) -> tuple[bool, bool]:
    """(strict, lenient). strict: equals an alias (or alias + representative) after normalisation.
    lenient: some normalised alias is contained in the normalised prediction."""
    p = norm_name(pred)
    if not p:
        return False, False
    aliases = [norm_name(a) for a in gt["aliases"]]
    rep = norm_name(gt.get("representative"))
    strict_set = set(aliases) | ({f"{a} {rep}" for a in aliases if rep and a != rep})
    strict = p in strict_set
    lenient = strict or any(a and re.search(rf"\b{re.escape(a)}\b", p) for a in aliases)
    return strict, bool(lenient)


def pctl(values: list[float], q: float) -> Optional[float]:
    """Nearest-rank percentile."""
    if not values:
        return None
    v = sorted(values)
    k = max(1, int(-(-q * len(v) // 100)))  # ceil(q/100 * n)
    return v[min(k, len(v)) - 1]


def latency_summary(calls: list[dict[str, Any]]) -> dict[str, Any]:
    secs = [c["seconds"] for c in calls]
    ok = [c["seconds"] for c in calls if c["ok"]]
    return {
        "calls": len(calls),
        "errors": sum(not c["ok"] for c in calls),
        "error_reasons": dict(Counter(c.get("error", "") for c in calls if not c["ok"])),
        "median_s_all": round(statistics.median(secs), 3) if secs else None,
        "p95_s_all": round(pctl(secs, 95), 3) if secs else None,
        "median_s_ok": round(statistics.median(ok), 3) if ok else None,
        "p95_s_ok": round(pctl(ok, 95), 3) if ok else None,
        "max_s_all": round(max(secs), 3) if secs else None,
    }


# --------------------------------------------------------------------------- #
# Extraction
# --------------------------------------------------------------------------- #

def load_contract_text(ctx, filename: str) -> tuple[str, str]:
    path = CONTRACTS_DIR / filename
    if path.suffix.lower() == ".txt":
        return path.read_text(encoding="utf-8"), "text"
    res = ctx.ocr.extract(filename, path.read_bytes())
    return res.text, res.method


PACE_S = 0.0  # seconds to sleep between items for the gemini engine (set by --pace-s)


def _pace(engine: str) -> None:
    if engine == "gemini" and PACE_S > 0:
        time.sleep(PACE_S)


def run_extraction(engine: str) -> dict[str, Any]:
    gt = json.loads(GT_PATH.read_text(encoding="utf-8"))["contracts"]
    ctx, calls = make_ctx(engine)
    items = []
    for c in gt:
        _pace(engine)
        text, method = load_contract_text(ctx, c["file"])
        n_calls_before = len(calls)
        t0 = time.perf_counter()
        contract = document_agent.run(ctx, text, source={"eval_file": c["file"]})
        wall = time.perf_counter() - t0
        details = _audit_details(ctx, contract.id, "contract.extracted")
        pred_client = next((p.name for p in contract.parties if p.role == "client"), None)
        pred_free = next((p.name for p in contract.parties if p.role == "freelancer"), None)
        pred_ms = [{"title": m.title, "amount": m.amount, "due_date": m.due_date,
                    "criteria_count": len(m.acceptance_criteria), "criteria": m.acceptance_criteria}
                   for m in contract.milestones]
        cs, cl = party_match(pred_client, c["client"])
        fs, fl = party_match(pred_free, c["freelancer"])
        ms_scores = []
        for i, g in enumerate(c["milestones"]):
            p = pred_ms[i] if i < len(pred_ms) else None
            ms_scores.append({
                "amount_ok": p is not None and abs(p["amount"] - g["amount"]) < 0.5,
                "due_ok": p is not None and p["due_date"] == g["due_date"],
                "criteria_count_ok": p is not None and p["criteria_count"] == g["criteria_count"],
                "criteria_count_within1": p is not None and abs(p["criteria_count"] - g["criteria_count"]) <= 1,
            })
        count_ok = len(pred_ms) == len(c["milestones"])
        core_ok = cs and fs and count_ok and all(m["amount_ok"] and m["due_ok"] for m in ms_scores)
        items.append({
            "id": c["id"], "file": c["file"], "text_method": method,
            "engine_used": details.get("engine"), "fallback_reason": details.get("fallback_reason"),
            "wall_s": round(wall, 3), "gemini_calls": len(calls) - n_calls_before,
            "pred": {"client": pred_client, "freelancer": pred_free, "milestones": pred_ms},
            "gold": {"milestones": c["milestones"]},
            "score": {
                "client_strict": cs, "freelancer_strict": fs, "client_lenient": cl, "freelancer_lenient": fl,
                "parties_strict": cs and fs, "parties_lenient": cl and fl,
                "count_ok": count_ok, "milestones": ms_scores,
                "fully_correct_excl_criteria": core_ok,
                "fully_correct": core_ok and all(m["criteria_count_ok"] for m in ms_scores),
            },
        })

    n = len(items)
    all_ms = [m for it in items for m in it["score"]["milestones"]]

    def rate(k, xs):
        hits = sum(bool(x[k]) for x in xs)
        return {"correct": hits, "n": len(xs), "rate": round(hits / len(xs), 4) if xs else None}

    scores = [it["score"] for it in items]
    metrics = {
        "contracts": n,
        "gold_milestones": len(all_ms),
        "client_name_strict": rate("client_strict", scores),
        "freelancer_name_strict": rate("freelancer_strict", scores),
        "both_parties_strict": rate("parties_strict", scores),
        "both_parties_lenient": rate("parties_lenient", scores),
        "milestone_count_exact": rate("count_ok", scores),
        "milestone_amount_exact": rate("amount_ok", all_ms),
        "milestone_due_date_exact": rate("due_ok", all_ms),
        "milestone_criteria_count_exact": rate("criteria_count_ok", all_ms),
        "milestone_criteria_count_within_1": rate("criteria_count_within1", all_ms),
        "contract_fully_correct": rate("fully_correct", scores),
        "contract_fully_correct_excl_criteria_count": rate("fully_correct_excl_criteria", scores),
        "engine_used": dict(Counter(it["engine_used"] for it in items)),
        "pdf_text_methods": dict(Counter(it["text_method"] for it in items if it["text_method"] != "text")),
    }
    return {"metrics": metrics, "latency_gemini": latency_summary(calls),
            "latency_wall_per_contract_s": {
                "median": round(statistics.median(it["wall_s"] for it in items), 4),
                "p95": round(pctl([it["wall_s"] for it in items], 95), 4)},
            "items": items}


# --------------------------------------------------------------------------- #
# Referee
# --------------------------------------------------------------------------- #

def gold_decision(labels: list[str]) -> str:
    if all(l == "met" for l in labels):
        return "approve"
    if any(l == "not_met" for l in labels):
        return "reject"
    return "needs_review"


def run_referee(engine: str) -> dict[str, Any]:
    groups = json.loads(CASES_PATH.read_text(encoding="utf-8"))["groups"]
    ctx, calls = make_ctx(engine)
    items, pairs = [], []
    for g in groups:
        _pace(engine)
        contract_id = f"eval-{g['id']}"
        criteria = [c["text"] for c in g["criteria"]]
        ms = Milestone(contract_id=contract_id, seq=1, title=g["milestone_title"],
                       description=g.get("description", ""), acceptance_criteria=criteria)
        sub = Submission(milestone_id=ms.id, notes=g["submission_notes"],
                         extracted_text=g.get("submission_attachment", ""))
        n_before = len(calls)
        t0 = time.perf_counter()
        verdict = referee_agent.run(ctx, contract_id, ms, sub)
        wall = time.perf_counter() - t0
        details = _audit_details(ctx, contract_id, "verdict.issued")
        gold_labels = [c["gold"] for c in g["criteria"]]
        gd = gold_decision(gold_labels)
        for c, r in zip(g["criteria"], verdict.criteria_results):
            pairs.append({"group": g["id"], "criterion": c["text"], "case_type": c["case_type"],
                          "gold": c["gold"], "pred_met": r.met, "evidence": r.evidence})
        items.append({"id": g["id"], "engine_used": details.get("engine"),
                      "fallback_reason": details.get("fallback_reason"), "wall_s": round(wall, 3),
                      "gemini_calls": len(calls) - n_before,
                      "gold_decision": gd, "pred_decision": verdict.decision,
                      "confidence": verdict.confidence, "reasoning": verdict.reasoning})

    # criterion level
    conf = {gl: {"pred_met": 0, "pred_not_met": 0} for gl in ("met", "not_met", "insufficient_evidence")}
    for p in pairs:
        conf[p["gold"]]["pred_met" if p["pred_met"] else "pred_not_met"] += 1
    correct = sum((p["gold"] == "met") == p["pred_met"] for p in pairs)
    neg = [p for p in pairs if p["gold"] != "met"]
    insuff = [p for p in pairs if p["gold"] == "insufficient_evidence"]
    unsupported = [p for p in pairs if p["case_type"] == "unsupported_claim"]
    pos = [p for p in pairs if p["gold"] == "met"]
    by_type: dict[str, dict[str, int]] = {}
    for p in pairs:
        d = by_type.setdefault(p["case_type"], {"n": 0, "correct": 0})
        d["n"] += 1
        d["correct"] += int((p["gold"] == "met") == p["pred_met"])

    # milestone level
    labels = ("approve", "reject", "needs_review")
    dconf = {gl: {pl: 0 for pl in labels} for gl in labels}
    for it in items:
        dconf[it["gold_decision"]][it["pred_decision"]] += 1
    dcorrect = sum(it["gold_decision"] == it["pred_decision"] for it in items)
    non_approve = [it for it in items if it["gold_decision"] != "approve"]
    metrics = {
        "pairs": len(pairs), "groups": len(items),
        "criterion_accuracy": {"correct": correct, "n": len(pairs), "rate": round(correct / len(pairs), 4)},
        "criterion_confusion": conf,
        "false_met_on_not_met_or_insufficient": {
            "count": sum(p["pred_met"] for p in neg), "n": len(neg),
            "rate": round(sum(p["pred_met"] for p in neg) / len(neg), 4) if neg else None},
        "false_met_on_insufficient_evidence": {
            "count": sum(p["pred_met"] for p in insuff), "n": len(insuff),
            "rate": round(sum(p["pred_met"] for p in insuff) / len(insuff), 4) if insuff else None},
        "false_met_on_unsupported_claims": {
            "count": sum(p["pred_met"] for p in unsupported), "n": len(unsupported)},
        "false_not_met_on_met": {"count": sum(not p["pred_met"] for p in pos), "n": len(pos)},
        "criterion_accuracy_by_case_type": by_type,
        "decision_accuracy": {"correct": dcorrect, "n": len(items), "rate": round(dcorrect / len(items), 4)},
        "decision_confusion_gold_rows_pred_cols": dconf,
        "unsafe_approvals": {"count": sum(it["pred_decision"] == "approve" for it in non_approve),
                             "n": len(non_approve)},
        "engine_used": dict(Counter(it["engine_used"] for it in items)),
    }
    return {"metrics": metrics, "latency_gemini": latency_summary(calls),
            "latency_wall_per_verdict_s": {
                "median": round(statistics.median(it["wall_s"] for it in items), 4),
                "p95": round(pctl([it["wall_s"] for it in items], 95), 4)},
            "items": items, "pairs": pairs}


# --------------------------------------------------------------------------- #
# Reporting
# --------------------------------------------------------------------------- #

def _fmt(r: dict[str, Any]) -> str:
    return f"{r['correct']}/{r['n']} ({100 * r['rate']:.1f}%)" if r.get("n") else "n/a"


def print_summary(results: dict[str, Any]) -> None:
    engines = list(results["engines"].keys())
    print("\n## Extraction")
    rows = ["both_parties_strict", "both_parties_lenient", "client_name_strict", "freelancer_name_strict",
            "milestone_count_exact", "milestone_amount_exact", "milestone_due_date_exact",
            "milestone_criteria_count_exact", "milestone_criteria_count_within_1",
            "contract_fully_correct_excl_criteria_count", "contract_fully_correct"]
    print("| Metric | " + " | ".join(engines) + " |")
    print("|---|" + "---|" * len(engines))
    for r in rows:
        print(f"| {r} | " + " | ".join(_fmt(results["engines"][e]["extraction"]["metrics"][r]) for e in engines) + " |")
    print("\n## Referee")
    for e in engines:
        m = results["engines"][e]["referee"]["metrics"]
        print(f"[{e}] criterion acc {_fmt(m['criterion_accuracy'])}; decision acc {_fmt(m['decision_accuracy'])}; "
              f"false met on insufficient {m['false_met_on_insufficient_evidence']['count']}/{m['false_met_on_insufficient_evidence']['n']}; "
              f"false met on not_met|insufficient {m['false_met_on_not_met_or_insufficient']['count']}/{m['false_met_on_not_met_or_insufficient']['n']}; "
              f"unsafe approvals {m['unsafe_approvals']['count']}/{m['unsafe_approvals']['n']}")
        print(f"   criterion confusion {m['criterion_confusion']}")
        print(f"   decision confusion {m['decision_confusion_gold_rows_pred_cols']}")
        print(f"   engines used {m['engine_used']}")
    for e in engines:
        for part in ("extraction", "referee"):
            print(f"[{e}] {part} gemini latency: {results['engines'][e][part]['latency_gemini']}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--engines", default="gemini,heuristic")
    ap.add_argument("--out", default=str(HERE / "results.json"))
    ap.add_argument("--tag", default="baseline")
    ap.add_argument("--pace-s", type=float, default=0.0,
                    help="sleep between Gemini items (outside the timed call) to stay under the API rate limit")
    args = ap.parse_args()
    global PACE_S
    PACE_S = args.pace_s
    engines = [e.strip() for e in args.engines.split(",") if e.strip()]
    results: dict[str, Any] = {
        "_note": "SYNTHETIC, AUTHOR-LABELED data. Single run per engine. See eval/RESULTS.md.",
        "tag": args.tag,
        "pace_s": args.pace_s,
        "run_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "engines": {},
    }
    for e in engines:
        ctx, _ = make_ctx(e)
        model = ctx.gemini.model if e == "gemini" else None
        print(f"Running engine={e} model={model} ...", flush=True)
        results["engines"][e] = {"model": model, "extraction": run_extraction(e), "referee": run_referee(e)}
    Path(args.out).write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print_summary(results)
    print(f"\nWrote {args.out}")


if __name__ == "__main__":
    main()
