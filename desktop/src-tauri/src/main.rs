#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;

use std::{
    path::PathBuf,
    sync::{atomic::{AtomicBool, Ordering}, Mutex},
};
use tauri::{
    menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu},
    webview::{DownloadEvent, NewWindowResponse}, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

struct DesktopState {
    backend: Mutex<Option<backend::Backend>>,
    confirming_exit: AtomicBool,
    exit_approved: AtomicBool,
}

impl DesktopState {
    fn busy(&self) -> bool {
        self.backend.lock().unwrap().as_ref().is_some_and(|backend| backend.busy())
    }

    fn shutdown(&self) {
        if let Some(mut backend) = self.backend.lock().unwrap().take() {
            backend.shutdown();
        }
    }
}

fn menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let about = PredefinedMenuItem::about(app, Some("关于 Scan2Ebook"), Some(AboutMetadata {
        name: Some("Scan2Ebook".into()),
        version: Some(app.package_info().version.to_string()),
        comments: Some("扫描书转换与阅读\n部分界面组件来自 Rare UI · https://www.rareui.com/".into()),
        copyright: Some("© Scan2Ebook contributors. Third-party notices are included in the app resources.".into()),
        ..Default::default()
    }))?;
    let application = Submenu::with_items(app, "Scan2Ebook", true, &[
        &about,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::hide(app, Some("隐藏 Scan2Ebook"))?,
        &PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?,
        &PredefinedMenuItem::show_all(app, Some("显示全部"))?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::quit(app, Some("退出 Scan2Ebook"))?,
    ])?;
    let files = Submenu::with_items(app, "文件", true, &[
        &MenuItem::with_id(app, "open", "添加书籍…", true, Some("CmdOrCtrl+O"))?,
        &MenuItem::with_id(app, "convert", "转换 PDF", true, Some("CmdOrCtrl+N"))?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::close_window(app, Some("关闭窗口"))?,
    ])?;
    let edit = Submenu::with_items(app, "编辑", true, &[
        &PredefinedMenuItem::undo(app, Some("撤销"))?,
        &PredefinedMenuItem::redo(app, Some("重做"))?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::cut(app, Some("剪切"))?,
        &PredefinedMenuItem::copy(app, Some("复制"))?,
        &PredefinedMenuItem::paste(app, Some("粘贴"))?,
        &PredefinedMenuItem::select_all(app, Some("全选"))?,
    ])?;
    let window = Submenu::with_items(app, "窗口", true, &[
        &PredefinedMenuItem::minimize(app, Some("最小化"))?,
        &PredefinedMenuItem::maximize(app, Some("缩放"))?,
        &PredefinedMenuItem::fullscreen(app, Some("进入全屏"))?,
    ])?;
    Menu::with_items(app, &[&application, &files, &edit, &window])
}

fn request_exit(app: &tauri::AppHandle) {
    let state = app.state::<DesktopState>();
    if !state.busy() {
        state.exit_approved.store(true, Ordering::SeqCst);
        app.exit(0);
        return;
    }
    if state.confirming_exit.swap(true, Ordering::SeqCst) {
        return;
    }
    let handle = app.clone();
    app.dialog().message("退出会停止当前转换。已经完成的电子书会保留，之后可以重新转换。")
        .title("停止转换并退出？")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("停止并退出".into(), "继续转换".into()))
        .show(move |confirmed| {
            let state = handle.state::<DesktopState>();
            state.confirming_exit.store(false, Ordering::SeqCst);
            if confirmed {
                state.exit_approved.store(true, Ordering::SeqCst);
                handle.exit(0);
            }
        });
}

fn unique_download(directory: &std::path::Path, suggested: &std::path::Path) -> PathBuf {
    let name = suggested.file_name().unwrap_or_else(|| std::ffi::OsStr::new("电子书.s2e"));
    let target = directory.join(name);
    if !target.exists() { return target; }
    let stem = target.file_stem().unwrap_or_default().to_string_lossy();
    let extension = target.extension().map(|s| format!(".{}", s.to_string_lossy())).unwrap_or_default();
    for index in 2.. {
        let path = directory.join(format!("{stem} ({index}){extension}"));
        if !path.exists() { return path; }
    }
    unreachable!()
}

