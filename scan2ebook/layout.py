"""版面分析：根据块坐标与文本特征，把 OCR 块分类为 页眉/页脚/页码/脚注/正文。

坐标均为归一化 (0~1)，原点左上。
"""
from __future__ import annotations

import re
from typing import Optional

from .config import LAYOUT_FOOTER_BAND, LAYOUT_FOOTNOTE_BAND, LAYOUT_HEADER_BAND
from .page_model import KIND_BODY, KIND_FOOTER, KIND_FOOTNOTE, KIND_HEADER, KIND_PAGE_NUM, Page, TextBlock

# 页码形态：纯数字 / 带装饰符号 / 罗马数字（正文 i ii iii / 序言等）
PAGE_NUM_RE = re.compile(r"^[\s\-–—·•．.]*(\d{1,4}|[IVXLCivxlc]{1,8})[\s\-–—·•．.]*$")

# 脚注起始标记：数字加点、圈号、星号剑号等
FOOTNOTE_MARK_RE = re.compile(r"^(?:\d{1,3}[\.、．\s]|[①②③④⑤⑥⑦⑧⑨⑩]|[*†‡§¶]|〔\d+〕|\d{1,3}\s*\))")

# 页眉常见形态：书名或章节名，多为中短文本
HEADER_MAX_CHARS = 60


def looks_like_page_number(text: str) -> bool:
    return bool(PAGE_NUM_RE.match(text.strip()))


def looks_like_footnote_start(text: str) -> bool:
    return bool(FOOTNOTE_MARK_RE.match(text.strip()))


def classify_page(page: Page) -> None:
    """就地给 page.blocks 打上 kind，并提取 printed_page。"""
    printed: Optional[str] = None
    in_footnote = False  # 脚注延续状态：区内的后续块视为脚注（OCR 常把一条脚注拆成多块）

    for b in sorted(page.blocks, key=lambda x: (x.y0, x.x0)):
        y0, y1 = b.y0, b.y1
        clean = b.clean()

        if not clean:
            b.kind = "blank"
            continue

        if y1 <= LAYOUT_HEADER_BAND and len(clean) <= HEADER_MAX_CHARS:
            b.kind = KIND_HEADER
            in_footnote = False
        elif y0 >= LAYOUT_FOOTER_BAND:
            if looks_like_page_number(clean):
                b.kind = KIND_PAGE_NUM
                if printed is None:
                    printed = _extract_page_number(clean)
            else:
                b.kind = KIND_FOOTER
            in_footnote = False
        elif y0 >= LAYOUT_FOOTNOTE_BAND:
            if looks_like_footnote_start(clean) or in_footnote:
                b.kind = KIND_FOOTNOTE
                in_footnote = True
            else:
                b.kind = KIND_BODY
        else:
            b.kind = KIND_BODY
            in_footnote = False

    page.printed_page = printed


def _extract_page_number(text: str) -> Optional[str]:
    m = PAGE_NUM_RE.match(text.strip())
    if m:
        return m.group(1)
    return None


def detect_columns(blocks: list[TextBlock]) -> int:
    """粗略检测版面是否双栏。返回 1 或 2。"""
    body = [b for b in blocks if b.kind == KIND_BODY and b.clean()]
    if len(body) < 6:
        return 1
    centers = sorted(b.cx for b in body)
    lo, hi = centers[0], centers[-1]
    span = hi - lo
    if span < 0.55:  # 单栏占版心足够宽
        return 1
    mid = (lo + hi) / 2
    left = [c for c in centers if c < mid]
    right = [c for c in centers if c >= mid]
    if not left or not right:
        return 1
    # 两栏之间的空隙应明显大于栏内行距（用 x 间隙衡量）
    gap = min(right) - max(left)
    if gap > 0.06 and (len(left) >= 3 and len(right) >= 3):
        return 2
    return 1
