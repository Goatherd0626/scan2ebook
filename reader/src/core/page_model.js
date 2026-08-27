/* 核心数据结构：OCR 文本块与页面。 */
export const KIND_BODY = 'body';

export class TextBlock {
  constructor(text, bbox, confidence = 0, kind = KIND_BODY) {
    this.text = text;
    this.bbox = bbox;               // [x0, y0, x1, y1] 归一化，左上原点
    this.confidence = confidence;
    this.kind = kind;
  }
  get cy() { return (this.bbox[1] + this.bbox[3]) / 2; }
  get cx() { return (this.bbox[0] + this.bbox[2]) / 2; }
  clean() {
    return this.text.split('\n').map((s) => s.trim()).filter(Boolean).join(' ');
  }
}

export class Page {
  constructor(pdfPage, width, height) {
    this.pdfPage = pdfPage;         // 1 起
    this.width = width;
    this.height = height;
    this.blocks = [];               // TextBlock[]
  }
}
