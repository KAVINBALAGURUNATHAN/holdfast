"""Build the PDF contracts in eval/contracts/ from eval/contracts/pdf_sources/*.txt.

SYNTHETIC DATA: these are author-written contracts used only for evaluation.
Dependency-free minimal PDF writer (Helvetica, text layer only) so the eval exercises the real
pdfplumber extraction path in app.services.ocr. Run from backend/:  .venv\\Scripts\\python -m eval.make_pdfs
"""
from __future__ import annotations

import textwrap
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "contracts" / "pdf_sources"
OUT = HERE / "contracts"

PAGE_W, PAGE_H = 595, 842  # A4 points
MARGIN, FONT_SIZE, LEADING = 50, 10, 14
LINES_PER_PAGE = int((PAGE_H - 2 * MARGIN) / LEADING)


def _esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _wrap(text: str) -> list[str]:
    out: list[str] = []
    for line in text.splitlines():
        if not line.strip():
            out.append("")
            continue
        indent = "  " if line.lstrip().startswith("-") else ""
        out.extend(textwrap.wrap(line, width=95, subsequent_indent=indent) or [""])
    return out


def build_pdf(text: str) -> bytes:
    text.encode("latin-1")  # Helvetica/WinAnsi only; fail loudly on unsupported characters
    lines = _wrap(text)
    pages = [lines[i:i + LINES_PER_PAGE] for i in range(0, len(lines), LINES_PER_PAGE)] or [[]]
    objs: list[bytes] = []
    # 1 catalog, 2 pages, 3 font, then (page, content) pairs
    kids = " ".join(f"{4 + 2 * i} 0 R" for i in range(len(pages)))
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>".encode())
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    for i, page in enumerate(pages):
        content_id = 5 + 2 * i
        objs.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>".encode()
        )
        ops = [f"BT /F1 {FONT_SIZE} Tf {LEADING} TL {MARGIN} {PAGE_H - MARGIN} Td"]
        for ln in page:
            ops.append(f"({_esc(ln)}) Tj T*")
        ops.append("ET")
        stream = "\n".join(ops).encode("latin-1")
        objs.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for n, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{n} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def main() -> None:
    for src in sorted(SRC.glob("*.txt")):
        dest = OUT / (src.stem + ".pdf")
        dest.write_bytes(build_pdf(src.read_text(encoding="utf-8")))
        print(f"wrote {dest.name}")


if __name__ == "__main__":
    main()
