"""ds-vision 逐页结构化：图像 + OCR 文本 → 有序 items（heading/body/footnote）。

思路：Apple Vision 负责逐字转录（本地免费），DeepSeek V4 Flash Vision Exp
同时接收「页面图像 + OCR 文本」，判断每块内容的性质（标题/正文/脚注）、
标题层级与编号、正文中脚注引用标记的位置，并顺手修正 OCR 错字。

每页输出（用户约定的存储格式，键为英文）：
{
  "pdf_page": 3,
  "items": [
    {"type": "heading", "level": 1, "number": "第一章", "text": "第一章 导论"},
    {"type": "body",    "text": "……市场格局[1]？……"},
    {"type": "footnote","index": 1, "text": "参见吴承明……"}
  ]
}
"""
from __future__ import annotations

import base64
import io
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

from openai import OpenAI
from PIL import Image
from tqdm import tqdm

from .config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_VISION_MODEL

log = logging.getLogger(__name__)

VALID_TYPES = {"heading", "body", "footnote"}
VALID_KINDS = {"cover", "title", "copyright", "toc", "body", "blank", "other"}

# 注意：完整指令放在 user 消息里（放 system 消息模型容易无视），并显式要求只输出 JSON。
USER_PROMPT = """把这一页扫描书籍整理成结构化 JSON。必须只输出一个 JSON 对象，禁止输出任何其他文字或 Markdown。
格式：{"page_kind":"cover|title|copyright|toc|body|blank|other","items":[{"type":"heading|body|footnote","level":1或2或3(仅heading),"number":"标题印刷编号如 1.1.1 / 第一章(仅heading)","index":脚注序号(仅footnote),"text":"内容"}],"toc":[{"number":"编号","text":"标题文字","level":1或2或3,"printed_page":目录标注页码(数字,无则0)}]}
步骤：
1. 先判断本页类型 page_kind：cover=封面，title=书名页，copyright=版权页，toc=目录页，body=正文页，blank=空白页，other=其他。
2. 若是 toc：提取 "toc" 数组（每行一条，含目录标注的页码 printed_page），items 输出空数组。
3. 若是 cover / copyright / blank：items 输出空数组。
4. 若是 body / title / other：按下列规则输出 items：
- 正文按自然段拆分，每个自然段为一个 body 项；标题用 heading 并给出 level 与 number；脚注用 footnote。
- items 的数量与顺序由本页实际内容决定，按阅读顺序排列；脚注项统一放在 items 的最后。
- 正文中的脚注引用标记（①、1、* 等）原地改写为 [序号]，例如：市场格局[1]。
- 页眉、页脚、页码一律不要输出。
- 一段文字若跨页，text 写到此页末尾即可，不要自行续写。
- 脚注 text 以内容开头，不要包含脚注标记本身。
OCR 文本仅供参考（以图像为准）：
__OCR__"""

RETRY_PROMPT = """上次的输出不是 JSON。请重新整理这一页扫描书籍，只输出一个 JSON 对象（格式同前：{"page_kind":"...","items":[...],"toc":[...]}），不要再输出任何解释或 Markdown。
OCR 文本仅供参考（以图像为准）：
__OCR__"""

_MARKER_RE = re.compile(r"\[\s*(\d+)\s*\]")
_LEADING_FN_MARK_RE = re.compile(r"^\s*(?:[①②③④⑤⑥⑦⑧⑨⑩]|\d{1,2}[\.、．]?|\*{1,3}|[†‡§])\s*")