fn converter_command(engine: PathBuf) -> Result<Vec<String>, std::io::Error> {
    let mut command = vec![engine.to_string_lossy().into_owned()];
    let arguments: Vec<_> = std::env::args().collect();
    if let Some(index) = arguments.iter().position(|arg| arg == "--test-api-base") {
        let base = arguments.get(index + 1).ok_or_else(|| std::io::Error::other("缺少本地测试地址"))?;
        let url = tauri::Url::parse(base).map_err(std::io::Error::other)?;
        let local = matches!(url.host_str(), Some("127.0.0.1" | "[::1]" | "::1"));
        if url.scheme() != "http" || !local || std::env::var("SCAN2EBOOK_TEST_API_BASE").ok().as_ref() != Some(base) {
            return Err(std::io::Error::other("测试模型仅允许明确启用的本机回环地址"));
        }
        command.extend(["--test-api-base".into(), base.clone()]);
    }
    Ok(command)
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(DesktopState {
            backend: Mutex::new(None),
            confirming_exit: AtomicBool::new(false),
            exit_approved: AtomicBool::new(false),
        })
        .menu(menu)
        .on_menu_event(|app, event| {
            if let Some(window) = app.get_webview_window("main") {
                let script = match event.id().as_ref() {
                    "open" => Some("document.getElementById('import-input')?.click()"),
                    "convert" => Some("document.getElementById('nav-convert')?.click()"),
                    _ => None,
                };
                if let Some(script) = script { let _ = window.eval(script); }
            }
        })
        .setup(|app| {
            let initialized = (|| -> Result<(), Box<dyn std::error::Error>> {
            let resources = app.path().resource_dir().map_err(|_| std::io::Error::other(
                "无法定位应用资源，请将 Scan2Ebook.app 复制到「应用程序」后重新打开。"
            ))?;
            let data_dir = std::env::var_os("SCAN2EBOOK_DESKTOP_DATA_DIR")
                .map(PathBuf::from).unwrap_or(app.path().app_data_dir()?);
            let converter = converter_command(resources.join("scan2ebook-engine"))?;
            let backend = backend::start(data_dir, resources.join("frontend"), converter)
                .map_err(std::io::Error::other)?;
            let url: tauri::Url = backend.url.parse()?;
            // 随机端口只用于本次本机运行，前端没有 Tauri IPC 权限。
            let allowed_origin = url.origin();
            if let Some(path) = std::env::var_os("SCAN2EBOOK_DESKTOP_READY_FILE") {
                std::fs::write(path, serde_json::json!({"url": backend.url, "pid": std::process::id()}).to_string())?;
            }
            *app.state::<DesktopState>().backend.lock().unwrap() = Some(backend);
            let download_dir = std::env::var_os("SCAN2EBOOK_DESKTOP_DOWNLOAD_DIR")
                .map(PathBuf::from).unwrap_or(app.path().download_dir()?);
            let download_handle = app.handle().clone();
            let preview_handle = app.handle().clone();
            let preview_origin = allowed_origin.clone();
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Scan2Ebook")
                .inner_size(1280.0, 840.0)
                .min_inner_size(820.0, 620.0)
                .disable_drag_drop_handler()
                .on_navigation(move |url| url.origin() == allowed_origin || url.scheme() == "blob")
                .on_new_window(move |url, features| {
                    let path = url.path();
                    let pdf = path.ends_with("/pdf") && (
                        path.starts_with("/__scan2ebook__/conversion/uploads/")
                        || path.starts_with("/__scan2ebook__/storage/books/")
                    );
                    if url.origin() != preview_origin || !pdf { return NewWindowResponse::Deny; }
                    let origin = preview_origin.clone();
                    let window = WebviewWindowBuilder::new(&preview_handle,
                        format!("pdf-{}", uuid::Uuid::new_v4()), WebviewUrl::External("about:blank".parse().unwrap()))
                        .window_features(features)
                        .title("原始 PDF")
                        .inner_size(880.0, 760.0)
                        .on_navigation(move |url| url.origin() == origin || url.as_str() == "about:blank")
                        .build();
                    match window {
                        Ok(window) => NewWindowResponse::Create { window },
                        Err(_) => NewWindowResponse::Deny,
                    }
                })
                .on_download(move |_, event| {
                    match event {
                        DownloadEvent::Requested { destination, .. } => {
                            if std::fs::create_dir_all(&download_dir).is_err() { return false; }
                            *destination = unique_download(&download_dir, destination);
                        }
                        DownloadEvent::Finished { success: false, .. } => {
                            download_handle.dialog().message("下载未完成，请重试。").title("Scan2Ebook").show(|_| {});
                        }
                        _ => {}
                    }
                    true
                })
                .build()?;
            let handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if !handle.state::<DesktopState>().exit_approved.load(Ordering::SeqCst) {
                        api.prevent_close();
                        request_exit(&handle);
                    }
                }
            });
            Ok(())
            })();
            if let Err(error) = initialized {
                eprintln!("Scan2Ebook 启动失败：{error}");
                let handle = app.handle().clone();
                app.dialog().message(format!("本地书库未能启动。\n{error}"))
                    .title("无法打开 Scan2Ebook")
                    .kind(MessageDialogKind::Error)
                    .show(move |_| {
                        handle.state::<DesktopState>().exit_approved.store(true, Ordering::SeqCst);
                        handle.exit(1);
                    });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("无法启动 Scan2Ebook");

    app.run(|app, event| match event {
        RunEvent::ExitRequested { api, .. } => {
            if !app.state::<DesktopState>().exit_approved.load(Ordering::SeqCst) {
                api.prevent_exit();
                request_exit(app);
            }
        }
        RunEvent::Exit => app.state::<DesktopState>().shutdown(),
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn downloaded_books_do_not_overwrite_existing_files() {
        let directory = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("书.s2e"), b"keep").unwrap();
        assert_eq!(unique_download(&directory, std::path::Path::new("/tmp/书.s2e")), directory.join("书 (2).s2e"));
        assert_eq!(std::fs::read(directory.join("书.s2e")).unwrap(), b"keep");
        std::fs::remove_dir_all(directory).unwrap();
    }
}
