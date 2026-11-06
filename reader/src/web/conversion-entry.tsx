import { createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ConversionPage, type ConversionHandle, type ConversionProps, type ConversionOpen } from './ConversionPage';

export function createConversionView(props: ConversionProps = {}) {
  const element = document.createElement('section');
  element.id = 'conversion-view'; element.hidden = true;
  const ref = createRef<ConversionHandle>();
  const root = createRoot(element);
  flushSync(() => root.render(<ConversionPage ref={ref} {...props} />));
  return {
    element,
    async open(options: ConversionOpen = {}) {
      element.hidden = false;
      await ref.current?.open(options);
      flushSync(() => {});
      if (options.file) await ref.current?.selectFile(options.file);
    },
    deactivate() { element.hidden = true; flushSync(() => ref.current?.deactivate()); },
  };
}
