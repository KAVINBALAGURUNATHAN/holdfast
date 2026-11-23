"""Document agent: contract text -> structured Contract + Milestones.

Engine order: Gemini structured output (if GEMINI_API_KEY set) -> deterministic heuristic
extractor. The engine that actually ran is recorded in the `contract.extracted` audit event.
"""
from __future__ import annotations

import logging
import re
from datetime import date
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.deps import AppContext
from app.models import Contract, Milestone, Party
from app.services import audit
from app.services.gemini import GeminiError

log = logging.getLogger("holdfast.document_agent")

ACTOR = "document_agent"
MAX_LLM_CHARS = 60_000

# --------------------------------------------------------------------------- #
# Shared parsing helpers (also used to normalise Gemini output)
# --------------------------------------------------------------------------- #

_MONTHS = {
    m: i + 1
    for i, m in enumerate(
        ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    )
}
_MONTH_RE = r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"

_DATE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b"), "ymd"),
    (re.compile(r"\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b"), "dmy"),  # Indian convention: day first
    (re.compile(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?{_MONTH_RE}\.?,?\s+(\d{{4}})\b", re.I), "d_mon_y"),
    (re.compile(rf"\b{_MONTH_RE}\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?,?\s+(\d{{4}})\b", re.I), "mon_d_y"),
]

AMOUNT_RE = re.compile(
    r"(?:₹|\bINR\b|\bRs\.?|\bRupees\b)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(lakhs?|lacs?|crores?|k)?",
    re.I,
)
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
HEADING_RE = re.compile(
    r"^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:milestone|phase|stage)\s*(?:no\.?\s*|#\s*)?(\d+|[ivx]+)\b\s*[:\-–—.)]*\s*(.*?)\s*(?:\*\*)?\s*$",
    re.I,
)
SECTION_RE = re.compile(r"^\s*\d+\.\s+[A-Z][A-Z0-9 &,'/\-]{3,}$")
BULLET_RE = re.compile(r"^\s*(?:[-*•▪◦●]|\d+[.)]|[a-z][.)]|\([a-z0-9]+\))\s+(.+?)\s*$", re.I)
KV_RE = re.compile(r"^\s*([A-Za-z][A-Za-z /]{1,30})\s*:\s*(.*)$")

CLIENT_ROLES = r"client|buyer|customer|company|hirer|employer"
FREELANCER_ROLES = r"freelancer|service provider|developer|contractor|consultant|vendor|designer"


def parse_date(text: str) -> Optional[str]:
    """Return the first date found in `text` as ISO YYYY-MM-DD, or None."""
    if not text:
        return None
    best: Optional[tuple[int, str]] = None
    for pattern, kind in _DATE_PATTERNS:
        for m in pattern.finditer(text):
            try:
                if kind == "ymd":
                    d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
                elif kind == "dmy":
                    d = date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
                elif kind == "d_mon_y":
                    d = date(int(m.group(3)), _MONTHS[m.group(2)[:3].lower()], int(m.group(1)))
                else:
                    d = date(int(m.group(3)), _MONTHS[m.group(1)[:3].lower()], int(m.group(2)))
            except (ValueError, KeyError):
                continue
            if best is None or m.start() < best[0]:
                best = (m.start(), d.isoformat())
            break
    return best[1] if best else None


def parse_amount(text: str) -> Optional[float]:
    m = AMOUNT_RE.search(text or "")
    if not m:
        return None
    value = float(m.group(1).replace(",", ""))
    unit = (m.group(2) or "").lower()
    if unit.startswith(("lakh", "lac")):
        value *= 100_000
    elif unit.startswith("crore"):
        value *= 10_000_000
    elif unit == "k":
        value *= 1_000
    return round(value, 2)


def _clean_name(raw: str) -> str:
    name = re.split(r",|\s\(|;|\s-\s", raw.strip(), maxsplit=1)[0]
    return name.strip(" .*:\t")


def _extract_parties(text: str) -> list[Party]:
    lines = text.splitlines()
    parties: list[Party] = []
    for role, pattern in (("client", CLIENT_ROLES), ("freelancer", FREELANCER_ROLES)):
        line_re = re.compile(rf"^\s*(?:\*\*)?(?:the\s+)?(?:{pattern})(?:\*\*)?\s*:\s*(.+)$", re.I)
        email_re = re.compile(rf"^\s*(?:{pattern})\s*(?:'s)?\s*e-?mail\s*:\s*(\S+)", re.I)
        name = None
        email = None
        for line in lines:
            if name is None:
                m = line_re.match(line)
                if m and not re.match(r"^\s*e-?mail", m.group(1), re.I):
                    name = _clean_name(m.group(1))
                    em = EMAIL_RE.search(m.group(1))
                    email = em.group(0) if em else None
            m2 = email_re.match(line)
            if m2 and EMAIL_RE.search(m2.group(1)):
                email = EMAIL_RE.search(m2.group(1)).group(0)  # type: ignore[union-attr]
        if name:
            parties.append(Party(name=name[:120], role=role, email=email))  # type: ignore[arg-type]

    if len(parties) < 2:
        # "between X ... and Y" fallback
        m = re.search(r"\bbetween\s+(.{3,120}?)\s+\band\s+(.{3,120}?)(?:[.,(\n]|$)", text, re.I | re.S)
        if m:
            found_roles = {p.role for p in parties}
            if "client" not in found_roles:
                parties.append(Party(name=_clean_name(m.group(1)), role="client"))
            if "freelancer" not in found_roles:
                parties.append(Party(name=_clean_name(m.group(2)), role="freelancer"))
    parties.sort(key=lambda p: 0 if p.role == "client" else 1)
    return parties


def _split_milestone_blocks(lines: list[str]) -> list[tuple[str, str, list[str]]]:
    """Return [(number, heading_rest, block_lines)]."""
    blocks: list[tuple[str, str, list[str]]] = []
    current: Optional[tuple[str, str, list[str]]] = None
    for line in lines:
        m = HEADING_RE.match(line)
        if m and len(m.group(2)) <= 140:
            if current:
                blocks.append(current)
            current = (m.group(1), m.group(2).strip(" *:-–—"), [])
            continue
        if current is not None:
            if SECTION_RE.match(line):
                blocks.append(current)
                current = None
                continue
            current[2].append(line)
    if current:
        blocks.append(current)
    return blocks


def _parse_block(num: str, heading: str, block: list[str], seq: int) -> dict[str, Any]:
    title = heading or f"Milestone {num}"
    amount: Optional[float] = None
    due: Optional[str] = None
    description_parts: list[str] = []
    criteria: list[str] = []
    in_criteria = False
    loose_bullets: list[str] = []

    for raw in block:
        line = raw.strip()
        if not line:
            continue
        kv = KV_RE.match(line)
        key = kv.group(1).strip().lower() if kv else ""
        if kv and re.search(r"acceptance|criteria|deliverables?|definition of done", key):
            in_criteria = True
            rest = kv.group(2).strip()
            if rest:
                criteria.extend(s.strip(" .") for s in re.split(r";|\s\|\s", rest) if s.strip(" ."))
            continue
        if kv and re.search(r"amount|fee|payment|price|value", key) and amount is None:
            amount = parse_amount(kv.group(2))
            continue
        if kv and re.search(r"due|deadline|date|deliver|complet|timeline", key) and due is None:
            due = parse_date(kv.group(2))
            continue
        if kv and re.search(r"description|scope|summary|details", key):
            in_criteria = False
            if kv.group(2).strip():
                description_parts.append(kv.group(2).strip())
            continue
        b = BULLET_RE.match(line)
        if b:
            (criteria if in_criteria else loose_bullets).append(b.group(1).strip())
            continue
        if amount is None and AMOUNT_RE.search(line):
            amount = parse_amount(line)
        if due is None and re.search(r"due|deadline|by|on or before", line, re.I):
            due = parse_date(line)
        if not in_criteria:
            description_parts.append(line)

    if not criteria:
        criteria = loose_bullets
    if amount is None:
        amount = parse_amount("\n".join(block))
    if due is None:
        due = parse_date("\n".join(block))
    return {
        "seq": seq,
        "title": title[:200],
        "description": " ".join(description_parts)[:2000],
        "acceptance_criteria": [c[:500] for c in criteria if c][:20],
        "amount": amount or 0.0,
        "due_date": due,
    }


def heuristic_extract(text: str, title: Optional[str] = None) -> dict[str, Any]:
    lines = text.splitlines()
    first_line = next((ln.strip() for ln in lines if ln.strip()), "Untitled contract")
    if first_line.isupper():
        first_line = first_line.title()
    milestones = [
        _parse_block(num, heading, block, i + 1)
        for i, (num, heading, block) in enumerate(_split_milestone_blocks(lines))
    ]

    total: Optional[float] = None
    m = re.search(r"total[^\n]{0,80}?((?:₹|\bINR\b|\bRs\.?)\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?(?:\s*(?:lakhs?|lacs?|crores?))?)", text, re.I)
    if m:
        total = parse_amount(m.group(1))
    ms_sum = round(sum(ms["amount"] for ms in milestones), 2)

    if not milestones:
        bullets = [b.group(1).strip() for ln in lines if (b := BULLET_RE.match(ln))]
        milestones = [{
            "seq": 1,
            "title": "Full project delivery",
            "description": "No explicit milestones found; the whole contract is treated as one milestone.",
            "acceptance_criteria": bullets[:10] or ["Deliverables described in the contract are completed"],
            "amount": total or parse_amount(text) or 0.0,
            "due_date": parse_date(text),
        }]
        ms_sum = milestones[0]["amount"]

    for ms in milestones:
        if not ms["acceptance_criteria"]:
            ms["acceptance_criteria"] = [f"{ms['title']} is delivered as described"]

    return {
        "title": (title or first_line)[:200],
        "parties": _extract_parties(text),
        "currency": "INR",
        "total_amount": ms_sum if ms_sum > 0 else (total or 0.0),
        "stated_total": total,
        "milestones": milestones,
    }


# --------------------------------------------------------------------------- #
# Gemini structured extraction
# --------------------------------------------------------------------------- #

class _GParty(BaseModel):
    name: str
    role: str = Field(description='Either "client" (pays) or "freelancer" (does the work)')
    email: Optional[str] = None


class _GMilestone(BaseModel):
    title: str
    description: str
    acceptance_criteria: list[str] = Field(description="Concrete, checkable acceptance criteria, one per item")
    amount: float = Field(description="Milestone amount in INR as a plain number (e.g. 30000)")
    due_date: Optional[str] = Field(default=None, description="Due date as YYYY-MM-DD, or null if not stated")


class _GContract(BaseModel):
    title: str
    parties: list[_GParty]
    currency: str
    total_amount: float
    milestones: list[_GMilestone]


EXTRACTION_SYSTEM = (
    "You are the Document Agent of HoldFast, an escrow workflow tool for Indian freelancers and MSMEs. "
    "You extract structured data from contracts. Only use facts stated in the contract text; never invent "
    "parties, amounts or dates. Indian number formatting applies (1,50,000 = 150000; 1.5 lakh = 150000). "
    "Dates written like 20/12/2026 are day/month/year."
)

EXTRACTION_PROMPT = """Extract the following from the contract below and return JSON matching the schema:
- title: a short descriptive title for the contract
- parties: the client (who pays) and the freelancer/service provider (who delivers), with emails if stated
- currency: ISO code (normally "INR")
- total_amount: total contract value in INR (number, excluding GST unless only a GST-inclusive figure is given)
- milestones: in order. For each: title, a one-sentence description, acceptance_criteria (copy each criterion
  as a concrete, verifiable statement; if none are explicit, derive them strictly from the stated deliverables),
  amount in INR (number), due_date as YYYY-MM-DD or null if not stated.
If the contract has no explicit milestones, return a single milestone covering the full scope.

CONTRACT TEXT:
<<<
{text}
>>>"""


def _normalize_gemini(result: _GContract, title: Optional[str]) -> dict[str, Any]:
    parties = []
    for p in result.parties:
        role = "freelancer" if re.search(FREELANCER_ROLES, p.role or "", re.I) else "client"
        email = p.email if p.email and EMAIL_RE.fullmatch(p.email.strip()) else None
        if p.name.strip():
            parties.append(Party(name=p.name.strip()[:120], role=role, email=email))  # type: ignore[arg-type]
    milestones = []
    for i, m in enumerate(result.milestones):
        due = None
        if m.due_date:
            due = m.due_date if re.fullmatch(r"\d{4}-\d{2}-\d{2}", m.due_date.strip()) else parse_date(m.due_date)
            if due:
                try:
                    date.fromisoformat(due)
                except ValueError:
                    due = None
        criteria = [c.strip()[:500] for c in m.acceptance_criteria if c and c.strip()][:20]
        milestones.append({
            "seq": i + 1,
            "title": (m.title or f"Milestone {i + 1}")[:200],
            "description": (m.description or "")[:2000],
            "acceptance_criteria": criteria or [f"{m.title} is delivered as described"],
            "amount": max(float(m.amount or 0), 0.0),
            "due_date": due,
        })
    ms_sum = round(sum(ms["amount"] for ms in milestones), 2)
    return {
        "title": (title or result.title or "Untitled contract")[:200],
        "parties": parties,
        "currency": "INR",
        "reported_currency": (result.currency or "INR").upper(),
        "total_amount": ms_sum if ms_sum > 0 else max(float(result.total_amount or 0), 0.0),
        "stated_total": result.total_amount,
        "milestones": milestones,
    }


# --------------------------------------------------------------------------- #
# Agent entry point
# --------------------------------------------------------------------------- #

def run(
    ctx: AppContext,
    raw_text: str,
    *,
    title: Optional[str] = None,
    source: dict[str, Any] | None = None,
) -> Contract:
    details: dict[str, Any] = dict(source or {})
    extracted: Optional[dict[str, Any]] = None

    if ctx.gemini.enabled and raw_text.strip():
        try:
            result = ctx.gemini.generate_json(
                EXTRACTION_PROMPT.format(text=raw_text[:MAX_LLM_CHARS]),
                _GContract,
                system_instruction=EXTRACTION_SYSTEM,
            )
            if result.milestones:
                extracted = _normalize_gemini(result, title)
                details.update(engine="gemini", model=ctx.gemini.model)
            else:
                details["fallback_reason"] = "gemini_returned_no_milestones"
        except GeminiError as exc:
            details["fallback_reason"] = str(exc)
    elif not ctx.gemini.enabled:
        details["fallback_reason"] = "gemini_not_configured"

    if extracted is None:
        extracted = heuristic_extract(raw_text, title)
        details["engine"] = "heuristic"

    contract = Contract(
        title=extracted["title"],
        status="draft",
        raw_text=raw_text,
        parties=extracted["parties"],
        currency="INR",
        total_amount=extracted["total_amount"],
    )
    contract.milestones = [
        Milestone(contract_id=contract.id, status="pending", **ms) for ms in extracted["milestones"]
    ]
    saved = ctx.store.create_contract(contract)

    details.update(
        milestone_count=len(saved.milestones),
        total_amount=saved.total_amount,
        stated_total=extracted.get("stated_total"),
        parties=[p.model_dump() for p in saved.parties],
        milestones=[
            {"seq": m.seq, "title": m.title, "amount": m.amount, "due_date": m.due_date,
             "criteria_count": len(m.acceptance_criteria)}
            for m in saved.milestones
        ],
    )
    if extracted.get("reported_currency") and extracted["reported_currency"] != "INR":
        details["warning_currency"] = f"Contract currency reported as {extracted['reported_currency']}; amounts treated as INR."
    if extracted.get("stated_total") and abs(extracted["stated_total"] - saved.total_amount) > 1:
        details["warning_total_mismatch"] = "Stated contract total differs from the sum of milestone amounts."
    audit.record(ctx.store, contract_id=saved.id, actor=ACTOR, action="contract.extracted", details=details)
    return saved
