"""DeepSeek API（可选）：元数据提取、标题层级精修、OCR 文本纠错。"""
from __future__ import annotations

import json
import logging
from typing import Optional

from openai import OpenAI

from .config import DEEPSEEK_BASE_URL, DEEPSEEK_CHAT_MODEL

log = logging.getLogger(__name__)


class DeepSeekClient:
    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self.api_key = (api_key or "").strip()
        self.model = model or DEEPSEEK_CHAT_MODEL
        self.enabled = bool(self.api_key)
        self._client: Optional[OpenAI] = None
        if self.enabled:
            self._client = OpenAI(api_key=self.api_key, base_url=DEEPSEEK_BASE_URL)

    # ------------------------------------------------------------------
    def _chat_json(self, system: str, user: str, temperature: float = 0.0) -> Optional[dict]:
        if not self.enabled:
            return None
        try:
            resp = self._client.chat.completions.create(
                model=self.model,
                temperature=temperature,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            )
            return json.loads(resp.choices[0].message.content or "{}")
        except Exception as e:  # noqa: BLE001
            log.warning("DeepSeek 调用失败：%s", e)
            return None

    # ------------------------------------------------------------------
    def extract_metadata(self, first_pages_text: str) -> dict:
        """从书名页/版权页 OCR 文本提取书籍元数据。"""
        system = (
            "你是文献著录助手。根据给定的书页 OCR 文本（可能有识别错误），"
            "提取书籍元数据，只输出 JSON："
            '{"title": 书名, "author": 作者, "publisher": 出版社, "edition": 版次, "isbn": ISBN}'
            "。不确定的字段填空字符串。"
        )
        data = self._chat_json(system, f"书页 OCR 文本：\n{first_pages_text[:4000]}")
        if not data:
            return {}
        allowed = {"title", "author", "publisher", "edition", "isbn"}
        return {k: str(v).strip() for k, v in data.items() if k in allowed and str(v).strip()}

    # ------------------------------------------------------------------
    def refine_headings(self, candidates: list[dict]) -> dict[int, tuple[int, str]]:
        """对候选标题行做精修：判定是否为标题及层级，并修正 OCR 错字。

        candidates: [{"index": i, "page": 12, "text": "..."}]
        返回 {index: (level, corrected_text)}，只含判定为标题的项。
        """
        if not candidates:
            return {}
        system = (
            "你是中文书籍版式分析助手。下面给出若干候选标题行（可能含OCR识别错误），"
            "请判断每行是否为章节标题，若是则给出层级与修正后的文字。"
            "只输出 JSON：{\"results\": [{\"index\": 行号, \"is_heading\": true/false, "
            "\"level\": 1或2或3, \"corrected_text\": \"修正后的标题文字\"}]}。"
            "一级标题如「第一章 导论」，二级如「一、研究缘起」，三级如「1.1 背景」。"
        )
        payload = [{"index": c["index"], "text": c["text"][:80]} for c in candidates]
        data = self._chat_json(system, json.dumps(payload, ensure_ascii=False))
        if not data:
            return {}
        out: dict[int, tuple[int, str]] = {}
        for r in data.get("results", []):
            if r.get("is_heading"):
                idx = int(r["index"])
                lvl = int(r.get("level", 2))
                txt = str(r.get("corrected_text", "")).strip()
                if txt:
                    out[idx] = (max(1, min(3, lvl)), txt)
        return out
