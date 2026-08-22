"""生成一本模拟的「扫描版」示例书（图像型 PDF，无文字层）。

用于端到端测试：包含书名页/版权页、页眉、脚注、跨页续段、中英混排、
一级/二级标题等典型场景。页码锚定一律以 PDF 页为准。

用法：.venv/bin/python scripts/make_sample_book.py
输出：sample/示例书_扫描版.pdf
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import fitz  # noqa: E402

# ---------- 画布（A4 @ 300dpi，真实书籍字号 ≈ 10.5-12pt = 44-50px） ----------
W, H = 2480, 3508
MARGIN_LR = 230
TEXT_W = W - 2 * MARGIN_LR
BODY_TOP, BODY_BOTTOM = 400, 2720
HEADER_Y = 140
FOOTNOTE_Y0 = 2780

FONT_BODY, LEADING_BODY = 50, 88          # 正文 12pt，行距 1.76
FONT_H1, FONT_H2 = 78, 62                 # 一级/二级标题
FONT_HEADER = 42
FONT_FOOTNOTE, LEADING_FOOTNOTE = 38, 56
INDENT = 2 * FONT_BODY                    # 段首缩进两字

FONT_CANDIDATES_CJK = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
]
FONT_CANDIDATES_LATIN = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]

_cache: dict = {}


def load_font(size: int, cjk: bool = True):
    key = (size, cjk)
    if key in _cache:
        return _cache[key]
    candidates = FONT_CANDIDATES_CJK if cjk else FONT_CANDIDATES_LATIN
    for path in candidates:
        try:
            f = ImageFont.truetype(path, size=size, index=0)
            _cache[key] = f
            return f
        except OSError:
            continue
    f = ImageFont.load_default()
    _cache[key] = f
    return f


def is_cjk(ch: str) -> bool:
    return "\u4e00" <= ch <= "\u9fff" or ch in "，。！？；：、（）「」『』《》〈〉·—…"


def wrap(text: str, font: ImageFont.FreeTypeFont, max_w: int) -> list[str]:
    """按字符宽度贪心折行：CJK 单字断行，拉丁按词断行。"""
    lines, cur, cur_w = [], "", 0.0
    for ch in text:
        w = font.getlength(ch)
        if cur_w + w > max_w and cur:
            lines.append(cur)
            cur, cur_w = "", 0.0
        cur += ch
        cur_w += w
    if cur:
        lines.append(cur)
    return lines


class Sheet:
    def __init__(self, header: str = ""):
        self.img = Image.new("RGB", (W, H), "white")
        self.d = ImageDraw.Draw(self.img)
        self.y = BODY_TOP
        self.footnote_y = FOOTNOTE_Y0
        if header:
            f = load_font(FONT_HEADER)
            tw = f.getlength(header)
            self.d.text(((W - tw) / 2, HEADER_Y), header, font=f, fill="black")

    def _newline(self, leading: int):
        self.y += leading
        if self.y > BODY_BOTTOM:
            raise RuntimeError("内容超出页面")

    def heading(self, text: str, level: int = 1):
        size = FONT_H1 if level == 1 else FONT_H2
        font = load_font(size)
        lines = wrap(text, font, TEXT_W)
        if level == 1:
            for ln in lines:
                tw = font.getlength(ln)
                self.d.text(((W - tw) / 2, self.y), ln, font=font, fill="black")
                self.y += int(size * 1.6)
            self.y += 60
        else:
            for ln in lines:
                self.d.text((MARGIN_LR, self.y), ln, font=font, fill="black")
                self.y += int(size * 1.6)
            self.y += 40

    def para(self, text: str, indent: bool = True):
        font = load_font(FONT_BODY)
        lines = wrap(text, font, TEXT_W)
        for i, ln in enumerate(lines):
            x = MARGIN_LR + (INDENT if (indent and i == 0) else 0)
            self.d.text((x, self.y), ln, font=font, fill="black")
            self._newline(LEADING_BODY)
        self.y += 40

    def footnote(self, text: str):
        font = load_font(FONT_FOOTNOTE)
        self.d.line([(MARGIN_LR + 60, FOOTNOTE_Y0 - 34), (MARGIN_LR + 900, FOOTNOTE_Y0 - 34)], fill="black", width=2)
        for ln in wrap(text, font, TEXT_W - 60):
            self.d.text((MARGIN_LR + 60, self.footnote_y), ln, font=font, fill="black")
            self.footnote_y += LEADING_FOOTNOTE

    def save(self, path: Path):
        self.img.save(path)


def build_pages() -> list[Image.Image]:
    pages: list[Image.Image] = []

    # ---- 第 1 页（PDF 1）：书名页 + 版权页 ----
    s = Sheet()
    s.y = 900
    s.heading("近代中国商业与金融史", level=1)
    s.y += 80
    s.heading("一个制度变迁的视角", level=2)
    s.y += 200
    s.para("郑泽卉 著", indent=False)
    s.y += 120
    s.para("启明大学出版社", indent=False)
    s.y += 100
    s.para("2024年6月第2版", indent=False)
    s.y += 100
    s.para("ISBN 978-7-5011-2345-6", indent=False)
    s.y += 60
    s.para("图书在版编目（CIP）数据", indent=False)
    pages.append(s.img)

    # ---- 第 2 页（PDF 2）----
    s = Sheet(header="第一章 导论")
    s.heading("第一章 导论", level=1)
    s.para("近代中国的商业变迁，是理解国家转型的关键线索。学者们普遍认为，晚清以降的市场整合程度远超以往任何时期，这一判断已逐渐成为学界的共识。")
    s.para("本书的核心问题是：制度变迁如何塑造了近代中国金融市场的格局？为回答这一问题，我们有必要从长时段的视角考察商业组织的演变，并比较不同区域之间的差异。")
    s.para("与此同时，西方史学界对大分流（Great Divergence）的讨论，为理解中国经济的独特路径提供了重要的参照。As Kenneth Pomeranz has argued, the Great Divergence was not inevitable but the product of contingent developments in")
    s.footnote("①参见吴承明：《中国资本主义与国内市场》，中国社会科学出版社，1985年，第12—15页。")
    pages.append(s.img)

    # ---- 第 3 页（PDF 3）----
    s = Sheet(header="第一章 导论")
    # 跨页续段：真实排版中，续行不缩进
    s.para("energy, trade, and colonial expansion, rather than the expression of any timeless civilizational hierarchy. 本章将首先回顾相关文献，然后提出本书的分析框架，最后说明各章的安排。", indent=False)
    s.para("需要说明的是，本书所依据的史料主要包括各地商会档案、银行年鉴以及当事人的回忆录，这些材料各有优劣，使用时应相互参证。")
    s.footnote("②See Kenneth Pomeranz, The Great Divergence: China, Europe, and the Making of the Modern World Economy, Princeton University Press, 2000, p. 45.")
    pages.append(s.img)

    # ---- 第 4 页（PDF 4）----
    s = Sheet(header="第一章 导论")
    s.heading("一、研究缘起", level=2)
    s.para("选择商业与金融作为观察窗口，是因为二者最能体现国家与市场之间的张力。近代中国既没有出现欧洲式的完全放任，也未曾真正建立起统制经济，制度上的模糊恰恰构成了历史研究的富矿。")
    s.para("在研究方法上，本书综合运用计量分析与个案深描，既关心总体趋势，也不忽略具体人物的选择与行动。")
    pages.append(s.img)

    # ---- 第 5 页（PDF 5）----
    s = Sheet(header="第二章 研究方法")
    s.heading("第二章 研究方法", level=1)
    s.para("本书以档案文献为主要依据，辅以报刊数据与口述访谈。档案方面，重点利用上海市档案馆藏商会档案全宗；报刊方面，则系统检索《申报》《大公报》等主要报纸的商业栏目。")
    s.para("数据处理遵循可复现原则：所有原始数据均标注来源页码，方便读者复核。这正是本书坚持为每一段引文注明出处页的原因。")
    pages.append(s.img)

    return pages


def main():
    sample_dir = ROOT / "sample"
    sample_dir.mkdir(exist_ok=True)
    pages = build_pages()

    pdf_path = sample_dir / "示例书_扫描版.pdf"
    doc = fitz.open()
    for i, img in enumerate(pages):
        png_path = sample_dir / f"page_{i + 1:02d}.png"
        img.save(png_path)
        # A4 页面尺寸以「点」计（595×842pt）；300dpi 渲染时图像正好约 300dpi
        page = doc.new_page(width=595, height=842)
        page.insert_image(page.rect, filename=str(png_path))
    doc.save(str(pdf_path))
    doc.close()
    print(f"已生成：{pdf_path}（{len(pages)} 页，图像型 PDF 无文字层）")


if __name__ == "__main__":
    main()
