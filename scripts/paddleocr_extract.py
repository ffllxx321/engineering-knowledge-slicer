import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False))


def is_cli_available():
    return shutil.which("paddleocr") is not None


def is_python_api_available():
    try:
        import paddleocr  # noqa: F401
        return True
    except Exception:
        return False


def read_markdown_files(directory):
    root = pathlib.Path(directory)
    if not root.exists():
        return ""
    parts = []
    for file in sorted(root.rglob("*.md")):
        try:
            parts.append(file.read_text(encoding="utf-8", errors="ignore"))
        except Exception:
            continue
    return "\n\n".join(part for part in parts if part.strip())


def run_cli(pdf_path):
    if not is_cli_available():
        return {
            "status": "failed",
            "engine": "paddleocr",
            "text": "",
            "message": "PaddleOCR CLI 未安装，跳过 CLI 模式。",
        }
    with tempfile.TemporaryDirectory(prefix="eks-paddleocr-") as output_dir:
        command = [
            "paddleocr",
            "pp_structurev3",
            "-i",
            pdf_path,
            "--save_path",
            output_dir,
        ]
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
            timeout=600,
        )
        if completed.returncode != 0:
            return {
                "status": "failed",
                "engine": "paddleocr",
                "text": "",
                "message": (completed.stderr or completed.stdout or "PaddleOCR CLI 执行失败").strip(),
            }

        markdown = read_markdown_files(output_dir)
        if markdown.strip():
            return {
                "status": "ok",
                "engine": "paddleocr-markdown",
                "text": markdown,
                "message": "",
            }
        return {
            "status": "failed",
            "engine": "paddleocr",
            "text": "",
            "message": "PaddleOCR CLI 未生成 Markdown 文件。",
        }


def append_markdown_value(value, parts):
    if isinstance(value, str) and value.strip():
        parts.append(value)
    elif isinstance(value, list):
        for item in value:
            append_markdown_value(item, parts)
    elif isinstance(value, dict):
        for key in ("markdown_texts", "text", "markdown", "content"):
            append_markdown_value(value.get(key))


def run_python_api(pdf_path):
    if not is_python_api_available():
        return {
            "status": "failed",
            "engine": "paddleocr",
            "text": "",
            "message": "PaddleOCR Python API 不可用。",
        }
    try:
        from paddleocr import PPStructureV3
    except Exception as exc:
        return {
            "status": "failed",
            "engine": "paddleocr",
            "text": "",
            "message": f"PaddleOCR Python API 导入失败：{exc}",
        }

    try:
        pipeline = PPStructureV3()
        results = pipeline.predict(input=pdf_path)
        parts = []
        for result in results:
            append_markdown_value(getattr(result, "markdown", None), parts)
            if hasattr(result, "json"):
                append_markdown_value(getattr(result, "json", None), parts)
            if isinstance(result, dict):
                append_markdown_value(result.get("markdown"), parts)
        text = "\n\n".join(part for part in parts if str(part).strip())
        if text.strip():
            return {
                "status": "ok",
                "engine": "paddleocr-markdown",
                "text": text,
                "message": "",
            }
        return {
            "status": "failed",
            "engine": "paddleocr",
            "text": "",
            "message": "PaddleOCR Python API 未返回 Markdown 文本。",
        }
    except Exception as exc:
        return {
            "status": "failed",
            "engine": "paddleocr",
            "text": "",
            "message": f"PaddleOCR Python API 执行失败：{exc}",
        }


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    if len(sys.argv) < 2:
        emit({"status": "failed", "engine": "paddleocr", "text": "", "message": "用法: paddleocr_extract.py <pdf路径>"})
        return

    pdf_path = sys.argv[1]
    if not os.path.exists(pdf_path):
        emit({"status": "failed", "engine": "paddleocr", "text": "", "message": f"PDF 文件不存在：{pdf_path}"})
        return

    cli_available = is_cli_available()
    api_available = is_python_api_available()

    if not cli_available and not api_available:
        emit({
            "status": "failed",
            "engine": "paddleocr",
            "text": "",
            "message": "PaddleOCR CLI 和 Python API 均不可用，请先安装 paddleocr。",
        })
        return

    if cli_available:
        cli_result = run_cli(pdf_path)
        if cli_result.get("status") == "ok":
            emit(cli_result)
            return

    if api_available:
        api_result = run_python_api(pdf_path)
        if api_result.get("status") == "ok":
            emit(api_result)
            return

    emit({
        "status": "failed",
        "engine": "paddleocr",
        "text": "",
        "message": f"{cli_result.get('message', '')} | {api_result.get('message', '')}".strip(" |"),
    })


if __name__ == "__main__":
    main()
