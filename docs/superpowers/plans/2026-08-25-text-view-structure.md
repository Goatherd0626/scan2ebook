# Text View Structure Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the AI-to-ebook pipeline with disposable headers and position-preserving figure/table markers, then render clickable source placeholders that reveal the corresponding PDF page.

**Architecture:** The Python vision normalizer remains the final authority for persisted item shape: `header` is accepted from the model but discarded, while `figure` and `table` are reduced to `{type}`. The full Vite reader renders those markers through a `TextView` hook; the app shell owns mode switching and PDF navigation because only it has access to per-book preferences and `PdfView`.

**Tech Stack:** Python 3 standard `unittest`, DeepSeek/OpenAI-compatible vision API, vanilla JavaScript ES modules, jsdom, Node test runner, Vite.

**Spec:** `docs/superpowers/specs/2026-08-25-text-view-structure-design.md`

## Global Constraints

- Final persisted marker items are exactly `{"type":"figure"}` or `{"type":"table"}` with no additional keys.
- `header` is an internal model-output type and never enters final book JSON.
- Do not add repeated-header detection or OCR bbox analysis.
- Do not change the existing cross-page `_continued` heuristic.
- Do not transcribe image or table contents.
- Preserve PDF page anchoring through the parent page's `pdf_page`.
- Old `.s2e` books must continue to render.
- Do not modify `scan2ebook/web_reader.py`; the lightweight standalone HTML has no PDF pane to reveal.
- Preserve the untracked `reader/src/assets/icons/bookmark.svg` and `bookmark.fill.svg`; do not stage them in these commits.

---

### Task 1: Normalize AI structural markers

**Files:**
- Create: `tests/test_vision_structure.py`
- Modify: `scan2ebook/vision.py:28-145`
- Modify: `README.md:103-132`

**Interfaces:**
- Consumes: raw model item objects passed to `_normalize_items(items: list) -> list[dict]`.
- Produces: final ordered items containing text-bearing `heading/body/footnote` objects and minimal `figure/table` marker objects; no `header` objects.

- [ ] **Step 1: Write the failing Python normalization test**

```python
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
```

- [ ] **Step 2: Run the test and verify the current normalizer rejects the new types**

Run:

```bash
.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
```

Expected: FAIL because current `_normalize_items` omits `figure` and `table`.

- [ ] **Step 3: Extend the prompt and normalization contract**

In `scan2ebook/vision.py`, separate persisted text types, persisted markers, and disposable model types:

```python
TEXT_TYPES = {"heading", "body", "footnote"}
MARKER_TYPES = {"figure", "table"}
DISCARD_TYPES = {"header"}
VALID_TYPES = TEXT_TYPES | MARKER_TYPES
```

At the beginning of `_normalize_items`, handle the non-text types before requiring `text`:

```python
t = str(it.get("type", "")).strip().lower()
if t in DISCARD_TYPES:
    continue
if t in MARKER_TYPES:
    out.append({"type": t})
    continue
if t not in TEXT_TYPES:
    continue
text = str(it.get("text", "")).strip()
if not text:
    continue
```

Keep the existing stable footnote-last sort so marker ordering is unchanged relative to headings and body paragraphs.

Update `USER_PROMPT` so the format permits `heading|body|footnote|figure|table|header`, and add these exact behavioral instructions:

```text
- 页面顶部重复出现的书名、章名或作者名属于 header，不是 heading；页眉即使加粗或字号较大也输出 header。
- 照片、插图、图表、地图等在原阅读位置输出 {"type":"figure"}。
- 表格在原阅读位置输出 {"type":"table"}。
- figure/table 禁止包含任何其他键，不描述图片内容，不转录表格内容。
- header 仅供程序识别并丢弃；页脚和页码仍直接忽略。
```

Update README's JSON schema example and conventions to list `figure/table` as marker-only item types and explain that headers are discarded.

- [ ] **Step 4: Run the Python test and existing frontend suite**

Run:

```bash
.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
cd reader && npm test
```

Expected: Python test PASS; existing frontend tests PASS.

- [ ] **Step 5: Commit the schema extension**

