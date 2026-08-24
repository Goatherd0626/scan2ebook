/* 插件自动发现：在此显式引入各插件模块（每个模块调用 registerExtension 自注册）。
   新增插件 = 在 src/plugins/ 建文件夹 + 在下方加一行 import。 */
import './footnotes/index.js';
import './search/index.js';
import './bookmarks/index.js';
import './eyecare/index.js';
import './progress/index.js';
