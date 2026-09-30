#!/usr/bin/env python3
"""对 scan2ebook 产出的整本书 JSON 做质检报告。

用法:
    python scripts/report_book_json.py book.json

输出:页数、page_kind 分布、item 类型分布、标题清单、脚注数、可疑页(空页/超短页)、字符量。
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(description="整本书 JSON 质检报告")
    ap.add_argument("book_json")
    ap.add_argument("--short-threshold", type=int, default=60, help="正文页字符数低于该值视为可疑")
    args = ap.parse_args()

    data = json.loads(Path(args.book_json).read_text(encoding="utf-8"))
    pages = data.get("pages") or []
    kinds: Counter = Counter()
    types: Counter = Counter()
    headings: list[tuple[int, int, str]] = []
    chars = 0
    footnotes = 0
    suspicious: list[tuple[int, str, int]] = []

    for page in pages:
        pno = int(page.get("pdf_page") or 0)
        kind = str(page.get("page_kind") or "?")
        kinds[kind] += 1
        items = page.get("items") or []
        page_chars = 0
        for item in items:
            t = str(item.get("type") or "?")
            types[t] += 1
            text = str(item.get("text") or "")
            chars += len(text)
            if t in {"body", "heading"}:
                page_chars += len(text)
            if t == "heading":
                headings.append((pno, int(item.get("level") or 1), text.strip()[:70]))
            if t == "footnote":
                footnotes += 1
        if kind == "body" and page_chars < args.short_threshold:
            suspicious.append((pno, kind, page_chars))

    first = pages[0].get("pdf_page") if pages else None
    last = pages[-1].get("pdf_page") if pages else None
    print(f"书名            : {data.get('book', {}).get('title')}")
    print(f"页数            : {len(pages)}（pdf_page {first} → {last}）")
    print(f"正文字符数      : {chars}")
    print(f"page_kind 分布  : {dict(kinds)}")
    print(f"item 类型分布   : {dict(types)}")
    print(f"标题数          : {len(headings)}｜脚注数 {footnotes}")
    print(f"目录条目        : {len(data.get('toc') or [])}")
    if suspicious:
        print(f"可疑短正文页    : {suspicious[:20]}{' …' if len(suspicious) > 20 else ''}")
    else:
        print("可疑短正文页    : 无")
    if headings:
        print("标题清单（前 25 条）:")
        for pno, level, text in headings[:25]:
            print(f"  p{pno:<4} L{level} {text}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
