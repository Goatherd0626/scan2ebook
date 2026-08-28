import unittest
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image

from scan2ebook.cli import _resolve_api_key, _resolve_page_indices
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
        vision.model = "test-vision"
        import threading
        vision._usage_lock = threading.Lock()
        vision._usage = {"requests": 0, "input_tokens": 0, "output_tokens": 0}

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
        self.assertEqual(vision.usage_snapshot()["requests"], 2)


class PageRangeTest(unittest.TestCase):
    def test_resolves_one_based_closed_interval(self):
        self.assertEqual(_resolve_page_indices(10, 3, 5), [2, 3, 4])
        self.assertEqual(_resolve_page_indices(3, None, None), [0, 1, 2])

    def test_rejects_invalid_range(self):
        for start, end in ((0, 2), (4, 3), (1, 11)):
            with self.subTest(start=start, end=end):
                with self.assertRaises(ValueError):
                    _resolve_page_indices(10, start, end)


class ApiKeyInputTest(unittest.TestCase):
    def test_prefers_ephemeral_child_process_environment(self):
        with patch.dict("os.environ", {"DEEPSEEK_API_KEY": "  temporary-key  "}, clear=True):
            with patch("scan2ebook.cli.getpass.getpass") as prompt:
                self.assertEqual(_resolve_api_key(), "temporary-key")
                prompt.assert_not_called()

    def test_prompts_without_echo_in_interactive_cli(self):
        with patch.dict("os.environ", {}, clear=True):
            with patch("scan2ebook.cli.sys.stdin.isatty", return_value=True):
                with patch("scan2ebook.cli.getpass.getpass", return_value=" entered-key "):
                    self.assertEqual(_resolve_api_key(), "entered-key")

    def test_noninteractive_cli_does_not_wait_for_input(self):
        with patch.dict("os.environ", {}, clear=True):
            with patch("scan2ebook.cli.sys.stdin.isatty", return_value=False):
                with patch("scan2ebook.cli.getpass.getpass") as prompt:
                    self.assertEqual(_resolve_api_key(), "")
                    prompt.assert_not_called()


class PageNumberMappingTest(unittest.TestCase):
    def test_preserves_original_pdf_page_numbers_for_subset(self):
        vision = VisionStructure.__new__(VisionStructure)
        vision._usage_lock = __import__("threading").Lock()
        vision._usage = {"requests": 0, "input_tokens": 0, "output_tokens": 0}
        result = vision.structure_book(
            [None, None], ["", ""], blank_indices={0, 1},
            page_numbers=[7, 8], show_progress=False,
        )
        self.assertEqual([page["pdf_page"] for page in result], [7, 8])


if __name__ == "__main__":
    unittest.main()
