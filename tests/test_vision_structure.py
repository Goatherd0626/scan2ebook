import unittest
from types import SimpleNamespace

from PIL import Image

from scan2ebook.vision import VisionStructure, _normalize_items


class NormalizeItemsTest(unittest.TestCase):
    def test_discards_headers_and_minimizes_source_markers(self):
        raw = [
            {"type": "header", "text": "第一章 导论"},
            {"type": "figure", "text": "模型不应保留的描述", "caption": "图一"},
            {"type": "body", "text": "第一段正文。"},
            {"type": "footnote", "index": 2, "text": "②脚注内容"},
            {"type": "table", "text": "模型不应转录的表格", "rows": [["A"]]},
        ]

        self.assertEqual(
            _normalize_items(raw),
            [
                {"type": "figure"},
                {"type": "body", "text": "第一段正文。"},
                {"type": "table"},
                {"type": "footnote", "text": "脚注内容", "index": 2},
            ],
        )


class VisionRetryContractTest(unittest.TestCase):
    def test_retry_request_repeats_complete_structure_contract(self):
        requests = []
        responses = iter([
            "not json",
            '{"page_kind":"blank","items":[],"toc":[]}',
        ])

        def create(**kwargs):
            requests.append(kwargs)
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content=next(responses)))]
            )

        client = SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=create))
        )
        vision = VisionStructure.__new__(VisionStructure)
        vision._client = client

        result = vision.structure_page(Image.new("RGB", (1, 1)), "OCR sample")

        self.assertEqual(result, {"page_kind": "blank", "items": [], "toc": []})
        self.assertEqual(len(requests), 2)
        retry_text = requests[1]["messages"][0]["content"][0]["text"]
        for item_type in ("heading", "body", "footnote", "figure", "table", "header"):
            self.assertIn(item_type, retry_text)
        self.assertIn('{"type":"figure"}', retry_text)
        self.assertIn('{"type":"table"}', retry_text)
        self.assertIn("figure/table 禁止包含任何其他键", retry_text)
        self.assertIn("header 仅供程序识别并丢弃", retry_text)
        self.assertIn("页脚和页码仍直接忽略", retry_text)


if __name__ == "__main__":
    unittest.main()
