import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pymupdf as fitz
from PIL import Image
from scan2ebook import cli


class PdfInspectionTest(unittest.TestCase):
    def inspect(self, path):
        output = io.StringIO()
        with redirect_stdout(output):
            code = cli._inspect_pdf([str(path)])
        return code, json.loads(output.getvalue())

    def test_reads_page_count_without_ocr_or_model_calls(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "fixture.pdf"
            with fitz.open() as doc:
                doc.new_page()
                doc.new_page()
                doc.save(path)
            code, value = self.inspect(path)
            self.assertEqual(code, 0)
            self.assertEqual(value["pages"], 2)

    def test_rejects_password_protected_pdf_before_conversion(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "encrypted.pdf"
            with fitz.open() as doc:
                doc.new_page()
                doc.save(path, encryption=fitz.PDF_ENCRYPT_AES_256,
                         owner_pw="test-owner", user_pw="test-document-password")
            code, value = self.inspect(path)
            self.assertNotEqual(code, 0)
            self.assertFalse(value["ok"])
            self.assertIn("密码", value["error"])


class OcrFailureTest(unittest.TestCase):
    def test_render_error_is_not_treated_as_a_blank_page(self):
        args = SimpleNamespace(lang="en-US", force_ocr=False, dpi=72, progress_json=True)
        with patch.object(cli, "has_text_layer", return_value=False), \
             patch.object(cli, "render_page", side_effect=RuntimeError("fixture render error")):
            with self.assertRaisesRegex(RuntimeError, "第 1 页"):
                cli._render_and_ocr([None], args, [0])

    def test_ocr_error_is_not_treated_as_a_blank_page(self):
        args = SimpleNamespace(lang="en-US", force_ocr=False, dpi=72, progress_json=True)
        with patch.object(cli, "has_text_layer", return_value=False), \
             patch.object(cli, "render_page", return_value=Image.new("RGB", (1, 1))), \
             patch.object(cli, "ocr_image", side_effect=RuntimeError("fixture OCR error")):
            with self.assertRaisesRegex(RuntimeError, "第 1 页"):
                cli._render_and_ocr([None], args, [0])
