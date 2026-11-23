"""Text extraction: txt decode, pdfplumber for digital PDFs, Tesseract OCR for images / scanned PDFs."""
from __future__ import annotations

import io
import logging
import os
from dataclasses import dataclass

from app.config import ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES, Settings

log = logging.getLogger("holdfast.ocr")


class UploadError(Exception):
    """Invalid upload (type/size). `status_code` maps to the HTTP response."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


class OCRUnavailableError(Exception):
    """Raised when an image needs OCR but no Tesseract binary is installed."""


@dataclass
class ExtractionResult:
    text: str
    method: str  # "text" | "pdfplumber" | "pdf_ocr" | "tesseract" | "none"
    warnings: list[str]


def _ext(filename: str) -> str:
    return os.path.splitext(filename or "")[1].lower()


def validate_upload(filename: str, data: bytes) -> str:
    """Validate size and type (extension + magic bytes). Returns normalized extension."""
    if len(data) > MAX_UPLOAD_BYTES:
        raise UploadError("File too large (max 10 MB).", 413)
    if not data:
        raise UploadError("Uploaded file is empty.", 400)
    ext = _ext(filename)
    if ext not in ALLOWED_EXTENSIONS:
        raise UploadError(
            f"Unsupported file type '{ext or 'none'}'. Allowed: pdf, png, jpg, txt.", 415
        )
    if ext == ".pdf" and not data.startswith(b"%PDF"):
        raise UploadError("File does not look like a valid PDF.", 415)
    if ext == ".png" and not data.startswith(b"\x89PNG"):
        raise UploadError("File does not look like a valid PNG.", 415)
    if ext in (".jpg", ".jpeg") and not data.startswith(b"\xff\xd8"):
        raise UploadError("File does not look like a valid JPEG.", 415)
    if ext == ".txt" and b"\x00" in data[:4096]:
        raise UploadError("Text file appears to be binary.", 415)
    return ext


class OCRService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._tesseract_cmd = settings.resolved_tesseract_cmd()
        if self._tesseract_cmd:
            try:
                import pytesseract

                pytesseract.pytesseract.tesseract_cmd = self._tesseract_cmd
            except ImportError:  # pragma: no cover
                self._tesseract_cmd = None

    @property
    def available(self) -> bool:
        return bool(self._tesseract_cmd)

    def _ocr_image(self, image) -> str:
        import pytesseract

        return pytesseract.image_to_string(image)

    def extract(self, filename: str, data: bytes) -> ExtractionResult:
        ext = validate_upload(filename, data)
        warnings: list[str] = []

        if ext == ".txt":
            return ExtractionResult(data.decode("utf-8", errors="replace"), "text", warnings)

        if ext == ".pdf":
            text = ""
            try:
                import pdfplumber

                with pdfplumber.open(io.BytesIO(data)) as pdf:
                    pages = [(p.extract_text() or "") for p in pdf.pages]
                text = "\n\n".join(pages).strip()
            except Exception as exc:  # malformed PDF etc.
                warnings.append(f"pdfplumber failed: {type(exc).__name__}")
            if len(text) >= 40:
                return ExtractionResult(text, "pdfplumber", warnings)
            # Probably a scanned PDF: try pdf2image + tesseract if both are available.
            if not self.available:
                warnings.append("PDF has little/no embedded text and Tesseract is not installed; OCR skipped.")
                return ExtractionResult(text, "pdfplumber", warnings)
            try:
                from pdf2image import convert_from_bytes

                images = convert_from_bytes(data, dpi=200)
                ocr_text = "\n\n".join(self._ocr_image(img) for img in images).strip()
                return ExtractionResult(ocr_text or text, "pdf_ocr", warnings)
            except Exception as exc:  # poppler missing, etc.
                warnings.append(f"Scanned-PDF OCR unavailable ({type(exc).__name__}); used embedded text only.")
                return ExtractionResult(text, "pdfplumber", warnings)

        # Images
        if not self.available:
            raise OCRUnavailableError(
                "Image OCR is unavailable: Tesseract is not installed on the server. "
                "Upload a PDF or .txt file instead, or install tesseract-ocr / set TESSERACT_CMD."
            )
        from PIL import Image

        try:
            image = Image.open(io.BytesIO(data))
            image.load()
        except Exception as exc:
            raise UploadError(f"Could not read image ({type(exc).__name__}).", 415) from exc
        return ExtractionResult(self._ocr_image(image).strip(), "tesseract", warnings)
