import json
import sys


def extract_with_pdfplumber(path):
    import pdfplumber

    chunks = []
    total_pages = 0
    with pdfplumber.open(path) as pdf:
        total_pages = len(pdf.pages)
        for index, page in enumerate(pdf.pages, start=1):
            text = page.extract_text(x_tolerance=1, y_tolerance=3) or ""
            if text.strip():
                chunks.append(f"--- page {index} ---\n{text.strip()}")
    return "\n\n".join(chunks).strip(), total_pages


def extract_with_pypdf(path):
    from pypdf import PdfReader

    reader = PdfReader(path)
    chunks = []
    for index, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        if text.strip():
            chunks.append(f"--- page {index} ---\n{text.strip()}")
    return "\n\n".join(chunks).strip(), len(reader.pages)


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    if len(sys.argv) < 2:
        emit({"status": "failed", "engine": "", "text": "", "message": "用法: pdf_extract.py <pdf路径>"})
        return

    path = sys.argv[1]
    engine = ""
    text = ""
    errors = []
    total_pages = 0

    try:
        text, total_pages = extract_with_pdfplumber(path)
        engine = "pdfplumber"
    except Exception as exc:
        errors.append(f"pdfplumber: {exc}")

    if len(text.strip()) < 20:
        try:
            text, total_pages = extract_with_pypdf(path)
            engine = "pypdf"
        except Exception as exc:
            errors.append(f"pypdf: {exc}")

    status = "ok" if text.strip() else "empty"
    message = ""
    if status == "empty":
        message = f"本地解析未提取到文本（共 {total_pages} 页），建议使用 MinerU 或 PaddleOCR API。"
    elif total_pages > 0:
        message = f"已提取 {total_pages} 页文本。"

    payload = {
        "status": status,
        "engine": engine,
        "text": text,
        "total_pages": total_pages,
        "message": message,
        "errors": errors,
    }
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
