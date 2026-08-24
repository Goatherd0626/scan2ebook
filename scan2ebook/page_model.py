"""核心数据结构：OCR 文本块与页面。"""
from __future__ import annotations

from dataclasses import dataclass, field

# 块类型（当前仅用 body；其余由 ds-vision 结构化层处理）
KIND_BODY = "body"


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
