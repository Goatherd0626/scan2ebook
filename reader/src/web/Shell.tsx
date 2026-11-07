import { Button } from '../components/ui/button';
import { Icon } from './Icon';
import { TaskCenter } from './TaskCenter';

const logoLight = new URL('../assets/brand/logo.svg', import.meta.url).href;
const logoDark = new URL('../assets/brand/logo-inverse.svg', import.meta.url).href;

type ShellProps = { onOpenJob?: (id: string) => unknown; onImportTask?: (file: File, id: string) => Promise<string> };

export function Shell({ onOpenJob, onImportTask }: ShellProps = {}) {
  return <>
    <a className="skip-link" href="#workspace">跳到主要内容</a>
    <header id="topbar">
      <div id="topbar-leading" className="toolbar-group"><Button id="btn-library" className="icon-btn" variant="ghost" size="icon" title="显示或隐藏左侧栏" aria-label="显示或隐藏左侧栏" aria-pressed="true"><span className="sf i-sidebar-left" /></Button></div>
      <div id="topbar-document" className="toolbar-group"><nav id="tabs" className="gooey-nav" data-navigation="gooey" aria-label="已打开的页面"><span id="tabs-empty">你的数字书桌</span></nav></div>
      <div id="topbar-right"><div id="topbar-context" className="toolbar-group"><div id="plugin-toolbar" /></div><div id="topbar-trailing" className="toolbar-group">
        <TaskCenter onOpenJob={onOpenJob} onImport={onImportTask} />
        <Button id="btn-reader-tools" className="mobile-tools-toggle" variant="outline" aria-expanded="false" aria-controls="topbar-context">阅读工具</Button>
        <Button id="btn-settings" className="icon-btn" variant="ghost" size="icon" title="设置" aria-label="设置"><span className="sf i-gear" /></Button>
        <Button id="btn-import" className="icon-btn text-btn" variant="outline" title="添加 PDF 或 .s2e 电子书" aria-label="添加书籍"><Icon name="plus" size={17} />添加书籍</Button>
      </div></div>
    </header>
    <div id="layout">
      <aside id="sidebar">
        <a className="app-brand" href="./" aria-label="Scan2Ebook 首页" onClick={(event) => { event.preventDefault(); document.getElementById('nav-library')?.click(); }}><span className="brand-mark" aria-hidden="true"><img className="brand-image brand-image-light" src={logoLight} alt="" /><img className="brand-image brand-image-dark" src={logoDark} alt="" /></span></a>
        <nav className="app-nav" data-navigation="bounce" aria-label="主要导航"><Button id="nav-library" variant="ghost" aria-current="page"><span className="sf i-home-library" aria-hidden="true" />我的书库</Button><Button id="nav-convert" variant="ghost"><span className="sf i-pdf" aria-hidden="true" />转换 PDF</Button></nav>
        <div id="library-panel" className="side-panel"><div className="panel-head"><span className="panel-title">书库</span></div><div id="library-tree" className="panel-body" /></div>
        <div id="toc-panel" className="side-panel"><div className="panel-head"><span className="panel-title">目录</span><span className="seg" id="toc-tabs"><button data-tt="toc" className="active">目录</button></span></div><div id="toc-list" className="panel-body" /></div>
        <div id="sidebar-resizer" className="layout-resizer" role="separator" aria-orientation="vertical" aria-label="调整侧边栏宽度" aria-valuemin={180} aria-valuemax={480} tabIndex={0} />
      </aside>
      <main id="workspace" tabIndex={-1}>
        <section id="settings-view" aria-labelledby="settings-title" hidden>
          <div className="settings-page-head"><h1 id="settings-title" tabIndex={-1}>设置</h1><Button id="settings-back" className="settings-back" variant="ghost"><Icon name="back" size={16} /><span>返回书库</span></Button></div>
          <div className="settings-page-layout"><nav id="settings-nav" data-navigation="bounce" aria-label="设置分类" /><div id="settings-content" /></div>
        </section>
      </main>
    </div>
    <div id="fn-tooltip" />
    <input type="file" id="import-input" accept=".pdf,.s2e,.zip" multiple hidden />
  </>;
}
