"""OCR 引擎：Apple Vision（macOS 自带，免费离线，支持中英混排/竖排）。

注意：当前安装的 ocrmac 版本（recognize 返回 [(text, confidence, bbox)]，
bbox 为归一化 [x, y, w, h]，原点在左下——Vision 原生坐标），
这里统一转换为归一化 (x0, y0, x1, y1)，原点左上，供版面分析使用。
"""
from __future__ import annotations

import logging
from typing import Optional

from ocrmac import ocrmac
from PIL import Image

from .config import OCR_LANGUAGES
from .page_model import TextBlock

log = logging.getLogger(__name__)


def _to_blocks(annotations) -> list[TextBlock]:
    blocks = []
    for text, conf, bbox in annotations:
        t = (text or "").strip()
        if not t:
            continue
        x, y, w, h = bbox
        y_top = 1.0 - (y + h)  # 左下原点 -> 左上原点
        blocks.append(
            TextBlock(
                text=t,
                bbox=(x, y_top, x + w, y_top + h),
                confidence=float(conf),
            )
        )
    return blocks


def ocr_image(img: Image.Image, languages: Optional[list[str]] = None) -> list[TextBlock]:
    """对一张 PIL 图像做 OCR，返回文本块列表（按识别顺序）。"""
    langs = languages or OCR_LANGUAGES
    ocr = ocrmac.OCR(
        img,
        language_preference=langs,
        recognition_level="accurate",
    )
    annotations = ocr.recognize()
    return _to_blocks(annotations)
