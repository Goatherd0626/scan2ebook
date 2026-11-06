import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { LibraryPage } from './LibraryPage';

export function mountLibrary(host: HTMLElement) {
  const root = createRoot(host);
  flushSync(() => root.render(<LibraryPage />));
}
