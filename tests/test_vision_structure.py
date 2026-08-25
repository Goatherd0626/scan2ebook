import unittest

from scan2ebook.vision import _normalize_items


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


if __name__ == "__main__":
    unittest.main()
