import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scan2ebook import reader


class ReaderWebDirectoryTest(unittest.TestCase):
    def test_uses_built_frontend(self):
        with tempfile.TemporaryDirectory() as directory:
            frontend = Path(directory)
            dist = frontend / "dist"
            dist.mkdir()
            (dist / "index.html").write_text("<!doctype html>", encoding="utf-8")

            with patch.object(reader, "FRONTEND", frontend):
                self.assertEqual(reader._web_dir(), dist)

    def test_rejects_unbuilt_vite_source(self):
        with tempfile.TemporaryDirectory() as directory:
            frontend = Path(directory)
            (frontend / "index.html").write_text("<!doctype html>", encoding="utf-8")

            with patch.object(reader, "FRONTEND", frontend):
                with self.assertRaisesRegex(FileNotFoundError, "npm ci && npm run build"):
                    reader._web_dir()


if __name__ == "__main__":
    unittest.main()
