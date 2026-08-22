"""核心数据结构：文本块、页面、段落、书。"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

# 块类型
KIND_HEADER = "header"        # 页眉（书眉/章节名）
KIND_FOOTER = "footer"        # 页脚（除页码外的页脚文字，一般丢弃）
KIND_PAGE_NUM = "page_number" # 页脚中的页码
KIND_FOOTNOTE = "footnote"    # 脚注
KIND_BODY = "body"            # 正文
KIND_BLANK = "blank"          # 空块

# 段落类型
PARA_HEADING = "heading"
PARA_BODY = "body"
PARA_FOOTNOTE = "footnote"


@dataclass
class TextBlock:
    """OCR 出的一个文本块。bbox 为归一化坐标 (x0, y0, x1, y1)，原点左上。"""

    text: str
    bbox: tuple[float, float, float, float]
    confidence: float = 0.0
    kind: str = KIND_BODY

    @property
    def x0(self) -> float:
        return self.bbox[0]

    @property
    def y0(self) -> float:
        return self.bbox[1]

    @property
    def x1(self) -> float:
        return self.bbox[2]

    @property
    def y1(self) -> float:
        return self.bbox[3]

    @property
    def cx(self) -> float:
        return (self.bbox[0] + self.bbox[2]) / 2.0

    @property
    def cy(self) -> float:
        return (self.bbox[1] + self.bbox[3]) / 2.0

    @property
    def height(self) -> float:
        return self.bbox[3] - self.bbox[1]

    def clean(self) -> str:
        """去除多余空白，保留内部单空格。"""
        lines = [ln.strip() for ln in self.text.splitlines()]
        return " ".join(ln for ln in lines if ln)


@dataclass
class Page:
    """一页 PDF 的 OCR 结果。"""

    pdf_page: int  # 1 起
    width: int
    height: int
    blocks: list[TextBlock] = field(default_factory=list)
    printed_page: Optional[str] = None  # 书页号（可能带 i/ii 等罗马数字前缀页）

    def body_blocks(self) -> list[TextBlock]:
        return [b for b in self.blocks if b.kind == KIND_BODY]

    def footnote_blocks(self) -> list[TextBlock]:
        return [b for b in self.blocks if b.kind == KIND_FOOTNOTE]


@dataclass
class Paragraph:
    """组装后的段落/标题/脚注。pdf_pages 记录其内容来源的 PDF 页（可能跨页）。"""

    text: str
    kind: str = PARA_BODY
    level: int = 0            # 标题层级 1/2/3
    pdf_pages: list[int] = field(default_factory=list)
    printed_pages: list[str] = field(default_factory=list)

    def add_page(self, pdf_page: int, printed: Optional[str]) -> None:
        if pdf_page not in self.pdf_pages:
            self.pdf_pages.append(pdf_page)
        if printed and printed not in self.printed_pages:
            self.printed_pages.append(printed)


@dataclass
class Book:
    """整本书。"""

    pages: list[Page] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)
    source_path: str = ""

    @property
    def page_mapping(self) -> dict[int, Optional[str]]:
        """pdf_page -> printed_page"""
        return {p.pdf_page: p.printed_page for p in self.pages}
