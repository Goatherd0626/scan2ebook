import JSZip from 'jszip';

import { buildAnnotationSidecar } from '../../core/annotation_format.js';

export async function buildAnnotatedS2e(book, records, loadPdf = null) {
  const zip = new JSZip();
  const pdfBlob = book.pdfBlob?.arrayBuffer ? book.pdfBlob : await loadPdf?.();
  if (!pdfBlob?.arrayBuffer) throw new Error('无法读取电子书 PDF');
  zip.file('book.pdf', await pdfBlob.arrayBuffer());
  zip.file('book.json', JSON.stringify(book.bookJson, null, 2));
  zip.file('annotations.json', JSON.stringify(buildAnnotationSidecar(records, book.bookmarks || []), null, 2));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export async function downloadAnnotatedS2e(book, records, loadPdf = null) {
  const blob = await buildAnnotatedS2e(book, records, loadPdf);
  const title = (book.meta?.title || book.s2eName || '电子书').replace(/[\\/:*?"<>|]/g, '-');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = title + '-含标注.s2e';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
