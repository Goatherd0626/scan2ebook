"""把逐页 OCR 结果组装成带页码锚定的 Markdown 段落流。

流程：版面分栏 → 行排序 → 页内段落合并 → 跨页续段 → 标题层级识别 → 页脚注保留。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from statistics import median
from typing import Optional

from .config import HEADING_GAP_RATIO, HEADING_MAX_CHARS
from .layout import detect_columns, looks_like_footnote_start
from .page_model import (
    PARA_BODY,
    PARA_FOOTNOTE,
    PARA_HEADING,
    KIND_BODY,
    KIND_FOOTNOTE,
    Page,
    Paragraph,
    TextBlock,
)

# 句子结束标点（CJK + 拉丁 + 引号收尾），锚定在行尾
SENTENCE_END_RE = re.compile(r"[。！？!?…\.\"”’』」）\)]$")

HEADING_L1_RE = re.compile(
    r"^(第[一二三四五六七八九十百千万零〇0-9]+[章节卷部篇回]"
    r"|[Cc]hapter\s+[0-9IVXLC]+|[Pp]art\s+[0-9IVXLC]+"
    r"|[Cc]h\.\s*\d+|[Ss]ection\s+[0-9IVXLC]+)"
)
HEADING_L2_RE = re.compile(
    r"^([一二三四五六七八九十]+、|[（(][一二三四五六七八九十0-9]+[)）]"
    r"|\d+(\.\d+)*\s+\S)"
)
HEADING_L3_RE = re.compile(r"^[（(][0-9一二三四五六七八九十]+[)）]")

HEADING_END_PUNCT_RE = re.compile(r"[。！？!?，,；;：:、]$")


@dataclass
class PageMarker:
    """页面边界标记，用于在 Markdown 中记录来源 PDF 页。"""

    pdf_page: int


Item = PageMarker | Paragraph


# ---------------------------------------------------------------------------
# 行排序与段落合并
# ---------------------------------------------------------------------------

def _sorted_body_blocks(blocks: list[TextBlock], n_cols: int) -> list[TextBlock]:
    body = [b for b in blocks if b.kind == KIND_BODY and b.clean()]
    if n_cols == 2:
        centers = [b.cx for b in body]
        mid = (min(centers) + max(centers)) / 2
        left = sorted([b for b in body if b.cx < mid], key=lambda b: (b.cy, b.x0))
        right = sorted([b for b in body if b.cx >= mid], key=lambda b: (b.cy, b.x0))
        return left + right
    return sorted(body, key=lambda b: (b.cy, b.x0))


def _line_gap(a: TextBlock, b: TextBlock) -> float:
    """a 的下缘到 b 的上缘的垂直间距（归一化）。"""
    return b.y0 - a.y1


def _median_height(blocks: list[TextBlock]) -> float:
    hs = [b.height for b in blocks if b.height > 0]
    return median(hs) if hs else 0.02


def _median_line_gap(blocks: list[TextBlock]) -> float:
    """页内相邻文本块的行间距中位数（用于判断换段）。"""
    gaps = [
        _line_gap(a, b)
        for a, b in zip(blocks, blocks[1:])
        if _line_gap(a, b) > 0.0005
    ]
    return median(gaps) if gaps else 0.008


def _is_indented(b: TextBlock, body: list[TextBlock]) -> bool:
    """判断某块是否相对本页正文左缘有明显缩进（段首缩进）。"""
    x0s = [x.x0 for x in body]
    if not x0s:
        return False
    margin = min(x0s)
    return (b.x0 - margin) >= 0.012


def _merge_lines(lines: list[TextBlock]) -> str:
    parts = []
    for ln in lines:
        t = ln.clean()
        if not t:
            continue
        if parts and _needs_space(parts[-1], t):
            parts.append(" ")
        parts.append(t)
    return "".join(parts)


def _needs_space(prev: str, cur: str) -> bool:
    """中英文混排：CJK 字符之间不加空格；拉丁之间加空格。"""
    def is_cjk(ch: str) -> bool:
        return "\u4e00" <= ch <= "\u9fff" or ch in "，。！？；：、（）「」『』《》〈〉"
    if not prev or not cur:
        return False
    return not is_cjk(prev[-1]) and not is_cjk(cur[0])


def _join_texts(a: str, b: str) -> str:
    """按中英混排规则拼接两段文本（跨页续段用）。"""
    if not a:
        return b
    if not b:
        return a
    return a + (" " if _needs_space(a, b) else "") + b


# ---------------------------------------------------------------------------
# 标题识别（规则版）
# ---------------------------------------------------------------------------

def _detect_heading(text: str, centered: bool, is_page_first: bool, gap_after: float, line_h: float) -> Optional[int]:
    """返回标题层级 1/2/3；不是标题返回 None。"""
    t = text.strip()
    if not t or len(t) > HEADING_MAX_CHARS:
        return None
    if HEADING_END_PUNCT_RE.search(t):
        return None

    l1 = bool(HEADING_L1_RE.match(t))
    l2 = bool(HEADING_L2_RE.match(t))
    l3 = bool(HEADING_L3_RE.match(t))
    big_gap = gap_after >= line_h * HEADING_GAP_RATIO
    strong = centered or l1 or l2 or l3
    if not strong:
        return None
    # 需要"排版信号"：要么后距大，要么位于页首
    if not (big_gap or is_page_first):
        return None
    if l1:
        return 1
    if l2:
        return 2
    if l3:
        return 3
    if centered:
        return 2
    return None


def _is_centered(b: TextBlock, page: Page) -> bool:
    margin = 0.12
    lo = page.width * 0.0  # 归一化，页面中心 0.5
    return abs(b.cx - 0.5) < margin and (b.x0 > 0.18 or b.x1 < 0.82)


# ---------------------------------------------------------------------------
# 主组装
# ---------------------------------------------------------------------------

def _group_footnotes(blocks: list[TextBlock]) -> list[list[TextBlock]]:
    """把一条脚注（可能被 OCR 拆成多块）按记号合并成组。"""
    groups: list[list[TextBlock]] = []
    cur: list[TextBlock] = []
    for b in sorted(blocks, key=lambda x: (x.y0, x.x0)):
        if looks_like_footnote_start(b.clean()):
            if cur:
                groups.append(cur)
            cur = [b]
        else:
            cur.append(b)
    if cur:
        groups.append(cur)
    return groups


def build_stream(pages: list[Page], use_llm_headings: bool = False) -> list[Item]:
    stream: list[Item] = []
    prev_para: Optional[Paragraph] = None

    for page in pages:
        blocks = page.blocks
        body = _sorted_body_blocks(blocks, detect_columns(blocks))
        footnote_groups = _group_footnotes(
            [b for b in blocks if b.kind == KIND_FOOTNOTE and b.clean()]
        )
        if not body and not footnotes:
            continue  # 空白页

        stream.append(PageMarker(page.pdf_page))
        line_h = _median_height(body) or 0.02
        # 常规行距基准：取「行距中位数」与「行高中位数」较小者，
        # 避免书名页/版权页等大间距页面污染基准导致整页并段
        line_gap = min(_median_line_gap(body), line_h)

        # ---- 页内段落合并 ----
        page_paras: list[Paragraph] = []
        cur_lines: list[TextBlock] = []
        cur_bottom: Optional[float] = None

        def flush() -> None:
            nonlocal cur_lines
            if not cur_lines:
                return
            para = _paragraph_from_lines(cur_lines, page)
            page_paras.append(para)
            cur_lines = []

        for b in body:
            if cur_lines and cur_bottom is not None:
                gap = _line_gap(cur_lines[-1], b)
                # 换段信号：行距明显拉大，或段首缩进（比行距更可靠）
                if gap > line_gap * 1.5 or _is_indented(b, body):
                    flush()
            cur_lines.append(b)
            cur_bottom = b.y1
        flush()

        # ---- 跨页续段：上一页末段未结束，且本页首行不像标题/新段 ----
        if prev_para is not None and prev_para.kind == PARA_BODY and page_paras:
            first = page_paras[0]
            first_block = _matching_block(first, body)
            if (
                not SENTENCE_END_RE.search(prev_para.text.rstrip())
                and first.kind == PARA_BODY
                and len(first.text) >= 6
                and len(first.text) <= 200
                and not (first_block and _is_indented(first_block, body))
            ):
                prev_para.text = _join_texts(prev_para.text, first.text)
                prev_para.add_page(page.pdf_page)
                page_paras = page_paras[1:]
        elif prev_para is not None and prev_para.kind == PARA_BODY and not page_paras:
            pass  # 本页只有脚注，正文段继续等待

        # ---- 标题识别 ----
        final_paras: list[Paragraph] = []
        for i, para in enumerate(page_paras):
            if para.kind == PARA_BODY and _is_single_line(para):
                # 用对应原始块的排版信息
                b = _matching_block(para, body)
                gap_after = _gap_after(b, body)
                level = _detect_heading(
                    para.text, _is_centered(b, page) if b else False,
                    is_page_first=(i == 0 and not final_paras),
                    gap_after=gap_after, line_h=line_h,
                )
                if level:
                    para.kind = PARA_HEADING
                    para.level = level
            final_paras.append(para)

        # ---- 脚注 ----
        for fg in footnote_groups:
            fp = Paragraph(text=_merge_lines(fg), kind=PARA_FOOTNOTE)
            fp.add_page(page.pdf_page)
            final_paras.append(fp)

        stream.extend(final_paras)
        if final_paras:
            # 记录本页最后一个「非脚注」段，供跨页续段使用
            prev_para = next(
                (p for p in reversed(final_paras) if p.kind != PARA_FOOTNOTE),
                prev_para,
            )
        else:
            prev_para = None

    return stream


def _paragraph_from_lines(lines: list[TextBlock], page: Page) -> Paragraph:
    text = _merge_lines(lines)
    p = Paragraph(text=text, kind=PARA_BODY)
    p.add_page(page.pdf_page)
    return p


def _is_single_line(para: Paragraph) -> bool:
    return len(para.text) <= HEADING_MAX_CHARS


def _matching_block(para: Paragraph, body: list[TextBlock]) -> Optional[TextBlock]:
    t = para.text
    for b in body:
        if b.clean() == t or t.startswith(b.clean()[:12]):
            return b
    return None


def _gap_after(b: Optional[TextBlock], body: list[TextBlock]) -> float:
    if b is None or b not in body:
        return 0.0
    idx = body.index(b)
    if idx + 1 >= len(body):
        return 0.0
    return _line_gap(b, body[idx + 1])


# ---------------------------------------------------------------------------
# Markdown 输出
# ---------------------------------------------------------------------------

def to_markdown(
    stream: list[Item],
    metadata: Optional[dict] = None,
    inline_pages: bool = False,
) -> str:
    out: list[str] = []
    if metadata:
        out.append("---")
        for k in ("title", "author", "publisher", "edition", "isbn"):
            v = metadata.get(k)
            if v:
                out.append(f"{k}: {v}")
        out.append("---")
        out.append("")

    for item in stream:
        if isinstance(item, PageMarker):
            out.append(f"\n<!-- ⏸ PDF 第 {item.pdf_page} 页 -->\n")
        else:
            p: Paragraph = item
            if inline_pages and p.kind == PARA_BODY:
                pages = "、".join(f"PDF第{x}页" for x in p.pdf_pages)
                p = Paragraph(text=p.text + f" 〔{pages}〕", kind=p.kind, level=p.level,
                              pdf_pages=p.pdf_pages)
            if p.kind == PARA_HEADING:
                prefix = "#" * p.level
                out.append(f"\n{prefix} {p.text}\n")
            elif p.kind == PARA_FOOTNOTE:
                out.append(f"\n> {p.text}\n")
            else:
                out.append(f"\n{p.text}\n")

    body = "\n".join(out)
    # 清理多余空行
    body = re.sub(r"\n{3,}", "\n\n", body)
    return body.strip() + "\n"