def _image_data_url(img: Image.Image, max_width: int = 1024) -> str:
    if img.width > max_width:
        h = int(img.height * max_width / img.width)
        img = img.resize((max_width, h))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _extract_json(raw: str) -> Optional[dict]:
    """从模型输出中提取 JSON（容忍代码围栏与前后杂质）。"""
    raw = raw.strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", raw, re.S)
    if m:
        raw = m.group(1).strip()
    start = raw.find("{")
    if start < 0:
        return None
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(raw)):
        ch = raw[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(raw[start:i + 1])
                except json.JSONDecodeError:
                    return None
    return None


def _normalize_items(items: list) -> list[dict]:
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        t = str(it.get("type", "")).strip().lower()
        if t not in VALID_TYPES:
            continue
        text = str(it.get("text", "")).strip()
        if not text:
            continue
        item = {"type": t, "text": text}
        if t == "heading":
            item["level"] = max(1, min(3, int(it.get("level") or 2)))
            item["number"] = str(it.get("number") or "").strip()
            # 清理模型包裹标题的括号噪音：〔前言〕/【1.1】/（引言）等
            item["text"] = re.sub(r"^[〔【（(]+|[〕】）)]+$", "", text).strip()
        elif t == "footnote":
            item["index"] = int(it.get("index") or 1)
            item["text"] = _LEADING_FN_MARK_RE.sub("", text).strip()
        item["text"] = _MARKER_RE.sub(lambda m: f"[{int(m.group(1))}]", item["text"])
        out.append(item)
    # 脚注统一放在 items 最后（稳定排序，组内保持原顺序）
    out.sort(key=lambda x: x["type"] == "footnote")
    return out


def _normalize_toc(toc: list) -> list[dict]:
    out = []
    for it in toc:
        if not isinstance(it, dict):
            continue
        text = str(it.get("text", "")).strip()
        if not text:
            continue
        num = str(it.get("number") or "").strip()
        lvl = max(1, min(3, int(it.get("level") or 2)))
        pp = str(it.get("printed_page") or "").strip()
        try:
            pp = int(float(pp))
        except ValueError:
            pp = 0
        text = re.sub(r"^[〔【（(]+|[〕】）)]+$", "", text).strip()
        out.append({"number": num, "text": text, "level": lvl, "printed_page": pp})
    return out


class VisionStructure:
    """ds-vision 逐页结构化客户端。"""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or DEEPSEEK_API_KEY
        self.enabled = bool(self.api_key)
        self._client = OpenAI(api_key=self.api_key, base_url=DEEPSEEK_BASE_URL) if self.enabled else None

    # ------------------------------------------------------------------
    def structure_page(self, img: Image.Image, ocr_text: str) -> dict:
        """单页：返回 {"page_kind", "items", "toc"}。失败时按空白页处理。"""
        ocr = ocr_text[:4000]
        content = [
            {"type": "text", "text": USER_PROMPT.replace("__OCR__", ocr)},
            {"type": "image_url", "image_url": {"url": _image_data_url(img)}},
        ]
        for attempt in range(2):
            try:
                resp = self._client.chat.completions.create(
                    model=DEEPSEEK_VISION_MODEL,
                    temperature=0,
                    messages=[{"role": "user", "content": content}],
                )
                data = _extract_json(resp.choices[0].message.content or "")
                if data:
                    return self._finalize(data)
                if attempt == 0:  # 解析失败：用更强硬的提示重试一次
                    content = [
                        {"type": "text", "text": RETRY_PROMPT.replace("__OCR__", ocr)},
                        {"type": "image_url", "image_url": {"url": _image_data_url(img)}},
                    ]
            except Exception as e:  # noqa: BLE001
                log.warning("ds-vision 第 %d 页失败：%s", getattr(img, "pdf_page", "?"), e)
                break
        return {"page_kind": "blank", "items": [], "toc": []}

    @staticmethod
    def _finalize(data: dict) -> dict:
        kind = str(data.get("page_kind", "body")).strip().lower()
        if kind not in VALID_KINDS:
            kind = "body"
        result = {
            "page_kind": kind,
            "items": _normalize_items(data.get("items", [])),
        }
        if kind == "toc":
            result["toc"] = _normalize_toc(data.get("toc", []))
        else:
            result["toc"] = []
        return result

    # ------------------------------------------------------------------
    def structure_book(self, imgs: list[Image.Image], ocr_texts: list[str],
                       workers: int = 6, blank_indices: Optional[set] = None,
                       force_kind: Optional[dict] = None) -> list[dict]:
        """整书逐页结构化（并发）。blank_indices 里的页直接按空白页跳过（省 API 调用）。

        force_kind: {页码: kind} 用于外部规则强制指定某些页的类型。
        返回 [{pdf_page, page_kind, items, toc}, ...]
        """
        blank = blank_indices or set()
        force = force_kind or {}
        results: list[Optional[dict]] = [None] * len(imgs)

        def work(i: int):
            page = force.get(i + 1)
            if page or (i in blank):
                kind = page if page else "blank"
                return i, {"pdf_page": i + 1, "page_kind": kind, "items": [], "toc": []}
            r = self.structure_page(imgs[i], ocr_texts[i])
            r["pdf_page"] = i + 1
            return i, r

        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = [ex.submit(work, i) for i in range(len(imgs))]
            for fut in tqdm(as_completed(futs), total=len(futs), desc="ds-vision 版面结构化"):
                i, page = fut.result()
                results[i] = page
        return [r for r in results if r is not None]
