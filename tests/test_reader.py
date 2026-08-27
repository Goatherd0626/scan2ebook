import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scan2ebook import reader


class ReaderWebDirectoryTest(unittest.TestCase):
    def test_uses_built_reader(self):
        with tempfile.TemporaryDirectory() as directory:
            reader_root = Path(directory)
            dist = reader_root / "dist"
            dist.mkdir()
            (dist / "index.html").write_text("<!doctype html>", encoding="utf-8")

            with patch.object(reader, "READER", reader_root):
                self.assertEqual(reader._web_dir(), dist)

    def test_rejects_unbuilt_vite_source(self):
        with tempfile.TemporaryDirectory() as directory:
            reader_root = Path(directory)
            (reader_root / "index.html").write_text("<!doctype html>", encoding="utf-8")

            with patch.object(reader, "READER", reader_root):
                with self.assertRaisesRegex(FileNotFoundError, "npm ci && npm run build"):
                    reader._web_dir()


if __name__ == "__main__":
    unittest.main()
