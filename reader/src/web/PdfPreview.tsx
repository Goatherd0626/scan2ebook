import { useEffect, useRef, useState } from 'react';
import { pdfjsLib } from '../core/views.js';
import { Icon } from './Icon';

export function PdfPreview({ url, pageNumber = 1 }: { url: string; pageNumber?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    const task = pdfjsLib.getDocument({ url });
    task.promise.then(async (pdf: any) => {
      const page = await pdf.getPage(pageNumber);
      if (cancelled || !canvas.current) return;
      const initial = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(1.6, 580 / initial.width) });
      canvas.current.width = viewport.width;
      canvas.current.height = viewport.height;
      await page.render({ canvasContext: canvas.current.getContext('2d'), viewport }).promise;
      if (!cancelled) setStatus('ready');
    }).catch(() => { if (!cancelled) setStatus('failed'); });
    return () => { cancelled = true; task.destroy(); };
  }, [url, pageNumber]);
  return <div className={'pdf-preview ' + status} aria-label={'PDF 第 ' + pageNumber + ' 页预览'}><canvas ref={canvas} />{status !== 'ready' && <div className="preview-placeholder"><Icon name="file" size={32} /><span>{status === 'loading' ? '正在加载预览' : '预览暂不可用，仍可继续转换'}</span></div>}<span className="preview-page-label">第 {pageNumber} 页</span></div>;
}
