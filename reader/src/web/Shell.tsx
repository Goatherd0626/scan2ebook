import { Button } from '../components/ui/button';
import { Icon } from './Icon';
import { TaskCenter } from './TaskCenter';

type ShellProps = { onOpenJob?: (id: string) => unknown; onImportTask?: (file: File, id: string) => Promise<string> };

export function Shell({ onOpenJob, onImportTask }: ShellProps = {}) {
  return <>
    <a className="skip-link" href="#workspace">跳到主要内容</a>
    <header id="topbar">
      <div id="topbar-leading" className="toolbar-group"><Button id="btn-library" className="icon-btn" variant="ghost" size="icon" title="显示或隐藏左侧栏" aria-label="显示或隐藏左侧栏" aria-pressed="true"><span className="sf i-sidebar-left" /></Button></div>
      <div id="topbar-document" className="toolbar-group"><div id="tabs"><span id="tabs-empty">你的数字书桌</span></div></div>
      <div id="topbar-right"><div id="topbar-context" className="toolbar-group"><div id="plugin-toolbar" /></div><div id="topbar-trailing" className="toolbar-group">
        <TaskCenter onOpenJob={onOpenJob} onImport={onImportTask} />
        <Button id="btn-reader-tools" className="mobile-tools-toggle" variant="outline" aria-expanded="false" aria-controls="topbar-context">阅读工具</Button>
        <Button id="btn-settings" className="icon-btn" variant="ghost" size="icon" title="设置 / 插件" aria-label="设置 / 插件"><span className="sf i-gear" /></Button>
        <Button id="btn-import" className="icon-btn text-btn" variant="outline" title="添加 PDF 或 .s2e 电子书" aria-label="添加书籍"><Icon name="plus" size={17} />添加书籍</Button>
      </div></div>
    </header>
    <div id="layout">
      <aside id="sidebar">
        <a className="app-brand" href="./" aria-label="Scan2Ebook 首页" onClick={(event) => { event.preventDefault(); document.getElementById('nav-library')?.click(); }}><span className="brand-mark" aria-hidden="true">s2e<span>.</span></span><span><strong>Scan2Ebook</strong><small>READ, REIMAGINED.</small></span></a>
        <nav className="app-nav" aria-label="主要导航"><Button id="nav-library" variant="ghost" aria-current="page"><span className="sf i-home-library" aria-hidden="true" />我的书库</Button><Button id="nav-convert" variant="ghost"><span className="sf i-pdf" aria-hidden="true" />转换 PDF<span className="nav-plus" aria-hidden="true">+</span></Button></nav>
        <div id="library-panel" className="side-panel"><div className="panel-head"><span className="panel-title">快速访问</span><span className="panel-actions">
          <Button id="btn-import-lib" className="mini act" variant="ghost" size="icon" title="导入电子书" aria-label="导入电子书"><span className="sf i-upload" /></Button><Button id="btn-new-folder" className="mini act" variant="ghost" size="icon" title="新建文件夹" aria-label="新建文件夹"><span className="sf i-folder" /></Button>
        </span></div><div id="library-tree" className="panel-body" /></div>
        <div id="toc-panel" className="side-panel"><div className="panel-head"><span className="panel-title">目录</span><span className="seg" id="toc-tabs"><button data-tt="toc" className="active">目录</button></span></div><div id="toc-list" className="panel-body" /></div>
        <div id="sidebar-resizer" className="layout-resizer" role="separator" aria-orientation="vertical" aria-label="调整侧边栏宽度" aria-valuemin={180} aria-valuemax={480} tabIndex={0} />
        <div className="sidebar-footer"><span className="local-badge"><i />本机书库</span><small>原页与文字，始终在一起。</small><span className="sidebar-wordmark" aria-hidden="true">MAKE<br />ROOM<br />FOR<br />READING<span>↗</span></span></div>
      </aside>
      <main id="workspace" tabIndex={-1} />
    </div>
    <div id="fn-tooltip" /><div id="toast" />
    <div id="settings-mask" hidden />
    <div id="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="sd-title" hidden><div className="sd-head"><span className="sd-title" id="sd-title">设置 / 插件</span><Button id="sd-close" className="icon-btn" variant="ghost" size="icon" title="关闭" aria-label="关闭"><span className="sf i-xmark" /></Button></div><div id="sd-sections" /></div>
    <input type="file" id="import-input" accept=".pdf,.s2e,.zip" multiple hidden />
  </>;
}
