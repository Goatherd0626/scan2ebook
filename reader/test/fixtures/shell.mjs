import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Shell } from '../../src/web/Shell.tsx';

export const shellHtml = '<!doctype html><html><body>' + renderToStaticMarkup(createElement(Shell)) + '</body></html>';
