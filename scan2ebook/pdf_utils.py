"""PDF 处理：探测文字层、逐页高清渲染。"""
from __future__ import annotations

import io
from typing import Optional

import pymupdf as fitz  # PyMuPDF
from PIL import Image


def open_pdf(path: str) -> fitz.Document:
    return fitz.open(path)


def has_text_layer(doc: fitz.Document, sample_pages: int = 5) -> bool:
    """探测 PDF 是否自带文字层（原生电子书）。"""
    total = 0
    for i in range(min(sample_pages, len(doc))):
        total += len(doc[i].get_text().strip())
    return total > 50


def extract_text_layer(doc: fitz.Document) -> list[str]:
    """若 PDF 自带文字层，直接逐页取文字（保留页码锚定）。"""
    return [page.get_text() for page in doc]


def render_page(doc: fitz.Document, index: int, dpi: int = 300) -> Image.Image:
    """把第 index 页渲染成 PIL 图像（模拟扫描件视图，供 OCR 使用）。"""
    page = doc[index]
    pix = page.get_pixmap(dpi=dpi)
    img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
    return img


def render_all(doc: fitz.Document, dpi: int = 300) -> list[Image.Image]:
    return [render_page(doc, i, dpi) for i in range(len(doc))]


def page_count(doc: fitz.Document) -> int:
    return len(doc)
