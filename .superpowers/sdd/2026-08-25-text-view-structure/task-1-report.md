# Task 1 report: Normalize AI structural markers

## What changed

- Added `tests/test_vision_structure.py` covering header disposal, marker minimization, text preservation, and stable footnote-last ordering.
- Split the vision item schema into `TEXT_TYPES`, `MARKER_TYPES`, and `DISCARD_TYPES`; `_normalize_items` now emits minimal `figure`/`table` markers and discards `header` items before text validation.
- Extended `USER_PROMPT` with the `figure|table|header` format options and the required behavioral instructions. Removed the now-contradictory instruction to omit headers while retaining footer/page-number omission.
- Updated the README JSON schema and conventions for marker-only items and discarded headers.

## RED/GREEN evidence

- RED: `.venv/bin/python -m unittest tests/test_vision_structure.py -v` failed with the expected list mismatch: the pre-change normalizer omitted `figure` and `table`.
- GREEN: `.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v` passed (`1` test, `0` failures).
- GREEN: `npm test` from `frontend/` passed (`14` tests, `0` failures).
- `git diff --check` passed with no whitespace errors.

## Files

- `scan2ebook/vision.py`
- `tests/test_vision_structure.py`
- `README.md`

## Self-review

- Marker handling occurs before requiring `text`, so source descriptions/captions/rows cannot leak into output.
- Existing stable footnote-last sorting remains unchanged, preserving marker order relative to headings/body items.
- Unknown item types remain discarded; text-item normalization and footnote cleanup remain unchanged.
- No frontend, `web_reader.py`, or bookmark assets were modified.

## Concerns

- The frontend test command emits existing Node.js `legacy` build warnings; all tests still pass.
