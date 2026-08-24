/* 阅读器入口：初始化 pdf.js worker、注册插件、启动核心 */
import './style.css';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

import './plugins/index.js';        // 注册全部插件
import { init } from './core/app.js';

init();
