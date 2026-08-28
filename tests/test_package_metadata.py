import tomllib
import unittest
from pathlib import Path

import scan2ebook


ROOT = Path(__file__).resolve().parent.parent


class PackageMetadataTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.metadata = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))

    def test_version_and_console_script_are_stable(self):
        project = self.metadata["project"]
        self.assertEqual(project["version"], scan2ebook.__version__)
        self.assertEqual(project["version"], "0.1.0")
        self.assertEqual(project["scripts"]["scan2ebook"], "scan2ebook.cli:main")

    def test_publishing_metadata_declares_platform_and_license(self):
        project = self.metadata["project"]
        self.assertEqual(project["license"], "MIT")
        self.assertIn("LICENSE", project["license-files"])
        self.assertIn("Operating System :: MacOS", project["classifiers"])
        self.assertEqual(project["requires-python"], ">=3.10")

    def test_runtime_dependencies_have_minimum_versions(self):
        dependencies = self.metadata["project"]["dependencies"]
        self.assertTrue(dependencies)
        self.assertTrue(all(">=" in dependency for dependency in dependencies))

    def test_reader_is_an_external_runtime_not_a_python_dependency(self):
        dependencies = "\n".join(self.metadata["project"]["dependencies"])
        self.assertNotIn("scan2ebook-reader", dependencies)
        source = (ROOT / "scan2ebook" / "reader.py").read_text(encoding="utf-8")
        self.assertIn("scan2ebook-reader", source)
        self.assertNotIn("reader/dist", source)

    def test_api_key_does_not_require_dotenv(self):
        dependencies = "\n".join(self.metadata["project"]["dependencies"])
        self.assertNotIn("dotenv", dependencies.lower())
        self.assertFalse((ROOT / ".env.example").exists())


if __name__ == "__main__":
    unittest.main()
