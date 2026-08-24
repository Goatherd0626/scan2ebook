"""命令行入口：python -m scan2ebook <书.pdf> -o output

流水线：渲染 → OCR（Apple Vision 本地 / PDF 文字层）→ ds-vision 逐页结构化
→ 整本书 JSON + 网页阅读器 HTML。
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from collections import Counter
from pathlib import Path

from tqdm import tqdm

from .config import OCR_DPI, OCR_LANGUAGES
from .llm import DeepSeekClient
from .ocr_engine import ocr_image
from .pdf_utils import extract_text_layer, has_text_layer, open_pdf, render_page
from .toc import build_book_toc
from .vision import VisionStructure
from .web_reader import build_reader_html

log = logging.getLogger("scan2ebook")

# OCR 文字极少（<3 字）的页按空白页跳过，不调用视觉模型。
# 注意阈值不能太高：分册页/扉页常只有几个字（如「第一稿」），应送视觉模型分类。
BLANK_TEXT_THRESHOLD = 3


def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        prog="scan2ebook",
        description="扫描版书籍 → 带页码锚定的网页阅读器 + 整本结构化 JSON。\n"
                    "子命令：scan2ebook serve —— 启动本地阅读器（自动打开浏览器）",
    )
    ap.add_argument("book", help="扫描版 PDF 路径")
    ap.add_argument("-o", "--out", default="output", help="输出目录（默认 ./output）")
    ap.add_argument("--dpi", type=int, default=OCR_DPI, help="渲染分辨率（默认 300）")
    ap.add_argument("--lang", default=",".join(OCR_LANGUAGES),
                    help="OCR 语言偏好，逗号分隔（默认 zh-Hans,zh-Hant,en-US）")
    ap.add_argument("--force-ocr", action="store_true",
                    help="PDF 自带文字层时也强制走 OCR")
    ap.add_argument("--no-footnotes", action="store_true", help="丢弃脚注内容")
    ap.add_argument("--no-bundle", action="store_true",
                    help="不打包 .s2e（默认自动打包：pdf + json 的 zip 压缩包）")
    ap.add_argument("--serve", action="store_true",
                    help="转换完成后自动启动阅读器并打开浏览器")
    ap.add_argument("--split-pages", action="store_true",
                    help="除整本 JSON 外，额外输出 pages/page_NNN.json（抽查单页用）")
    ap.add_argument("--verbose", action="store_true")
    return ap.parse_args(argv)


def _render_and_ocr(doc, args) -> tuple[list, list[str]]:
    """渲染全部页面并得到每页 OCR 文本。返回 (imgs, ocr_texts)。

    PDF 自带文字层时直接用文字层文本（更准更快）；否则 Apple Vision OCR。
    """
    langs = [x.strip() for x in args.lang.split(",") if x.strip()] or OCR_LANGUAGES
    use_text_layer = has_text_layer(doc) and not args.force_ocr
    layer_texts = extract_text_layer(doc) if use_text_layer else None
    if use_text_layer:
        log.info("检测到 PDF 自带文字层，直接用文字层文本（--force-ocr 可强制 OCR）")

    imgs: list = []
    ocr_texts: list[str] = []
    for i in tqdm(range(len(doc)), desc="渲染+OCR", unit="页"):
        try:
            img = render_page(doc, i, dpi=args.dpi)
        except Exception as e:  # noqa: BLE001
            log.warning("第 %d 页渲染失败：%s", i + 1, e)
            imgs.append(None)
            ocr_texts.append("")
            continue
        imgs.append(img)
        if layer_texts is not None:
            ocr_texts.append((layer_texts[i] or "").strip())
        else:
            try:
                blocks = ocr_image(img, languages=langs)
                lines = sorted(blocks, key=lambda b: (b.cy, b.x0))
                ocr_texts.append("\n".join(b.clean() for b in lines if b.clean()))
            except Exception as e:  # noqa: BLE001
                log.warning("第 %d 页 OCR 失败：%s", i + 1, e)
                ocr_texts.append("")
    return imgs, ocr_texts


def main(argv=None) -> int:
    argv = list(argv) if argv is not None else sys.argv[1:]
    # 子命令：scan2ebook serve —— 启动本地阅读器
    if argv and argv[0] == "serve":
        from .reader import main as reader_main
        return reader_main(argv[1:])

    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
        stream=sys.stderr,
    )

    src = Path(args.book)
    if not src.exists():
        log.error("找不到文件：%s", src)
        return 1
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = src.stem

    vs = VisionStructure()
    if not vs.enabled:
        log.error("需要 DEEPSEEK_API_KEY（在 .env 中配置）才能运行")
        return 1

    doc = open_pdf(str(src))
    log.info("共 %d 页：%s", len(doc), src.name)

    # 1) 渲染 + OCR
    imgs, ocr_texts = _render_and_ocr(doc, args)

    # 2) ds-vision 逐页结构化（图像 + OCR 文本）
    blank_indices = {i for i, t in enumerate(ocr_texts) if len(t.strip()) < BLANK_TEXT_THRESHOLD}
    if blank_indices:
        log.info("规则预筛 %d 页为空白/极简页（跳过视觉模型）", len(blank_indices))
    structured = vs.structure_book(imgs, ocr_texts, blank_indices=blank_indices)

    if args.no_footnotes:
        for pg in structured:
            pg["items"] = [it for it in pg["items"] if it["type"] != "footnote"]

    # 3) 元数据（DeepSeek 文本模型，从书名页 OCR 提取）
    client = DeepSeekClient()
    metadata: dict = {}
    if client.enabled:
        metadata = client.extract_metadata("\n".join(ocr_texts[:3]))
    meta = dict(metadata)
    meta.setdefault("title", stem)

    # 4) 整本书 JSON（页粒度保留在 pages 数组内，页码锚定不丢）
    book_json = {
        "pdf_source": src.name,
        "book": meta,
        "toc": build_book_toc(structured),
        "pages": structured,
    }
    book_path = out_dir / f"{stem}.json"
    book_path.write_text(json.dumps(book_json, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("整本书 JSON 已生成：%s", book_path)

    if args.split_pages:  # 可选：逐页小文件，方便抽查单页
        pages_dir = out_dir / "pages"
        pages_dir.mkdir(exist_ok=True)
        for pg in structured:
            (pages_dir / f"page_{pg['pdf_page']:03d}.json").write_text(
                json.dumps(pg, ensure_ascii=False, indent=2), encoding="utf-8")

    # 5) 网页阅读器（自包含单文件，快速预览用；完整阅读器见 python -m scan2ebook.reader）
    html_path = out_dir / f"{stem}.html"
    html_path.write_text(build_reader_html(structured, meta, stem), encoding="utf-8")
    log.info("网页阅读器已生成：%s", html_path)

    # 6) .s2e 打包（pdf + json 的 zip，阅读器主格式）
    if not args.no_bundle:
        s2e_path = out_dir / f"{stem}.s2e"
        _bundle_s2e(s2e_path, src, book_json)
        log.info("电子书包已生成：%s", s2e_path)

    # 6) 汇总
    kind_count = Counter(pg.get("page_kind", "body") for pg in structured)
    n_body = sum(1 for pg in structured for it in pg["items"] if it["type"] == "body")
    n_head = sum(1 for pg in structured for it in pg["items"] if it["type"] == "heading")
    n_fn = sum(1 for pg in structured for it in pg["items"] if it["type"] == "footnote")
    n_toc = sum(1 for e in book_json["toc"] if e.get("pdf_page"))
    log.info("完成：正文段 %d，标题 %d，脚注 %d，目录条目 %d（可跳转 %d）（共 %d 页）",
             n_body, n_head, n_fn, len(book_json["toc"]), n_toc, len(structured))
    log.info("页面类型分布：%s", dict(kind_count))
    print(f"\n✅ 输出目录：{out_dir}")
    print(f"   - 网页阅读器: {html_path}")
    print(f"   - 整本书JSON: {book_path}"
          + (f"\n   - 逐页JSON: {out_dir / 'pages'}/" if args.split_pages else ""))
    if not args.no_bundle:
        print(f"   - 电子书包: {out_dir / (stem + '.s2e')}（拖入阅读器打开）")
    if args.serve:
        _launch_reader()
    else:
        print(f"   - 启动阅读器: python -m scan2ebook serve")
    return 0


def _launch_reader(port: int = 8765, host: str = "127.0.0.1") -> None:
    """转换完成后后台启动阅读器服务并打开浏览器。"""
    import subprocess
    import time
    import urllib.request
    import webbrowser

    log.info("启动阅读器：python -m scan2ebook serve …")
    py = sys.executable
    subprocess.Popen(
        [py, "-m", "scan2ebook.reader", "--port", str(port), "--host", host],
        start_new_session=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    url = f"http://{host}:{port}"
    for _ in range(30):
        try:
            urllib.request.urlopen(url, timeout=0.5)
            break
        except Exception:  # noqa: BLE001
            time.sleep(0.2)
    webbrowser.open(url)


def _bundle_s2e(s2e_path: Path, src: Path, book_json: dict) -> None:
    """打包 .s2e：zip 内含 book.json（结构化数据）与 book.pdf（原始扫描件）。"""
    import zipfile
    with zipfile.ZipFile(s2e_path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("book.json", json.dumps(book_json, ensure_ascii=False, indent=2))
        z.write(src, "book.pdf")


if __name__ == "__main__":
    sys.exit(main())