```bash
git add scan2ebook/vision.py tests/test_vision_structure.py README.md
git commit -m "feat: 扩展图片表格与页眉识别类型"
```

---

### Task 2: Render accessible source placeholders

**Files:**
- Create: `reader/test/source-objects.test.mjs`
- Modify: `reader/src/core/views.js:143-236`
- Modify: `reader/src/style.css:486-545`

**Interfaces:**
- Consumes: model items `{type: "figure"}` and `{type: "table"}` nested under a page with `pdf_page`.
- Produces: `TextView` hook `onSourceObject({ type: "figure" | "table", page: number })` invoked by an accessible placeholder button.

- [ ] **Step 1: Write the failing TextView placeholder test**

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<div class="text-panel"><div class="text-content"></div></div>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.IntersectionObserver = class { observe() {} disconnect() {} };
dom.window.HTMLElement.prototype.scrollTo = function () {};
dom.window.HTMLElement.prototype.scrollIntoView = function () {};

const { TextView } = await import('../src/core/views.js');

test('figure and table render in source order and emit their parent PDF page', () => {
  const events = [];
  const panel = document.querySelector('.text-panel');
  const view = new TextView(panel, { onSourceObject: (event) => events.push(event) });
  view.load({
    pages: [{
      pdf_page: 7,
      items: [
        { type: 'body', text: '图前正文。' },
        { type: 'figure' },
        { type: 'body', text: '表前正文。' },
        { type: 'table' },
      ],
    }],
    footnotes: [null],
    toc: [],
  }, { title: '测试书' });

  const placeholders = [...panel.querySelectorAll('button.source-object')];
  assert.deepEqual(placeholders.map((el) => el.dataset.type), ['figure', 'table']);
  assert.deepEqual(placeholders.map((el) => el.dataset.page), ['7', '7']);
  assert.match(placeholders[0].textContent, /原文有图片/);
  assert.match(placeholders[1].textContent, /原文有表格/);

  placeholders[0].click();
  placeholders[1].click();
  assert.deepEqual(events, [
    { type: 'figure', page: 7 },
    { type: 'table', page: 7 },
  ]);
});
```

- [ ] **Step 2: Run the test and verify no placeholders exist**

Run:

```bash
cd reader && node --test test/source-objects.test.mjs
```

Expected: FAIL because `TextView.load()` currently ignores marker items.

- [ ] **Step 3: Add marker rendering to TextView**

In the per-item branch in `TextView.load`, add:

```javascript
} else if (it.type === 'figure' || it.type === 'table') {
  const label = it.type === 'figure'
    ? '此处原文有图片 · 点击查看 PDF'
    : '此处原文有表格 · 点击查看 PDF';
  const marker = el('button', 'source-object ' + it.type, label);
  marker.type = 'button';
  marker.dataset.type = it.type;
  marker.dataset.page = pg.pdf_page;
  marker.setAttribute('aria-label', label + '，PDF 第 ' + pg.pdf_page + ' 页');
  marker.addEventListener('click', () => {
    this.hooks.onSourceObject?.({ type: it.type, page: pg.pdf_page });
  });
  anchor.appendChild(marker);
  node = marker;
```

Keep `itemEls` population and `onItemRender` behavior unchanged so plugins can observe the marker if needed.

Add a restrained placeholder style in `reader/src/style.css`:

```css
.source-object {
  display: flex; align-items: center; justify-content: center; width: 100%;
  margin: 1.1em 0; padding: 12px 16px;
  color: var(--ink-2); background: var(--panel); border: 1px dashed var(--line);
  border-radius: var(--r-md); font-family: var(--sans); font-size: .82em;
  transition: color .12s ease, background .12s ease, border-color .12s ease;
}
.source-object:hover, .source-object:focus-visible {
  color: var(--accent); background: var(--panel-2); border-color: var(--accent);
  outline: none;
}
```

- [ ] **Step 4: Run the focused and complete frontend tests**

Run:

```bash
cd reader && node --test test/source-objects.test.mjs && npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit marker rendering**

```bash
git add reader/src/core/views.js reader/src/style.css reader/test/source-objects.test.mjs
git commit -m "feat: 渲染图片与表格来源占位"
```

---

### Task 3: Reveal marker source in the PDF pane

**Files:**
- Modify: `reader/test/source-objects.test.mjs`
- Modify: `reader/src/core/app.js:280-365`

**Interfaces:**
- Consumes: `TextView` hook payload `{type, page}` and the active book view `{prefs, setPrefs, pdfPromise, pdfView}`.
- Produces: exported helper `revealPdfSource(view, page) -> Promise<void>`; text-only mode changes to split before PDF navigation.

- [ ] **Step 1: Add failing navigation tests to `source-objects.test.mjs`**

```javascript
const { revealPdfSource } = await import('../src/core/app.js');

test('text-only source reveal switches to split before jumping to PDF', async () => {
  const events = [];
  const view = {
    prefs: { viewMode: 'text' },
    setPrefs(patch) {
      Object.assign(this.prefs, patch);
      events.push('mode:' + patch.viewMode);
    },
    pdfPromise: Promise.resolve(),
    pdfView: { gotoPage: (page) => events.push('pdf:' + page) },
  };

  await revealPdfSource(view, 12);
  assert.deepEqual(events, ['mode:split', 'pdf:12']);
});

test('split source reveal jumps directly without changing mode', async () => {
  const events = [];
  const view = {
    prefs: { viewMode: 'split' },
    setPrefs: () => events.push('unexpected-mode-change'),
    pdfPromise: Promise.resolve(),
    pdfView: { gotoPage: (page) => events.push('pdf:' + page) },
  };

  await revealPdfSource(view, 9);
  assert.deepEqual(events, ['pdf:9']);
});
```

- [ ] **Step 2: Run the focused tests and verify the helper is missing**

Run:

```bash
cd reader && node --test test/source-objects.test.mjs
```

Expected: FAIL because `revealPdfSource` is not exported.

- [ ] **Step 3: Implement app-owned mode switching and PDF navigation**

Add this helper near `activeView()` in `reader/src/core/app.js`:

```javascript
export async function revealPdfSource(view, page) {
  if (!view || !Number.isFinite(+page)) return;
  if (view.prefs?.viewMode === 'text') view.setPrefs({ viewMode: 'split' });
  await view.pdfPromise;
  view.pdfView.gotoPage(+page);
}
```

In `createBookView`, declare the view reference before constructing `TextView`:

```javascript
let view = null;
```

Pass the new hook alongside the existing render, page, scroll, and selection hooks:

```javascript
onSourceObject: ({ page }) => revealPdfSource(view, page),
```

Change the later declaration from `const view = {...}` to:

```javascript
view = { bookId: book.id, wv, pdfView, textView, model, pdfPromise };
```

- [ ] **Step 4: Run focused tests, full tests, smoke test, and production build**

Run:

```bash
.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
cd reader
npm test
npm run test:smoke
npm run build
```

Expected: Python tests PASS; all Node tests PASS; smoke test exits 0 with only documented jsdom canvas warnings; Vite build exits 0.

- [ ] **Step 5: Perform browser interaction verification**

Use the local built reader with a fixture or converted book containing marker items and verify:

```text
text mode + click marker  → viewMode becomes split → PDF lands on parent pdf_page
split mode + click marker → viewMode remains split → PDF lands on parent pdf_page
```

Verify the text panel does not scroll away from the clicked marker and both marker buttons expose an accessible name.

- [ ] **Step 6: Commit app navigation**

```bash
git add reader/src/core/app.js reader/test/source-objects.test.mjs
git commit -m "feat: 从文字占位跳转原始 PDF 页"
```

---

## Final Verification

- [ ] Run formatting and repository-state checks:

```bash
git diff --check
git status --short
```

- [ ] Confirm no out-of-scope files are staged, especially:

```text
reader/src/assets/icons/bookmark.svg
reader/src/assets/icons/bookmark.fill.svg
scan2ebook/web_reader.py
```

- [ ] Confirm the implementation matches every requirement in `docs/superpowers/specs/2026-08-25-text-view-structure-design.md`.
