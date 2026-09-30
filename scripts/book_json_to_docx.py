#!/usr/bin/env python3
"""book.json → Word 文档（可选繁体转简体、页码标记）。

用法:
    python scripts/book_json_to_docx.py book.json -o out.docx [--no-page-marks] [--no-simplify]

输出结构:书名页 → 目录（若 JSON 提供）→ 正文（标题层级 / 正文段 / 脚注 / 图table 占位），
每个原书页首插入灰色页码标记，便于回到 PDF 核对引文。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

try:
    import zhconv
except ImportError:  # pragma: no cover - 可选依赖
    zhconv = None

SERIF = "宋体"
SANS = "黑体"
GRAY = RGBColor(0x8E, 0x8E, 0x93)

# 过滤扫描来源水印与模型偶发的 JSON / 代码片段幻觉
# （例如 Anna's Archive 在末页嵌入的来源说明与文件元数据）
CONTAM_RE = re.compile(
    r'^\s*\{\s*"'
    r'|"\s*(filename|md5|filesize|filename_decoded)\s*"'
    r'|^\s*```|^\s*<\|'
    r"|Anna.?s Archive|annas-archive|DuXiu collection|losslessly embedded",
    re.I,
)


def simplify(text: str, enabled: bool) -> str:
    if not enabled or not text:
        return text
    if zhconv is None:
        raise SystemExit("需要 zhconv 才能转简体：pip install zhconv（或用 --no-simplify）")
    return zhconv.convert(text, "zh-cn")


def style_run(run, *, name: str, size: float, bold: bool = False, color=None) -> None:
    run.font.name = name
    run.font.size = Pt(size)
    run.bold = bold
    if color is not None:
        run.font.color.rgb = color
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = rpr.makeelement(qn("w:rFonts"), {})
        rpr.append(rfonts)
    rfonts.set(qn("w:eastAsia"), name)
    rfonts.set(qn("w:ascii"), name)
    rfonts.set(qn("w:hAnsi"), name)


def add_body(doc: Document, text: str, *, condensed: bool = False) -> None:
    p = doc.add_paragraph()
    p.paragraph_format.first_line_indent = Pt(24 if not condensed else 0)
    p.paragraph_format.line_spacing = 1.5
    p.paragraph_format.space_after = Pt(4)
    style_run(p.add_run(text), name=SERIF, size=12)


def add_heading(doc: Document, text: str, level: int) -> None:
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14 if level <= 2 else 10)
    p.paragraph_format.space_after = Pt(7)
    p.paragraph_format.line_spacing = 1.3
    style_run(p.add_run(text), name=SANS, size={1: 18, 2: 15, 3: 13}.get(level, 12), bold=True)


def add_footnote(doc: Document, text: str, index) -> None:
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Pt(18)
    p.paragraph_format.line_spacing = 1.2
    p.paragraph_format.space_after = Pt(2)
    label = f"[{index}] " if index else ""
    style_run(p.add_run(label + text), name=SERIF, size=9, color=GRAY)


def add_marker(doc: Document, text: str) -> None:
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(6)
    style_run(p.add_run(text), name=SANS, size=9, color=GRAY)


def add_page_mark(doc: Document, page_no: int) -> None:
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(2)
    style_run(p.add_run(f"［原书 p.{page_no}］"), name=SANS, size=8, color=GRAY)


def build(book: dict, out_path: Path, *, page_marks: bool, to_simplified: bool,
          title_override: str | None = None, dedupe: bool = True) -> dict:
    doc = Document()
    normal = doc.styles["Normal"]
    normal.font.name = SERIF
    normal.font.size = Pt(12)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), SERIF)

    raw_title = title_override or str(book.get("book", {}).get("title") or "未命名").strip()
    title = simplify(raw_title, to_simplified)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(120)
    p.paragraph_format.space_after = Pt(24)
    style_run(p.add_run(title), name=SANS, size=26, bold=True)
    doc.add_page_break()

    toc = book.get("toc") or []
    if toc:
        add_heading(doc, "目录", 1)
        for entry in toc:
            text = simplify(str(entry.get("text") or "").strip(), to_simplified)
            if not text:
                continue
            level = int(entry.get("level") or 1)
            number = str(entry.get("number") or "").strip()
            printed = entry.get("printed_page")
            label = f"{number} {text}".strip() if number and number not in text else text
            line = f"{label} ……… {printed}" if printed else label
            para = doc.add_paragraph()
            para.paragraph_format.left_indent = Pt(12 * max(0, level - 1))
            para.paragraph_format.space_after = Pt(2)
            style_run(para.add_run(simplify(line, to_simplified)), name=SERIF, size=11)
        doc.add_page_break()

    counts = {"heading": 0, "body": 0, "footnote": 0, "marker": 0, "header": 0, "pages": 0,
              "dup_same": 0, "dup_cross": 0, "contaminated": 0}
    prev_norm = None
    page_tail_norm = None
    for page in book.get("pages") or []:
        items = page.get("items") or []
        if not items:
            continue
        counts["pages"] += 1
        if page_marks:
            add_page_mark(doc, int(page.get("pdf_page") or 0))
        for item in items:
            kind = str(item.get("type") or "").strip().lower()
            if kind == "heading":
                text = simplify(str(item.get("text") or "").strip(), to_simplified)
                if not text:
                    continue
                add_heading(doc, text, int(item.get("level") or 2))
                counts["heading"] += 1
                prev_norm = None
            elif kind == "body":
                text = simplify(str(item.get("text") or "").strip(), to_simplified)
                if not text:
                    continue
                if CONTAM_RE.search(text[:200]):
                    counts["contaminated"] += 1
                    continue
                norm = re.sub(r"\s+", "", text)
                if dedupe and prev_norm is not None and norm == prev_norm:
                    counts["dup_same"] += 1
                    continue
                if dedupe and page_tail_norm is not None and len(norm) > 60 and norm == page_tail_norm:
                    counts["dup_cross"] += 1
                    continue
                add_body(doc, text)
                counts["body"] += 1
                prev_norm = norm
                page_tail_norm = norm
            elif kind == "footnote":
                text = simplify(str(item.get("text") or "").strip(), to_simplified)
                if not text:
                    continue
                add_footnote(doc, text, item.get("index"))
                counts["footnote"] += 1
            elif kind == "figure":
                add_marker(doc, "［插图］")
                counts["marker"] += 1
            elif kind == "table":
                add_marker(doc, "［表格］")
                counts["marker"] += 1
            elif kind == "header":
                counts["header"] += 1  # 页眉重复信息不进入正文

    out_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(out_path)
    counts["title"] = title
    return counts


def main() -> int:
    ap = argparse.ArgumentParser(description="book.json → Word（可转简体）")
    ap.add_argument("book_json", help="scan2ebook 生成的整本书 JSON")
    ap.add_argument("-o", "--out", required=True, help="输出的 .docx 路径")
    ap.add_argument("--no-page-marks", action="store_true", help="不插入原书页码标记")
    ap.add_argument("--no-simplify", action="store_true", help="保留原文（不做繁简转换）")
    ap.add_argument("--title", help="覆盖书名（默认取 JSON 中的 book.title）")
    ap.add_argument("--no-dedupe", action="store_true",
                    help="不去重（默认去除相邻及跨页完全重复的正文段）")
    args = ap.parse_args()

    path = Path(args.book_json)
    if not path.exists():
        print(f"找不到 JSON：{path}", file=sys.stderr)
        return 1
    data = json.loads(path.read_text(encoding="utf-8"))
    counts = build(
        data,
        Path(args.out),
        page_marks=not args.no_page_marks,
        to_simplified=not args.no_simplify,
        title_override=args.title,
        dedupe=not args.no_dedupe,
    )
    print(f"✅ Word 已生成：{args.out}")
    print(f"   书名：{counts['title']}")
    print(f"   有内容页 {counts['pages']} 页｜标题 {counts['heading']}｜正文段 {counts['body']}｜"
          f"脚注 {counts['footnote']}｜图表占位 {counts['marker']}｜跳过页眉 {counts['header']}")
    print(f"   去重：页内重复 {counts['dup_same']} 段｜跨页重复 {counts['dup_cross']} 段"
          f"｜剔除模型幻觉片段 {counts['contaminated']} 条")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
