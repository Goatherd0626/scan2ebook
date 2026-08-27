import io
import os
import unittest
from contextlib import redirect_stderr
from unittest.mock import Mock, patch

from scan2ebook import cli, reader


class ReaderCommandTest(unittest.TestCase):
    def test_builds_reader_cli_arguments_without_shell(self):
        with patch.object(reader.shutil, "which", return_value="/opt/bin/scan2ebook-reader"):
            args = reader.reader_argv(host="127.0.0.1", port=9000, open_browser=False)

        self.assertEqual(
            args,
            ["/opt/bin/scan2ebook-reader", "--host", "127.0.0.1", "--port", "9000", "--no-open"],
        )

    def test_explicit_command_precedes_environment(self):
        with patch.dict(os.environ, {reader.READER_COMMAND_ENV: "/env/reader"}):
            with patch.object(reader.shutil, "which", side_effect=lambda value: f"resolved:{value}"):
                self.assertEqual(reader.resolve_reader_command("/explicit/reader"), "resolved:/explicit/reader")

    def test_missing_reader_has_actionable_install_hint(self):
        stderr = io.StringIO()
        with patch.object(reader.shutil, "which", return_value=None), redirect_stderr(stderr):
            result = reader.main(["--no-browser"])

        self.assertEqual(result, 1)
        self.assertIn("npm install --global scan2ebook-reader", stderr.getvalue())
        self.assertNotIn(os.getcwd(), stderr.getvalue())

    def test_serve_forwards_exit_code_and_legacy_no_browser_flag(self):
        completed = Mock(returncode=7)
        with patch.object(reader.shutil, "which", return_value="/opt/bin/scan2ebook-reader"):
            with patch.object(reader.subprocess, "run", return_value=completed) as run:
                result = reader.main(["--host", "localhost", "--port", "9100", "--no-browser"])

        self.assertEqual(result, 7)
        run.assert_called_once_with(
            ["/opt/bin/scan2ebook-reader", "--host", "localhost", "--port", "9100", "--no-open"],
            check=False,
        )

    def test_conversion_serve_starts_reader_detached(self):
        process = Mock()
        with patch.object(reader.shutil, "which", return_value="/opt/bin/scan2ebook-reader"):
            with patch.object(reader.subprocess, "Popen", return_value=process) as popen:
                returned = reader.start_reader_detached(port=9200)

        self.assertIs(returned, process)
        popen.assert_called_once()
        self.assertEqual(
            popen.call_args.args[0],
            ["/opt/bin/scan2ebook-reader", "--host", "127.0.0.1", "--port", "9200"],
        )
        self.assertTrue(popen.call_args.kwargs["start_new_session"])

    def test_missing_reader_does_not_invalidate_completed_conversion(self):
        with patch.object(reader.shutil, "which", return_value=None):
            with self.assertLogs("scan2ebook", level="WARNING") as logs:
                cli._launch_reader()

        self.assertIn("转换已完成，但无法启动网页阅读器", "\n".join(logs.output))


if __name__ == "__main__":
    unittest.main()
