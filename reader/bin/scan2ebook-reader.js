#!/usr/bin/env node
import { helpText, parseCliArgs } from '../lib/options.js';
import { READER_VERSION, startReader } from '../lib/server.js';

async function main() {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`scan2ebook-reader: ${error.message}`);
    console.error('使用 --help 查看可用参数。');
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    console.log(helpText());
    return;
  }
  if (options.version) {
    console.log(READER_VERSION);
    return;
  }

  try {
    const reader = await startReader(options);
    if (options.host !== '127.0.0.1' || options.port !== 8765) {
      console.warn('注意：更换 host 或 port 后，浏览器会使用独立的 IndexedDB 书库。');
    }
    if (reader.reused) {
      console.log(`📖 scan2ebook 阅读器已在运行：${reader.url}`);
      return;
    }

    console.log(`📖 scan2ebook 阅读器：${reader.url}`);
    console.log('按 Ctrl+C 停止服务。');
    let closing = false;
    const shutdown = async () => {
      if (closing) return;
      closing = true;
      try {
        await reader.close();
      } finally {
        process.exitCode = 0;
      }
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    console.error(`scan2ebook-reader: ${error.message}`);
    process.exitCode = 1;
  }
}

await main();
