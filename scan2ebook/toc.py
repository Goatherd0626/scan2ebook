"""目录装配：把目录页提取的 TOC 条目与正文识别的标题一一对应，得到可跳转的书级目录。

匹配方式（纯文本，不需要书页号映射）：
- 归一化后按文本相似度（difflib）模糊匹配 TOC 条目 ↔ 正文 heading
- 若两者的编号（number）一致，额外加权
- 每条 TOC 条目匹配到唯一 heading，取其所在 PDF 页作为跳转目标
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher

# 正文页类型：参与标题匹配与正文渲染
BODY_KINDS = {"body", "title", "other"}

_NORM_RE = re.compile(r"[\s·．.\-–—:：,，;；、()（）\[\]「」『』《》<>]+")


def _norm(s) -> str:
    return _NORM_RE.sub("", str(s or "")).lower()


def collect_toc_entries(pages: list[dict]) -> list[dict]:
    """汇总所有目录页的 TOC 条目。"""
    out = []
    for pg in pages:
        for e in pg.get("toc", []) or []:
            out.append({**e, "toc_page": pg["pdf_page"]})
    return out


def collect_headings(pages: list[dict]) -> list[dict]:
    """汇总正文页中的标题。"""
    out = []
    for pg in pages:
        if pg.get("page_kind") not in BODY_KINDS:
            continue
        for it in pg["items"]:
            if it["type"] == "heading":
                out.append({**it, "pdf_page": pg["pdf_page"]})
    return out


def build_book_toc(pages: list[dict], min_ratio: float = 0.55) -> list[dict]:
    """匹配目录条目与正文标题，输出书级 toc（含跳转目标 pdf_page）。"""
    entries = collect_toc_entries(pages)
    headings = collect_headings(pages)
    if not entries:
        return []
    if not headings:
        return [dict(e, pdf_page=None, matched_text=None) for e in entries]

    used: set[int] = set()
    result: list[dict] = []
    for e in entries:
        en, enum = _norm(e["text"]), _norm(e["number"])
        best_idx, best_score = -1, 0.0
        for idx, h in enumerate(headings):
            if idx in used:
                continue
            score = SequenceMatcher(None, en, _norm(h["text"])).ratio()
            if enum and _norm(h["number"]) == enum:
                score += 0.3
            if score > best_score:
                best_idx, best_score = idx, score
        if best_idx >= 0 and best_score >= min_ratio:
            used.add(best_idx)
            h = headings[best_idx]
            result.append(dict(e, pdf_page=h["pdf_page"], matched_text=h["text"]))
        else:
            result.append(dict(e, pdf_page=None, matched_text=None))

    # 已匹配的按正文顺序，未匹配的放最后
    result.sort(key=lambda x: (x["pdf_page"] is None, x["pdf_page"] or 10**9))
    return result
