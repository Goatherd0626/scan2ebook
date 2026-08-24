"""命令行入口：python -m scan2ebook <book.pdf> [options]"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from tqdm import tqdm

from . import __version__
from .builder import PageMarker, build_stream, items_to_markdown, to_markdown
from .config import OCR_DPI, OCR_LANGUAGES
from .docx_out import convert as convert_to_docx, md_to_epub
from .layout import classify_page
from .llm import DeepSeekClient
from .ocr_engine import ocr_image
from .page_model import PARA_BODY, PARA_FOOTNOTE, PARA_HEADING, Page, Paragraph, TextBlock
from .pdf_utils import extract_text_layer, has_text_layer, open_pdf, render_page
from .vision import VisionStructure
from .web_reader import build_reader_html

log = logging.getLogger("scan2ebook")


def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        prog="scan2ebook",
        description="扫描版书籍 → 带页码锚定的电子书（Markdown / Word / EPUB / 网页阅读器）",
    )
    ap.add_argument("book", help="扫描版 PDF 路径")
    ap.add_argument("-o", "--out", default="output", help="输出目录（默认 ./output）")
    ap.add_argument("--dpi", type=int, default=OCR_DPI, help="渲染分辨率（默认 300）")
    ap.add_argument("--lang", default=",".join(OCR_LANGUAGES),
                    help="OCR 语言偏好，逗号分隔（默认 zh-Hans,zh-Hant,en-US）")
    ap.add_argument("--force-ocr", action="store_true",
                    help="即使 PDF 自带文字层也强制走 OCR")
    ap.add_argument("--vision", action="store_true",
                    help="ds-vision 结构化模式（推荐）：OCR 后逐页调用 DeepSeek 视觉模型"
                         "分析版面（标题/正文/脚注/引用位置），输出逐页 JSON + 网页阅读器"
                         "（需 DEEPSEEK_API_KEY）")
    ap.add_argument("--with-llm", action="store_true",
                    help="使用 DeepSeek API 精修标题与提取元数据（需 DEEPSEEK_API_KEY）")
    ap.add_argument("--page-marks", choices=["banner", "inline", "footnote", "none"],
                    help="Word/EPUB 中页码的呈现方式：banner=页面横幅高亮（默认）"
                         "，inline=每段后行内标记，footnote=页脚注，none=不显示")
    ap.add_argument("--inline-pages", action="store_true",
                    help="等价于 --page-marks inline（每个正文段落后〔PDF 第N页〕）")
    ap.add_argument("--no-page-notes", action="store_true",
                    help="等价于 --page-marks none（Word/EPUB 中不显示页码）")
    ap.add_argument("--no-footnotes", action="store_true", help="丢弃脚注内容")
    ap.add_argument("--no-docx", action="store_true", help="只生成 Markdown，不转 Word")
    ap.add_argument("--no-epub", action="store_true", help="不生成 EPUB")
    ap.add_argument("--verbose", action="store_true")
    return ap.parse_args(argv)


def _ocr_pages(doc, args) -> tuple[list[Page], list]:
    """逐页 OCR。返回 (pages, images)。"""
    langs = [x.strip() for x in args.lang.split(",") if x.strip()] or OCR_LANGUAGES
    pages: list[Page] = []
    imgs: list = []
    for i in tqdm(range(len(doc)), desc="OCR 识别", unit="页"):
        try:
            img = render_page(doc, i, dpi=args.dpi)
        except Exception as e:  # noqa: BLE001
            log.warning("第 %d 页渲染失败：%s", i + 1, e)
            continue
        imgs.append(img)
        page = Page(pdf_page=i + 1, width=img.width, height=img.height)
        try:
            page.blocks = ocr_image(img, languages=langs)
        except Exception as e:  # noqa: BLE001
            log.warning("第 %d 页 OCR 失败：%s", i + 1, e)
        classify_page(page)
        pages.append(page)
    return pages, imgs


def _textlayer_pages(doc) -> list[Page]:
    pages: list[Page] = []
    texts = extract_text_layer(doc)
    for i, t in enumerate(texts):
        page = Page(pdf_page=i + 1, width=1, height=1)
        if t.strip():
            page.blocks = [TextBlock(
                text=t.strip(),
                bbox=(0.05, 0.05, 0.95, 0.95),
                confidence=1.0,
                kind="body",
            )]
        pages.append(page)
    return pages


def _save_sidecars(out_dir: Path, book, stream) -> dict:
    # 段落级页码索引（一律以 PDF 页为准）
    para_path = out_dir / "paragraphs.jsonl"
    n_paras = 0
    with open(para_path, "w", encoding="utf-8") as f:
        for item in stream:
            if not isinstance(item, Paragraph):
                continue
            n_paras += 1
            rec = {
                "kind": item.kind,
                "level": item.level,
                "text": item.text[:200],
                "pdf_pages": item.pdf_pages,
            }
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    meta_path = out_dir / "meta.json"
    meta = dict(book.metadata)
    meta["source"] = book.source_path
    meta["pdf_pages_total"] = len(book.pages)
    meta["paragraphs"] = n_paras
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    return {"paragraphs": para_path, "meta": meta_path}


def main(argv=None) -> int:
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

    doc = open_pdf(str(src))
    log.info("共 %d 页：%s", len(doc), src.name)

    use_text_layer = has_text_layer(doc) and not args.force_ocr
    if use_text_layer:
        log.info("检测到 PDF 自带文字层，直接抽取文字（--force-ocr 可强制走 OCR）")
        pages, imgs = _textlayer_pages(doc), []
    else:
        log.info("逐页 OCR（Apple Vision，语言：%s）", args.lang)
        pages, imgs = _ocr_pages(doc, args)

    if args.vision:
        vs = VisionStructure()
        if not vs.enabled:
            log.warning("--vision 需要 DEEPSEEK_API_KEY（.env），已回退到规则模式")
        else:
            return _run_vision(args, src, out_dir, stem, pages, imgs, vs)

    # 组装段落流
    stream = build_stream(pages)

    # DeepSeek 精修（可选）
    client = DeepSeekClient()
    metadata: dict = {}
    if args.with_llm and client.enabled:
        log.info("DeepSeek：提取元数据…")
        first_pages_text = "\n".join(
            "\n".join(b.clean() for b in p.blocks) for p in pages[:3]
        )
        metadata = client.extract_metadata(first_pages_text)
        _refine_headings(client, stream)
    elif args.with_llm and not client.enabled:
        log.warning("--with-llm 已指定但未设置 DEEPSEEK_API_KEY，跳过 LLM 精修")

    if args.no_footnotes:
        stream = [it for it in stream if not (isinstance(it, Paragraph) and it.kind == PARA_FOOTNOTE)]

    # 页码呈现方式：--page-marks 优先，其次兼容旧参数
    if args.page_marks is not None:
        marks_style = args.page_marks
    elif args.inline_pages:
        marks_style = "inline"
    elif args.no_page_notes:
        marks_style = "none"
    else:
        marks_style = "banner"

    # 元数据（无 LLM 时至少给个标题，方便 EPUB/Word 元数据）
    meta = dict(metadata) if metadata else {}
    meta.setdefault("title", stem)

    # Markdown（页码以 HTML 注释形式记录，源文件可读）
    md_text = to_markdown(stream, metadata=meta,
                          inline_pages=(marks_style == "inline"))
    md_path = out_dir / f"{stem}.md"
    md_path.write_text(md_text, encoding="utf-8")
    log.info("Markdown 已生成：%s", md_path)

    # 侧车文件
    book = type("Book", (), {"pages": pages, "metadata": metadata, "source_path": src.name})()
    side = _save_sidecars(out_dir, book, stream)

    # Word / EPUB（页码呈现方式由 marks_style 决定）
    if not args.no_docx or not args.no_epub:
        marker_map = {"banner": "banner", "inline": "comment",
                      "footnote": "footnote", "none": "comment"}
        out_md = to_markdown(stream, metadata=meta,
                             inline_pages=(marks_style == "inline"),
                             page_markers=marker_map[marks_style])
        tmp = out_dir / "_conversion_source.md"
        tmp.write_text(out_md, encoding="utf-8")
        if not args.no_docx:
            docx_path = out_dir / f"{stem}.docx"
            engine = convert_to_docx(str(tmp), str(docx_path))
            log.info("Word 已生成（%s，页码:%s）：%s", engine, marks_style, docx_path)
        if not args.no_epub:
            epub_path = out_dir / f"{stem}.epub"
            if md_to_epub(str(tmp), str(epub_path)):
                log.info("EPUB 已生成（页码:%s）：%s", marks_style, epub_path)
            else:
                log.warning("EPUB 生成失败或缺少 pandoc，已跳过")
        tmp.unlink(missing_ok=True)

    # 汇总
    headings = sum(1 for it in stream if isinstance(it, Paragraph) and it.kind == PARA_HEADING)
    footnotes = sum(1 for it in stream if isinstance(it, Paragraph) and it.kind == PARA_FOOTNOTE)
    log.info("完成：正文段 %d，标题 %d，脚注 %d（共 %d 页）",
             sum(1 for it in stream if isinstance(it, Paragraph) and it.kind == PARA_BODY),
             headings, footnotes, len(pages))
    print(f"\n✅ 输出目录：{out_dir}")
    for k, p in side.items():
        print(f"   - {k}: {p}")
    print(f"   - markdown: {md_path}")
    if not args.no_docx:
        print(f"   - word: {out_dir / (stem + '.docx')}")
    if not args.no_epub:
        print(f"   - epub: {out_dir / (stem + '.epub')}")
    return 0


def _run_vision(args, src: Path, out_dir: Path, stem: str, pages, imgs, vs: VisionStructure) -> int:
    """ds-vision 结构化模式：
    OCR → ds-vision 逐页版面结构化 → 逐页 JSON（用户约定格式）+ 网页阅读器
    + 重建 Markdown/Word/EPUB（脚注落在正文引用位置）。
    """
    # 1) ds-vision 逐页结构化（图像 + OCR 文本）
    ocr_texts = []
    for p in pages:
        lines = sorted(p.blocks, key=lambda b: (b.cy, b.x0))
        ocr_texts.append("\n".join(b.clean() for b in lines if b.clean()))
    structured = vs.structure_book(imgs, ocr_texts)

    if args.no_footnotes:
        for pg in structured:
            pg["items"] = [it for it in pg["items"] if it["type"] != "footnote"]

    # 2) 元数据（DeepSeek 文本模型，从书名页 OCR 提取）
    client = DeepSeekClient()
    metadata: dict = {}
    if client.enabled:
        metadata = client.extract_metadata("\n".join(ocr_texts[:3]))
    meta = dict(metadata)
    meta.setdefault("title", stem)

    # 3) 逐页 JSON 存储（用户约定的结构：{"pdf_page", "items":[...]}）
    pages_dir = out_dir / "pages"
    pages_dir.mkdir(exist_ok=True)
    for pg in structured:
        (pages_dir / f"page_{pg['pdf_page']:03d}.json").write_text(
            json.dumps(pg, ensure_ascii=False, indent=2), encoding="utf-8")
    all_path = out_dir / f"{stem}_pages.json"
    all_path.write_text(json.dumps(structured, ensure_ascii=False, indent=2), encoding="utf-8")

    # 4) 网页阅读器（自包含单文件）
    html_path = out_dir / f"{stem}.html"
    html_path.write_text(build_reader_html(structured, meta, stem), encoding="utf-8")
    log.info("网页阅读器已生成：%s", html_path)

    # 5) Markdown / Word / EPUB（脚注全局编号，落在正文引用位置）
    md_text = items_to_markdown(structured, metadata=meta)
    md_path = out_dir / f"{stem}.md"
    md_path.write_text(md_text, encoding="utf-8")
    log.info("Markdown 已生成：%s", md_path)
    if not args.no_docx or not args.no_epub:
        tmp = out_dir / "_vision_source.md"
        tmp.write_text(md_text, encoding="utf-8")
        if not args.no_docx:
            docx_path = out_dir / f"{stem}.docx"
            engine = convert_to_docx(str(tmp), str(docx_path))
            log.info("Word 已生成（%s，脚注在正文引用位置）：%s", engine, docx_path)
        if not args.no_epub:
            epub_path = out_dir / f"{stem}.epub"
            if md_to_epub(str(tmp), str(epub_path)):
                log.info("EPUB 已生成：%s", epub_path)
            else:
                log.warning("EPUB 生成失败或缺少 pandoc，已跳过")
        tmp.unlink(missing_ok=True)

    # 6) 汇总
    n_body = sum(1 for pg in structured for it in pg["items"] if it["type"] == "body")
    n_head = sum(1 for pg in structured for it in pg["items"] if it["type"] == "heading")
    n_fn = sum(1 for pg in structured for it in pg["items"] if it["type"] == "footnote")
    log.info("完成：正文段 %d，标题 %d，脚注 %d（共 %d 页）", n_body, n_head, n_fn, len(structured))
    print(f"\n✅ 输出目录：{out_dir}")
    print(f"   - 网页阅读器: {html_path}")
    print(f"   - 逐页JSON: {pages_dir}/ 与 {all_path}")
    print(f"   - markdown: {md_path}")
    if not args.no_docx:
        print(f"   - word: {out_dir / (stem + '.docx')}")
    if not args.no_epub:
        print(f"   - epub: {out_dir / (stem + '.epub')}")
    return 0


def _refine_headings(client: DeepSeekClient, stream: list) -> None:
    """收集候选标题行交给 DeepSeek 精修。"""
    candidates = []
    prev_was_marker = False
    for i, item in enumerate(stream):
        if isinstance(item, PageMarker):
            prev_was_marker = True
            continue
        if isinstance(item, Paragraph) and (item.kind == PARA_HEADING or
                                            (prev_was_marker and item.kind == PARA_BODY and len(item.text) <= 45)):
            candidates.append({"index": i, "page": item.pdf_pages[0], "text": item.text})
        prev_was_marker = False
    if not candidates:
        return
    log.info("DeepSeek：精修 %d 个候选标题…", len(candidates))
    res = client.refine_headings(candidates[:300])
    for idx, (level, text) in res.items():
        item = stream[idx]
        if isinstance(item, Paragraph):
            item.kind = PARA_HEADING
            item.level = level
            item.text = text


if __name__ == "__main__":
    sys.exit(main())
