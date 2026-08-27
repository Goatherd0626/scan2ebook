"""命令行入口：python -m scan2ebook <书.pdf> -o output

流水线：渲染 → OCR（Apple Vision 本地 / PDF 文字层）→ ds-vision 逐页结构化
→ 整本书 JSON + 网页阅读器 HTML。
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from collections import Counter
from pathlib import Path

from tqdm import tqdm

from .config import OCR_DPI, OCR_LANGUAGES
from .llm import DeepSeekClient
from .ocr_engine import ocr_image
from .pdf_utils import extract_text_layer, has_text_layer, open_pdf, render_page
from .toc import build_book_toc
from .vision import VisionStructure
from .web_reader import build_reader_html

log = logging.getLogger("scan2ebook")

# OCR 文字极少（<3 字）的页按空白页跳过，不调用视觉模型。
# 注意阈值不能太高：分册页/扉页常只有几个字（如「第一稿」），应送视觉模型分类。
BLANK_TEXT_THRESHOLD = 3


def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        prog="scan2ebook",
        description="扫描版书籍 → 带页码锚定的网页阅读器 + 整本结构化 JSON。\n"
                    "子命令：scan2ebook serve —— 启动本地阅读器（自动打开浏览器）",
    )
    ap.add_argument("book", help="扫描版 PDF 路径")
    ap.add_argument("-o", "--out", default="output", help="输出目录（默认 ./output）")
    ap.add_argument("--dpi", type=int, default=OCR_DPI, help="渲染分辨率（默认 300）")
    ap.add_argument("--lang", default=",".join(OCR_LANGUAGES),
                    help="OCR 语言偏好，逗号分隔（默认 zh-Hans,zh-Hant,en-US）")
    ap.add_argument("--force-ocr", action="store_true",
                    help="PDF 自带文字层时也强制走 OCR")
    ap.add_argument("--no-footnotes", action="store_true", help="丢弃脚注内容")
    ap.add_argument("--no-bundle", action="store_true",
                    help="不打包 .s2e（默认自动打包：pdf + json 的 zip 压缩包）")
    ap.add_argument("--serve", action="store_true",
                    help="转换完成后自动启动阅读器并打开浏览器")
    ap.add_argument("--split-pages", action="store_true",
                    help="除整本 JSON 外，额外输出 pages/page_NNN.json（抽查单页用）")
    ap.add_argument("--page-start", type=int, help="转换起始 PDF 页码（1-based，闭区间）")
    ap.add_argument("--page-end", type=int, help="转换结束 PDF 页码（1-based，闭区间）")
    ap.add_argument("--vision-model", help="多模态结构化模型（默认读取 DEEPSEEK_VISION_MODEL）")
    ap.add_argument("--progress-json", action="store_true",
                    help="向 stdout 输出 S2E_EVENT JSON 行，供 GUI 展示进度")
    ap.add_argument("--verbose", action="store_true")
    return ap.parse_args(argv)


def _resolve_page_indices(total_pages: int, start: int | None, end: int | None) -> list[int]:
    """把用户的 1-based 闭区间转换为 0-based 页索引。"""
    first = 1 if start is None else start
    last = total_pages if end is None else end
    if first < 1 or last < 1:
        raise ValueError("页码必须从 1 开始")
    if first > last:
        raise ValueError("起始页不能大于结束页")
    if last > total_pages:
        raise ValueError(f"结束页 {last} 超出 PDF 总页数 {total_pages}")
    return list(range(first - 1, last))


def _emit_progress(enabled: bool, event: dict) -> None:
    if not enabled:
        return
    print("S2E_EVENT " + json.dumps(event, ensure_ascii=False), flush=True)


def _render_and_ocr(doc, args, page_indices: list[int]) -> tuple[list, list[str]]:
    """渲染指定页面并得到每页 OCR 文本。返回 (imgs, ocr_texts)。

    PDF 自带文字层时直接用文字层文本（更准更快）；否则 Apple Vision OCR。
    """
    langs = [x.strip() for x in args.lang.split(",") if x.strip()] or OCR_LANGUAGES
    use_text_layer = has_text_layer(doc) and not args.force_ocr
    layer_texts = extract_text_layer(doc) if use_text_layer else None
    if use_text_layer:
        log.info("检测到 PDF 自带文字层，直接用文字层文本（--force-ocr 可强制 OCR）")

    imgs: list = []
    ocr_texts: list[str] = []
    iterator = tqdm(page_indices, desc="渲染+OCR", unit="页", disable=args.progress_json)
    for completed, i in enumerate(iterator, start=1):
        try:
            img = render_page(doc, i, dpi=args.dpi)
        except Exception as e:  # noqa: BLE001
            log.warning("第 %d 页渲染失败：%s", i + 1, e)
            imgs.append(None)
            ocr_texts.append("")
        else:
            imgs.append(img)
            if layer_texts is not None:
                ocr_texts.append((layer_texts[i] or "").strip())
            else:
                try:
                    blocks = ocr_image(img, languages=langs)
                    lines = sorted(blocks, key=lambda b: (b.cy, b.x0))
                    ocr_texts.append("\n".join(b.clean() for b in lines if b.clean()))
                except Exception as e:  # noqa: BLE001
                    log.warning("第 %d 页 OCR 失败：%s", i + 1, e)
                    ocr_texts.append("")
        _emit_progress(args.progress_json, {
            "stage": "ocr",
            "current": completed,
            "total": len(page_indices),
            "pdf_page": i + 1,
            "progress": round(5 + 45 * completed / len(page_indices), 2),
            "message": f"正在渲染并识别第 {i + 1} 页",
        })
    return imgs, ocr_texts


def main(argv=None) -> int:
    argv = list(argv) if argv is not None else sys.argv[1:]
    # 子命令：scan2ebook serve —— 启动本地阅读器
    if argv and argv[0] == "serve":
        from .reader import main as reader_main
        return reader_main(argv[1:])
    if argv and argv[0] == "inspect":
        return _inspect_pdf(argv[1:])

    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
        stream=sys.stderr,
    )

    src = Path(args.book)
    if not src.exists():
        log.error("找不到文件：%s", src)
        return 1
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = src.stem

    vs = VisionStructure(model=args.vision_model)
    if not vs.enabled:
        log.error("需要 DEEPSEEK_API_KEY（在 .env 中配置）才能运行")
        return 1

    doc = open_pdf(str(src))
    log.info("共 %d 页：%s", len(doc), src.name)
    try:
        page_indices = _resolve_page_indices(len(doc), args.page_start, args.page_end)
    except ValueError as e:
        log.error("页码范围无效：%s", e)
        return 2
    page_numbers = [i + 1 for i in page_indices]
    _emit_progress(args.progress_json, {
        "stage": "start",
        "current": 0,
        "total": len(page_indices),
        "progress": 1,
        "model": vs.model,
        "page_start": page_numbers[0],
        "page_end": page_numbers[-1],
        "message": f"准备转换第 {page_numbers[0]}–{page_numbers[-1]} 页",
    })

    # 1) 渲染 + OCR
    imgs, ocr_texts = _render_and_ocr(doc, args, page_indices)

    # 2) ds-vision 逐页结构化（图像 + OCR 文本）
    blank_indices = {i for i, t in enumerate(ocr_texts) if len(t.strip()) < BLANK_TEXT_THRESHOLD}
    if blank_indices:
        log.info("规则预筛 %d 页为空白/极简页（跳过视觉模型）", len(blank_indices))
    def on_structure_progress(event: dict) -> None:
        event["progress"] = round(50 + 45 * event["current"] / event["total"], 2)
        event["message"] = f"正在结构化第 {event['pdf_page']} 页"
        _emit_progress(args.progress_json, event)

    structured = vs.structure_book(
        imgs,
        ocr_texts,
        blank_indices=blank_indices,
        page_numbers=page_numbers,
        progress_callback=on_structure_progress,
        show_progress=not args.progress_json,
    )

    if args.no_footnotes:
        for pg in structured:
            pg["items"] = [it for it in pg["items"] if it["type"] != "footnote"]

    # 3) 元数据（DeepSeek 文本模型，从书名页 OCR 提取）
    _emit_progress(args.progress_json, {
        "stage": "finalize", "progress": 96, "usage": vs.usage_snapshot(),
        "message": "正在生成元数据与电子书文件",
    })
    client = DeepSeekClient()
    metadata: dict = {}
    if client.enabled:
        metadata = client.extract_metadata("\n".join(ocr_texts[:3]))
    meta = dict(metadata)
    meta.setdefault("title", stem)

    # 4) 整本书 JSON（页粒度保留在 pages 数组内，页码锚定不丢）
    book_json = {
        "pdf_source": src.name,
        "book": meta,
        "toc": build_book_toc(structured),
        "pages": structured,
    }
    book_path = out_dir / f"{stem}.json"
    book_path.write_text(json.dumps(book_json, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("整本书 JSON 已生成：%s", book_path)

    if args.split_pages:  # 可选：逐页小文件，方便抽查单页
        pages_dir = out_dir / "pages"
        pages_dir.mkdir(exist_ok=True)
        for pg in structured:
            (pages_dir / f"page_{pg['pdf_page']:03d}.json").write_text(
                json.dumps(pg, ensure_ascii=False, indent=2), encoding="utf-8")

    # 5) 网页阅读器（自包含单文件，快速预览用；完整阅读器见 python -m scan2ebook.reader）
    html_path = out_dir / f"{stem}.html"
    html_path.write_text(build_reader_html(structured, meta, stem), encoding="utf-8")
    log.info("网页阅读器已生成：%s", html_path)

    # 6) .s2e 打包（pdf + json 的 zip，阅读器主格式）
    if not args.no_bundle:
        s2e_path = out_dir / f"{stem}.s2e"
        _bundle_s2e(s2e_path, src, book_json)
        log.info("电子书包已生成：%s", s2e_path)

    # 6) 汇总
    kind_count = Counter(pg.get("page_kind", "body") for pg in structured)
    n_body = sum(1 for pg in structured for it in pg["items"] if it["type"] == "body")
    n_head = sum(1 for pg in structured for it in pg["items"] if it["type"] == "heading")
    n_fn = sum(1 for pg in structured for it in pg["items"] if it["type"] == "footnote")
    n_toc = sum(1 for e in book_json["toc"] if e.get("pdf_page"))
    log.info("完成：正文段 %d，标题 %d，脚注 %d，目录条目 %d（可跳转 %d）（共 %d 页）",
             n_body, n_head, n_fn, len(book_json["toc"]), n_toc, len(structured))
    log.info("页面类型分布：%s", dict(kind_count))
    print(f"\n✅ 输出目录：{out_dir}")
    print(f"   - 网页阅读器: {html_path}")
    print(f"   - 整本书JSON: {book_path}"
          + (f"\n   - 逐页JSON: {out_dir / 'pages'}/" if args.split_pages else ""))
    if not args.no_bundle:
        print(f"   - 电子书包: {out_dir / (stem + '.s2e')}（拖入阅读器打开）")
    if args.serve:
        _launch_reader()
    else:
        print(f"   - 启动阅读器: python -m scan2ebook serve")
    _emit_progress(args.progress_json, {
        "stage": "complete",
        "progress": 100,
        "usage": vs.usage_snapshot(),
        "output_dir": str(out_dir.resolve()),
        "book_json": str(book_path.resolve()),
        "html": str(html_path.resolve()),
        "s2e": str((out_dir / (stem + ".s2e")).resolve()) if not args.no_bundle else None,
        "message": "转换完成",
    })
    return 0


def _inspect_pdf(argv: list[str]) -> int:
    """为 GUI 返回 PDF 基本信息，不触发 OCR 或模型调用。"""
    ap = argparse.ArgumentParser(prog="scan2ebook inspect", description="读取 PDF 页数")
    ap.add_argument("book", help="PDF 路径")
    args = ap.parse_args(argv)
    src = Path(args.book)
    if not src.is_file():
        print(json.dumps({"ok": False, "error": f"找不到文件：{src}"}, ensure_ascii=False))
        return 1
    if src.suffix.lower() != ".pdf":
        print(json.dumps({"ok": False, "error": "inspect 仅支持 PDF 文件"}, ensure_ascii=False))
        return 1
    try:
        doc = open_pdf(str(src))
        payload = {"ok": True, "path": str(src.resolve()), "name": src.name, "pages": len(doc)}
        doc.close()
    except Exception as e:  # noqa: BLE001
        payload = {"ok": False, "error": f"无法读取 PDF：{e}"}
        print(json.dumps(payload, ensure_ascii=False))
        return 1
    print(json.dumps(payload, ensure_ascii=False))
    return 0


def _launch_reader(port: int = 8765, host: str = "127.0.0.1") -> None:
    """转换完成后后台启动阅读器服务并打开浏览器。"""
    import subprocess
    import time
    import urllib.request
    import webbrowser

    log.info("启动阅读器：python -m scan2ebook serve …")
    py = sys.executable
    subprocess.Popen(
        [py, "-m", "scan2ebook.reader", "--port", str(port), "--host", host],
        start_new_session=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    url = f"http://{host}:{port}"
    for _ in range(30):
        try:
            urllib.request.urlopen(url, timeout=0.5)
            break
        except Exception:  # noqa: BLE001
            time.sleep(0.2)
    webbrowser.open(url)


def _bundle_s2e(s2e_path: Path, src: Path, book_json: dict) -> None:
    """打包 .s2e：zip 内含 book.json（结构化数据）与 book.pdf（原始扫描件）。"""
    import zipfile
    with zipfile.ZipFile(s2e_path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("book.json", json.dumps(book_json, ensure_ascii=False, indent=2))
        z.write(src, "book.pdf")


if __name__ == "__main__":
    sys.exit(main())
