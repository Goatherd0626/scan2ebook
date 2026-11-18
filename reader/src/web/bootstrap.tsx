import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Shell } from './Shell';
import { init, readerBridge } from '../core/app.js';

export function startWorkbench() {
  const root = createRoot(document.getElementById('app')!);
  flushSync(() => root.render(<Shell
    onOpenJob={readerBridge.showConversion}
    onImportTask={readerBridge.importConversion}
    getDraftUploadId={readerBridge.getDraftUploadId}
  />));
  init().catch(() => {
    const message = document.createElement('p');
    message.className = 'startup-error';
    message.textContent = '书库未能打开，请确认本地服务正在运行，然后刷新页面。';
    document.getElementById('workspace')?.appendChild(message);
  });
}
