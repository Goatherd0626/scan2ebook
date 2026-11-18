use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, BufReader, Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};
use uuid::Uuid;

const API: &str = "/__scan2ebook__/conversion";
const STORAGE: &str = "/__scan2ebook__/storage";
const API_VERSION: u32 = 1;
const EDITION: &str = "macos";
const MAX_PDF: u64 = 512 * 1024 * 1024;
const KINDS: [&str; 3] = ["s2e", "json", "html"];
const FAILURE: &str = "转换进程已退出，请检查模型、API Key 和账户额度后重试";

#[derive(Debug)]
struct ApiError { status: u16, message: String }
type ApiResult<T> = Result<T, ApiError>;
type HttpResponse = Response<Box<dyn Read + Send>>;

impl ApiError {
    fn new(status: u16, message: impl Into<String>) -> Self { Self { status, message: message.into() } }
}

impl From<io::Error> for ApiError {
    fn from(_: io::Error) -> Self { Self::new(500, "本地服务无法读写文件，请检查可用空间后重试") }
}

fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.as_bytes()[0].is_ascii_alphanumeric()
        && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
}
fn valid_uuid(id: &str) -> bool { id.len() == 36 && Uuid::parse_str(id).is_ok() }
fn require_id(value: &Value, label: &str) -> ApiResult<String> {
    value.as_str().filter(|id| valid_id(id)).map(str::to_owned)
        .ok_or_else(|| ApiError::new(400, format!("{label} 不合法")))
}
fn ids(value: &Value) -> ApiResult<Vec<String>> {
    value.as_array().ok_or_else(|| ApiError::new(400, "bookId 列表不合法"))?
        .iter().map(|value| require_id(value, "bookId")).collect()
}
fn read_json(path: &Path, fallback: Value) -> ApiResult<Value> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| ApiError::new(500, "本地数据文件无法读取")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(fallback),
        Err(error) => Err(error.into()),
    }
}

fn atomic_stream(path: &Path, source: &mut dyn Read, limit: u64) -> ApiResult<u64> {
    fs::create_dir_all(path.parent().unwrap())?;
    let temporary = path.with_file_name(format!(".s2e-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        let mut file = options.open(&temporary)?;
        let size = io::copy(&mut source.take(limit + 1), &mut file)?;
        if size > limit { return Err(ApiError::new(413, "文件或请求内容过大")); }
        file.flush()?;
        drop(file);
        fs::rename(&temporary, path)?;
        Ok(size)
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result
}

fn atomic_json(path: &Path, value: &Value) -> ApiResult<()> {
    let bytes = serde_json::to_vec(value).map_err(|_| ApiError::new(500, "本地数据无法保存"))?;
    atomic_stream(path, &mut Cursor::new(bytes), u64::MAX - 1).map(|_| ())
}

struct Storage { directory: PathBuf, lock: Mutex<()> }

impl Storage {
    fn new(directory: PathBuf) -> ApiResult<Self> {
        fs::create_dir_all(directory.join("books"))?;
        let storage = Self { directory, lock: Mutex::new(()) };
        let source = read_json(&storage.directory.join("library.json"), Self::empty())?;
        if let Some(books) = source["books"].as_array() {
            for book in books {
                if let Some(id) = book["id"].as_str().filter(|id| valid_id(id)) {
                    atomic_json(&storage.book_dir(id).join("record.json"), book)?;
                    if let Some(records) = source["annotations"].get(id) {
                        atomic_json(&storage.book_dir(id).join("annotations.json"), records)?;
                    }
                }
            }
        }
        if !storage.directory.join("library.json").exists() || source.get("books").is_some() {
            atomic_json(&storage.directory.join("library.json"), &Self::normalize(source))?;
        }
        Ok(storage)
    }

    fn empty() -> Value { json!({ "version":1, "bookIds":[], "folders":[], "preferences":{} }) }
    fn normalize(source: Value) -> Value {
        let source_ids: Vec<Value> = source["bookIds"].as_array().cloned().unwrap_or_else(|| {
            source["books"].as_array().map(|books| books.iter().map(|book| book["id"].clone()).collect()).unwrap_or_default()
        });
        let mut seen = HashSet::new();
        let book_ids: Vec<Value> = source_ids.into_iter().filter(|value| value.as_str().map(|id| valid_id(id) && seen.insert(id.to_owned())).unwrap_or(false)).collect();
        json!({"version":1, "bookIds":book_ids,
            "folders":source["folders"].as_array().cloned().unwrap_or_default(),
            "preferences":source["preferences"].as_object().cloned().unwrap_or_default()})
    }
    fn book_dir(&self, id: &str) -> PathBuf { self.directory.join("books").join(id) }
    fn library(&self) -> ApiResult<Value> { Ok(Self::normalize(read_json(&self.directory.join("library.json"), Self::empty())?)) }

    fn snapshot(&self) -> ApiResult<Value> {
        let _guard = self.lock.lock().unwrap();
        let library = self.library()?;
        let mut books = Vec::new();
        let mut annotations = Map::new();
        for id in library["bookIds"].as_array().unwrap() {
            let id = id.as_str().unwrap();
            let book = read_json(&self.book_dir(id).join("record.json"), Value::Null)?;
            if !book.is_null() {
                books.push(book);
                annotations.insert(id.into(), read_json(&self.book_dir(id).join("annotations.json"), json!([]))?);
            }
        }
        Ok(json!({"version":1,"books":books,"folders":library["folders"],"annotations":annotations,"preferences":library["preferences"]}))
    }

    fn pdf_path(&self, value: &str) -> ApiResult<PathBuf> {
        let id = require_id(&json!(value), "bookId")?;
        Ok(self.book_dir(&id).join("book.pdf"))
    }

    fn write_pdf(&self, id: &str, reader: &mut dyn Read) -> ApiResult<()> {
        let _guard = self.lock.lock().unwrap();
        atomic_stream(&self.pdf_path(id)?, reader, 1024 * 1024 * 1024).map(|_| ())
    }

    fn annotations(book_id: &str, records: &Value) -> ApiResult<Value> {
        let empty = Vec::new();
        let records = if records.is_null() { &empty } else { records.as_array().ok_or_else(|| ApiError::new(400, "批注列表不合法"))? };
        let mut normalized = Vec::new();
        for record in records {
            let id = require_id(&record["id"], "annotation.id")?;
            let mut record = record.as_object().cloned().ok_or_else(|| ApiError::new(400, "批注不合法"))?;
            record.insert("bookId".into(), json!(book_id));
            record.insert("storageKey".into(), json!(format!("{book_id}:{id}")));
            normalized.push(Value::Object(record));
        }
        Ok(json!(normalized))
    }

    fn command(&self, payload: Value) -> ApiResult<Value> {
        let _guard = self.lock.lock().unwrap();
        let mut library = self.library()?;
        match payload["action"].as_str().unwrap_or("") {
            "putBook" | "updateBookAndAnnotations" => {
                let id = require_id(&payload["book"]["id"], "book.id")?;
                let mut book = payload["book"].as_object().cloned().ok_or_else(|| ApiError::new(400, "电子书信息不合法"))?;
                book.remove("pdfBlob"); book.remove("pdfUrl");
                let annotations = if payload["action"] == "updateBookAndAnnotations" { Some(Self::annotations(&id, &payload["records"])?) } else { None };
                atomic_json(&self.book_dir(&id).join("record.json"), &Value::Object(book))?;
                if let Some(records) = annotations { atomic_json(&self.book_dir(&id).join("annotations.json"), &records)?; }
                let book_ids = library["bookIds"].as_array_mut().unwrap();
                if !book_ids.contains(&json!(id)) { book_ids.push(json!(id)); }
            }
            "deleteBooks" => {
                let selected = ids(&payload["ids"])?;
                library["bookIds"].as_array_mut().unwrap().retain(|id| !selected.iter().any(|selected| id.as_str() == Some(selected)));
                for id in selected { remove_directory(&self.book_dir(&id))?; }
            }
            "putFolder" => {
                let id = require_id(&payload["folder"]["id"], "folder.id")?;
                let folders = library["folders"].as_array_mut().unwrap();
                if let Some(folder) = folders.iter_mut().find(|folder| folder["id"] == id) { *folder = payload["folder"].clone(); }
                else { folders.push(payload["folder"].clone()); }
            }
            "deleteFolder" => {
                let id = require_id(&payload["id"], "folderId")?;
                library["folders"].as_array_mut().unwrap().retain(|folder| folder["id"] != id);
            }
            "moveBooks" => {
                let selected = ids(&payload["ids"])?;
                let folder = if payload["folderId"].is_null() { Value::Null } else { json!(require_id(&payload["folderId"], "folderId")?) };
                for id in selected {
                    let path = self.book_dir(&id).join("record.json");
                    let mut book = read_json(&path, Value::Null)?;
                    if let Some(book) = book.as_object_mut() { book.insert("folderId".into(), folder.clone()); atomic_json(&path, &json!(book))?; }
                }
            }
            "replaceAnnotations" => {
                let id = require_id(&payload["bookId"], "bookId")?;
                atomic_json(&self.book_dir(&id).join("annotations.json"), &Self::annotations(&id, &payload["records"])?)?;
            }
            "setPreference" => {
                let key = payload["key"].as_str().unwrap_or("");
                if !key.starts_with("s2e-") || key.len() < 5 || !key[4..].bytes().all(|byte| byte.is_ascii_alphanumeric() || b":_-".contains(&byte)) {
                    return Err(ApiError::new(400, "preference key 不合法"));
                }
                let value = match &payload["value"] { Value::String(value) => value.clone(), Value::Null => String::new(), value => value.to_string() };
                library["preferences"].as_object_mut().unwrap().insert(key.into(), json!(value));
            }
            _ => return Err(ApiError::new(400, "不支持此存储操作")),
        }
        atomic_json(&self.directory.join("library.json"), &library)?;
        Ok(json!({"ok":true}))
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct Upload { id: String, name: String, pages: u64, size: u64, #[serde(default)] url: String }

#[derive(Clone, Serialize, Deserialize, PartialEq)]
struct OutputFile { kind: String, name: String, size: u64, url: String }

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Job {
    id: String, upload: Upload, status: String, model: String, workers: u64,
    page_start: u64, page_end: u64, stage: String, progress: f64, message: String,
    error: Option<String>, #[serde(default)] usage: Option<Value>, files: Vec<OutputFile>,
    started_at: u64, finished_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")] current: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")] total: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pdf_page: Option<u64>,
}

struct Process {
    child: Mutex<Child>, done: Mutex<bool>, finished: Condvar,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl Process {
    fn new(child: Child) -> Self { Self { child: Mutex::new(child), done: Mutex::new(false), finished: Condvar::new(), worker: Mutex::new(None) } }
    fn kill(&self) {
        if *self.done.lock().unwrap() { return; }
        #[cfg(unix)] {
            let group = -(self.child.lock().unwrap().id() as i32);
            // 引擎与打包子进程共用独立组，父进程退出后也必须收回组内子进程。
            unsafe { libc::kill(group, libc::SIGTERM); }
            let deadline = Instant::now() + Duration::from_millis(500);
            loop {
                let _ = self.child.lock().unwrap().try_wait();
                if unsafe { libc::kill(group, 0) } != 0 { return; }
                if Instant::now() >= deadline { break; }
                thread::sleep(Duration::from_millis(15));
            }
            unsafe { libc::kill(group, libc::SIGKILL); }
            let deadline = Instant::now() + Duration::from_millis(500);
            while Instant::now() < deadline {
                let _ = self.child.lock().unwrap().try_wait();
                if unsafe { libc::kill(group, 0) } != 0 { break; }
                thread::sleep(Duration::from_millis(15));
            }
        }
        #[cfg(not(unix))] {
            let mut child = self.child.lock().unwrap();
            if matches!(child.try_wait(), Ok(None)) { let _ = child.kill(); }
        }
    }
    fn finish(&self) { *self.done.lock().unwrap() = true; self.finished.notify_all(); }
    fn wait(&self) {
        let mut done = self.done.lock().unwrap();
        while !*done { done = self.finished.wait(done).unwrap(); }
        drop(done);
        if let Some(worker) = self.worker.lock().unwrap().take() { let _ = worker.join(); }
    }
    fn exit_code(&self, deadline: Option<Instant>) -> bool {
        loop {
            match self.child.lock().unwrap().try_wait() { Ok(Some(status)) => return status.success(), Err(_) => return false, Ok(None) => {} }
            if deadline.map(|deadline| Instant::now() >= deadline).unwrap_or(false) { self.kill(); }
            thread::sleep(Duration::from_millis(15));
        }
    }
}

struct ConversionState {
    uploads: BTreeMap<String, Upload>, jobs: Vec<Job>, children: HashMap<String, Arc<Process>>,
    inspections: HashMap<String, Arc<Process>>, details: HashMap<String, String>, closing: bool,
}

struct Shared { directory: PathBuf, command: Vec<String>, state: Mutex<ConversionState> }

fn upload_url(id: &str) -> String { format!("{API}/uploads/{id}/pdf") }
fn stem(name: &str) -> &str { &name[..name.len() - 4] }
fn remove_directory(path: &Path) -> ApiResult<()> {
    match fs::symlink_metadata(path) {
        Ok(info) if info.is_dir() => fs::remove_dir_all(path).map_err(Into::into),
        Ok(_) => fs::remove_file(path).map_err(Into::into),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}
fn directory_bytes(path: &Path) -> ApiResult<u64> {
    match fs::symlink_metadata(path) {
        Ok(info) if info.is_dir() => fs::read_dir(path)?.try_fold(0, |total, child| Ok(total + directory_bytes(&child?.path())?)),
        Ok(info) => Ok(info.len()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(0),
        Err(error) => Err(error.into()),
    }
}

fn cleanup_work(output: &Path) -> ApiResult<()> {
    let entries = match fs::read_dir(output) { Ok(entries) => entries, Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()), Err(error) => return Err(error.into()) };
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name();
        if name.to_str().and_then(|name| name.strip_prefix(".work-")).map(valid_uuid).unwrap_or(false) && entry.file_type()?.is_dir() {
            remove_directory(&entry.path())?;
        }
    }
    Ok(())
}

impl Shared {
    fn new(directory: PathBuf, command: Vec<String>) -> ApiResult<Self> {
        let shared = Self { directory, command, state: Mutex::new(ConversionState { uploads: BTreeMap::new(), jobs: Vec::new(), children: HashMap::new(), inspections: HashMap::new(), details: HashMap::new(), closing: false }) };
        let saved = read_json(&shared.directory.join("state.json"), Value::Null)?;
        if !saved.is_null() {
            if saved["version"] != 1 || !saved["uploads"].is_array() || !saved["jobs"].is_array() { return Err(ApiError::new(500, "转换历史记录格式无法识别")); }
            let mut state = shared.state.lock().unwrap();
            for info in saved["uploads"].as_array().unwrap() {
                if let Ok(mut upload) = serde_json::from_value::<Upload>(info.clone()) {
                    if !valid_uuid(&upload.id) || upload.pages == 0 || upload.size < 5 || !upload.name.to_ascii_lowercase().ends_with(".pdf")
                        || upload.name.contains(['/', '\\']) || upload.name.chars().any(char::is_control) { continue; }
                    upload.url = upload_url(&upload.id);
                    state.uploads.insert(upload.id.clone(), upload);
                }
            }
            for info in saved["jobs"].as_array().unwrap() {
                let Some(upload) = info["uploadId"].as_str().and_then(|id| state.uploads.get(id)) else { continue; };
                let mut info = info.clone();
                info["upload"] = json!(upload);
                let Ok(mut job) = serde_json::from_value::<Job>(info) else { continue; };
                if !valid_uuid(&job.id) || !["running", "completed", "failed", "cancelled", "interrupted"].contains(&job.status.as_str())
                    || job.page_start < 1 || job.page_end < job.page_start || job.page_end > upload.pages { continue; }
                if job.status == "running" {
                    job.status = "interrupted".into(); job.message = "服务已停止，请重新转换".into(); job.error = Some(job.message.clone());
                    job.finished_at = Some(now()); job.files.clear();
                }
                cleanup_work(&shared.job_dir(&job.id))?;
                shared.refresh_files(&mut job);
                state.jobs.push(job);
            }
            shared.persist(&state)?;
        }
        Ok(shared)
    }

    fn upload_path(&self, upload: &Upload) -> PathBuf { self.directory.join("uploads").join(&upload.id).join(&upload.name) }
    fn job_dir(&self, id: &str) -> PathBuf { self.directory.join("jobs").join(id) }
    fn engine_command(&self) -> Command {
        let mut command = Command::new(&self.command[0]);
        command.args(&self.command[1..]);
        #[cfg(unix)] { use std::os::unix::process::CommandExt; command.process_group(0); }
        command
    }

    fn persist(&self, state: &ConversionState) -> ApiResult<()> {
        let uploads: Vec<Value> = state.uploads.values().map(|upload| json!({"id":upload.id,"name":upload.name,"pages":upload.pages,"size":upload.size})).collect();
        let jobs: Vec<Value> = state.jobs.iter().map(|job| {
            let mut record = json!(job);
            record.as_object_mut().unwrap().remove("upload");
            record["uploadId"] = json!(job.upload.id);
            record
        }).collect();
        atomic_json(&self.directory.join("state.json"), &json!({"version":1,"uploads":uploads,"jobs":jobs}))
    }

    fn public_job(state: &ConversionState, job: &Job) -> Value {
        let mut info = json!(job);
        if let Some(detail) = state.details.get(&job.id).filter(|_| job.status == "failed") { info["error"] = json!(detail); }
        info
    }

    fn refresh_files(&self, job: &mut Job) -> bool {
        if job.status != "completed" { return false; }
        let files: Vec<OutputFile> = job.files.iter().filter(|file| KINDS.contains(&file.kind.as_str())).filter_map(|file| {
            let name = format!("{}.{}", stem(&job.upload.name), file.kind);
            let info = fs::metadata(self.job_dir(&job.id).join(&name)).ok()?;
            if !info.is_file() || info.len() == 0 { return None; }
            Some(OutputFile { kind: file.kind.clone(), name, size: info.len(), url: format!("{API}/jobs/{}/files/{}", job.id, file.kind) })
        }).collect();
        let changed = files != job.files;
        job.files = files;
        if !job.files.iter().any(|file| file.kind == "s2e") {
            job.status = "failed".into(); job.message = "电子书文件已丢失".into(); job.error = Some("电子书文件已丢失，请重新转换".into()); job.files.clear();
            return true;
        }
        changed
    }

    fn snapshot(&self) -> ApiResult<Value> {
        let mut state = self.state.lock().unwrap();
        let mut changed = false;
        for job in &mut state.jobs { changed |= self.refresh_files(job); }
        if changed { self.persist(&state)?; }
        let jobs: Vec<Value> = state.jobs.iter().rev().map(|job| Self::public_job(&state, job)).collect();
        Ok(json!({"available":!self.command.is_empty(),"maxFileBytes":MAX_PDF,"message":if self.command.is_empty() {"尚未安装转换器"} else {"转换服务已就绪"},"jobs":jobs}))
    }

    fn job(&self, id: &str) -> ApiResult<Value> {
        let mut state = self.state.lock().unwrap();
        let index = state.jobs.iter().position(|job| job.id == id).ok_or_else(|| ApiError::new(404, "找不到这项转换任务"))?;
        if self.refresh_files(&mut state.jobs[index]) { self.persist(&state)?; }
        Ok(Self::public_job(&state, &state.jobs[index]))
    }

    fn inspect(self: &Arc<Self>, file: &Path) -> ApiResult<u64> {
        let id = Uuid::new_v4().to_string();
        let (process, stdout) = {
            let mut state = self.state.lock().unwrap();
            if state.closing { return Err(ApiError::new(503, "转换服务正在退出")); }
            let mut child = self.engine_command().arg("inspect").arg(file)
                .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn()
                .map_err(|_| ApiError::new(503, "转换器无法启动，请重新安装应用后重试"))?;
            let stdout = child.stdout.take().unwrap();
            let process = Arc::new(Process::new(child));
            state.inspections.insert(id.clone(), process.clone());
            (process, stdout)
        };
        let reader = thread::spawn(move || { let mut bytes = Vec::new(); stdout.take(64 * 1024 + 1).read_to_end(&mut bytes).map(|_| bytes) });
        let success = process.exit_code(Some(Instant::now() + Duration::from_secs(30)));
        process.kill();
        let bytes = reader.join().ok().and_then(Result::ok).unwrap_or_default();
        let mut state = self.state.lock().unwrap();
        state.inspections.remove(&id);
        process.finish();
        if state.closing { return Err(ApiError::new(503, "转换服务正在退出")); }
        let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        if !success || bytes.len() > 64 * 1024 || value["ok"] != true { return Err(ApiError::new(400, "无法读取这份 PDF，请确认文件未损坏、未加密且至少有一页")); }
        value["pages"].as_u64().filter(|pages| *pages > 0).ok_or_else(|| ApiError::new(400, "PDF 页数无法读取"))
    }

    fn upload(self: &Arc<Self>, name: &str, reader: &mut dyn Read) -> ApiResult<Value> {
        if self.command.is_empty() { return Err(ApiError::new(503, "尚未安装转换器")); }
        if self.state.lock().unwrap().closing { return Err(ApiError::new(503, "转换服务正在退出")); }
        let name = name.rsplit('/').next().unwrap_or("扫描书.pdf");
        if !name.to_ascii_lowercase().ends_with(".pdf") { return Err(ApiError::new(400, "请选择 .pdf 文件")); }
        let chars: Vec<char> = name.chars().map(|character| if character.is_control() || "<>:\"|?*\\".contains(character) { '_' } else { character }).collect();
        let name: String = chars[chars.len().saturating_sub(180)..].iter().collect();
        let id = Uuid::new_v4().to_string();
        let root = self.directory.join("uploads").join(&id);
        let file = root.join(&name);
        let result = (|| {
            let size = atomic_stream(&file, reader, MAX_PDF)?;
            let mut header = [0; 5];
            if File::open(&file)?.read_exact(&mut header).is_err() || &header != b"%PDF-" { return Err(ApiError::new(400, "这个文件不是有效的 PDF，请重新选择")); }
            let pages = self.inspect(&file)?;
            let upload = Upload { id: id.clone(), name, pages, size, url: upload_url(&id) };
            let mut state = self.state.lock().unwrap();
            if state.closing { return Err(ApiError::new(503, "转换服务正在退出")); }
            state.uploads.insert(id.clone(), upload.clone());
            if let Err(error) = self.persist(&state) { state.uploads.remove(&id); return Err(error); }
            Ok(json!(upload))
        })();
        if result.is_err() { let _ = remove_directory(&root); }
        result
    }

    fn start_job(self: &Arc<Self>, args: Value) -> ApiResult<Value> {
        let mut state = self.state.lock().unwrap();
        if state.closing { return Err(ApiError::new(503, "转换服务正在退出，请重新打开应用")); }
        if self.command.is_empty() { return Err(ApiError::new(503, "尚未安装转换器")); }
        if !state.children.is_empty() { return Err(ApiError::new(409, "已有任务正在转换，请等待完成或先取消")); }
        let upload = args["uploadId"].as_str().and_then(|id| state.uploads.get(id)).cloned().ok_or_else(|| ApiError::new(400, "请重新选择 PDF 文件"))?;
        let first = args.get("pageStart").map(|value| value.as_u64()).unwrap_or(Some(1)).unwrap_or(0);
        let last = args.get("pageEnd").map(|value| value.as_u64()).unwrap_or(Some(upload.pages)).unwrap_or(0);
        if first < 1 || last < first || last > upload.pages { return Err(ApiError::new(400, format!("页码范围应在 1–{} 之间，起始页不能大于结束页", upload.pages))); }
        let key = args["apiKey"].as_str().unwrap_or("").trim().to_owned();
        if key.is_empty() { return Err(ApiError::new(400, "请填写本次转换使用的 API Key")); }
        let workers = args.get("workers").map(|value| value.as_u64()).unwrap_or(Some(6)).unwrap_or(0);
        if !(1..=16).contains(&workers) { return Err(ApiError::new(400, "并发数应为 1–16 的整数")); }
        let model = args["model"].as_str().unwrap_or("deepseek-flash").trim().to_owned();
        if model.is_empty() || model.chars().count() > 150 { return Err(ApiError::new(400, "请填写有效的模型名称")); }
        if !self.upload_path(&upload).is_file() { return Err(ApiError::new(404, "原始 PDF 已丢失，请重新选择 PDF 文件")); }
        let id = Uuid::new_v4().to_string();
        let out = self.job_dir(&id);
        fs::create_dir_all(&out)?;
        state.jobs.push(Job { id: id.clone(), upload: upload.clone(), status: "running".into(), model: model.clone(), workers,
            page_start: first, page_end: last, stage: "start".into(), progress: 0.0, message: "正在准备转换".into(), error: None,
            usage: None, files: Vec::new(), started_at: now(), finished_at: None, current: None, total: None, pdf_page: None });
        if let Err(error) = self.persist(&state) { state.jobs.pop(); let _ = remove_directory(&out); return Err(error); }
        let child = self.engine_command().arg(self.upload_path(&upload)).arg("-o").arg(out)
            .args(["--page-start", &first.to_string(), "--page-end", &last.to_string(), "--vision-model", &model, "--workers", &workers.to_string(), "--progress-json"])
            .env("DEEPSEEK_API_KEY", &key)
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn();
        match child {
            Ok(mut child) => {
                let stdout = child.stdout.take().unwrap();
                let process = Arc::new(Process::new(child));
                state.children.insert(id.clone(), process.clone());
                let shared = self.clone(); let job_id = id.clone(); let worker_process = process.clone();
                let worker = thread::spawn(move || shared.monitor(job_id, worker_process, stdout, key));
                *process.worker.lock().unwrap() = Some(worker);
            }
            Err(_) => {
                let job = state.jobs.last_mut().unwrap();
                job.status = "failed".into(); job.message = "转换未能开始".into(); job.error = Some("转换器无法启动，请重新安装应用后重试".into()); job.finished_at = Some(now());
                self.persist(&state)?;
            }
        }
        Ok(Self::public_job(&state, state.jobs.last().unwrap()))
    }

    fn monitor(self: Arc<Self>, id: String, process: Arc<Process>, stdout: impl Read, key: String) {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut line = Vec::new();
            match reader.by_ref().take(64 * 1024).read_until(b'\n', &mut line) { Ok(0) | Err(_) => break, Ok(_) => {} }
            let Some(event) = line.strip_prefix(b"S2E_EVENT ").and_then(|line| serde_json::from_slice::<Value>(line).ok()) else { continue; };
            let mut state = self.state.lock().unwrap();
            let Some(index) = state.jobs.iter().position(|job| job.id == id && job.status == "running") else { continue; };
            let message = event["message"].as_str().map(|message| tail(&message.replace(&key, "[已隐藏]"), 1200));
            if event["stage"] == "failed" {
                if let Some(message) = message { state.details.insert(id.clone(), message); }
            } else {
                let job = &mut state.jobs[index];
                if let Some(stage) = event["stage"].as_str().filter(|stage| ["start", "ocr", "structure", "finalize", "complete"].contains(stage)) { job.stage = stage.into(); }
                if let Some(progress) = event["progress"].as_f64().filter(|progress| progress.is_finite()) { job.progress = job.progress.max(progress.min(99.0)); }
                if let Some(message) = message { job.message = message; }
                if let Some(value) = event["current"].as_u64() { job.current = Some(value); }
                if let Some(value) = event["total"].as_u64() { job.total = Some(value); }
                if let Some(value) = event["pdf_page"].as_u64() { job.pdf_page = Some(value); }
                if event["usage"].is_object() { job.usage = Some(json!({"requests":event["usage"]["requests"].as_u64().unwrap_or(0),"input_tokens":event["usage"]["input_tokens"].as_u64().unwrap_or(0),"output_tokens":event["usage"]["output_tokens"].as_u64().unwrap_or(0)})); }
            }
            let _ = self.persist(&state);
        }
        let success = process.exit_code(None);
        process.kill();
        let _ = cleanup_work(&self.job_dir(&id));
        let mut state = self.state.lock().unwrap();
        if let Some(job) = state.jobs.iter_mut().find(|job| job.id == id) {
            if job.status == "running" {
                job.finished_at = Some(now());
                if success {
                    job.files = KINDS.iter().filter_map(|kind| {
                        let name = format!("{}.{kind}", stem(&job.upload.name));
                        let info = fs::metadata(self.job_dir(&id).join(&name)).ok()?;
                        if !info.is_file() || info.len() == 0 { return None; }
                        Some(OutputFile { kind: (*kind).into(), name, size: info.len(), url: format!("{API}/jobs/{id}/files/{kind}") })
                    }).collect();
                    if job.files.iter().any(|file| file.kind == "s2e") {
                        job.status = "completed".into(); job.progress = 100.0; job.stage = "complete".into(); job.message = "电子书已准备好".into();
                    } else { job.status = "failed".into(); job.message = "电子书文件未生成".into(); job.error = Some("转换器没有生成完整的 .s2e 文件，请重试".into()); }
                } else { job.status = "failed".into(); job.message = "转换未完成".into(); job.error = Some(FAILURE.into()); }
            }
        }
        state.children.remove(&id);
        let _ = self.persist(&state);
        process.finish();
    }

    fn cancel(&self, id: &str) -> ApiResult<Value> {
        let process = {
            let mut state = self.state.lock().unwrap();
            let job = state.jobs.iter_mut().find(|job| job.id == id).ok_or_else(|| ApiError::new(404, "找不到这项转换任务"))?;
            if job.status == "running" { job.status = "cancelled".into(); job.message = "已取消，文件已保留，可重新转换".into(); job.finished_at = Some(now()); self.persist(&state)?; }
            state.children.get(id).cloned()
        };
        if let Some(process) = process { process.kill(); process.wait(); }
        self.job(id)
    }

    fn remove(&self, id: Option<&str>, keep_upload: Option<&str>) -> ApiResult<Value> {
        let mut state = self.state.lock().unwrap();
        let selected: HashSet<String> = if let Some(id) = id {
            let job = state.jobs.iter().find(|job| job.id == id).ok_or_else(|| ApiError::new(404, "找不到这项转换任务"))?;
            if job.status == "running" || state.children.contains_key(id) { return Err(ApiError::new(409, "任务仍在运行或退出中，请稍后再删除")); }
            [id.to_owned()].into_iter().collect()
        } else { state.jobs.iter().filter(|job| job.status != "running" && !state.children.contains_key(&job.id)).map(|job| job.id.clone()).collect() };
        let selected_uploads: HashSet<String> = state.jobs.iter().filter(|job| selected.contains(&job.id)).map(|job| job.upload.id.clone()).collect();
        let referenced: HashSet<String> = state.jobs.iter().filter(|job| !selected.contains(&job.id)).map(|job| job.upload.id.clone()).collect();
        let uploads: Vec<String> = state.uploads.keys().filter(|upload|
            Some(upload.as_str()) != keep_upload && !referenced.contains(*upload) && (id.is_none() || selected_uploads.contains(*upload))
        ).cloned().collect();
        let mut freed = 0;
        for id in &selected { let root = self.job_dir(id); freed += directory_bytes(&root)?; remove_directory(&root)?; }
        state.jobs.retain(|job| !selected.contains(&job.id));
        for id in &selected { state.details.remove(id); }
        for id in &uploads { let root = self.directory.join("uploads").join(id); freed += directory_bytes(&root)?; remove_directory(&root)?; state.uploads.remove(id); }
        self.persist(&state)?;
        Ok(json!({"removedJobs":selected.len(),"removedUploads":uploads.len(),"freedBytes":freed}))
    }

    fn close(&self) {
        let processes = {
            let mut state = self.state.lock().unwrap();
            state.closing = true;
            for job in &mut state.jobs {
                if job.status == "running" { job.status = "cancelled".into(); job.message = "已取消，文件已保留，可重新转换".into(); job.finished_at = Some(now()); }
            }
            let _ = self.persist(&state);
            state.children.values().chain(state.inspections.values()).cloned().collect::<Vec<_>>()
        };
        for process in &processes { process.kill(); }
        for process in processes { process.wait(); }
    }
}

fn tail(text: &str, count: usize) -> String { text.chars().rev().take(count).collect::<Vec<_>>().into_iter().rev().collect() }
fn header(request: &Request, name: &'static str) -> Option<String> { request.headers().iter().find(|header| header.field.equiv(name)).map(|header| header.value.as_str().to_owned()) }
fn mime(path: &Path) -> &'static str {
    match path.extension().and_then(|value| value.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8", "js" | "mjs" => "text/javascript; charset=utf-8", "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8", "pdf" => "application/pdf", "svg" => "image/svg+xml", "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg", "gif" => "image/gif", "webp" => "image/webp", "ico" => "image/x-icon",
        "woff" => "font/woff", "woff2" => "font/woff2", _ => "application/octet-stream",
    }
}
fn response(status: u16, body: Vec<u8>, content_type: &str, cache: &str) -> HttpResponse {
    let length = body.len();
    Response::new(StatusCode(status), vec![
        Header::from_bytes("content-type", content_type).unwrap(), Header::from_bytes("cache-control", cache).unwrap(),
        Header::from_bytes("x-content-type-options", "nosniff").unwrap(), Header::from_bytes("cross-origin-resource-policy", "same-origin").unwrap(),
    ], Box::new(Cursor::new(body)), Some(length), None)
}
fn json_response(status: u16, body: Value) -> HttpResponse { response(status, serde_json::to_vec(&body).unwrap(), "application/json; charset=utf-8", "no-store") }
fn file_response(path: &Path, content_type: &str, cache: &str) -> ApiResult<HttpResponse> {
    let file = File::open(path).map_err(|_| ApiError::new(404, "文件已丢失或不存在，请重新选择或转换"))?;
    let info = file.metadata()?;
    if !info.is_file() { return Err(ApiError::new(404, "文件不存在")); }
    let mut response = response(200, Vec::new(), content_type, cache);
    response = Response::new(StatusCode(200), response.headers().to_vec(), Box::new(file), Some(info.len() as usize), None);
    Ok(response)
}
fn body_limit(request: &Request, limit: u64) -> ApiResult<()> {
    if request.body_length().map(|length| length as u64 > limit).unwrap_or(false) { Err(ApiError::new(413, "文件或请求内容过大")) } else { Ok(()) }
}
fn payload(request: &mut Request, limit: u64) -> ApiResult<Value> {
    if header(request, "content-type").as_deref().unwrap_or("").split(';').next() != Some("application/json") { return Err(ApiError::new(415, "请求格式应为 JSON")); }
    body_limit(request, limit)?;
    let mut bytes = Vec::new();
    request.as_reader().take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit { return Err(ApiError::new(413, "请求内容过大")); }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| ApiError::new(400, "请求内容无法读取"))?;
    if !value.is_object() { return Err(ApiError::new(400, "请求内容应为 JSON 对象")); }
    Ok(value)
}

fn route(request: &mut Request, shared: &Arc<Shared>, storage: &Storage, dist: &Path, host: &str) -> ApiResult<HttpResponse> {
    if request.headers().iter().filter(|header| header.field.equiv("host")).count() != 1 || header(request, "host").as_deref() != Some(host)
        || header(request, "origin").map(|origin| origin != format!("http://{host}")).unwrap_or(false)
        || header(request, "sec-fetch-site").map(|site| !["same-origin", "none"].contains(&site.as_str())).unwrap_or(false) {
        return Err(ApiError::new(403, "拒绝跨源访问本地服务"));
    }
    let target = request.url().split('?').next().unwrap_or("/");
    let path = percent_decode_str(target).decode_utf8().map_err(|_| ApiError::new(400, "请求地址无法读取"))?.into_owned();
    if !path.starts_with('/') || path.contains(['\\', '\0']) { return Err(ApiError::new(400, "请求地址不合法")); }
    let method = request.method().clone();
    if path == "/__scan2ebook__/health" {
        if method != Method::Get && method != Method::Head { return Err(ApiError::new(405, "不支持此操作")); }
        return Ok(json_response(200, json!({
            "app": "scan2ebook-reader", "version": env!("CARGO_PKG_VERSION"), "storageDir": storage.directory,
            "apiVersion": API_VERSION, "edition": EDITION, "pid": std::process::id()
        })));
    }
    if path == STORAGE {
        if method != Method::Get && method != Method::Head { return Err(ApiError::new(405, "不支持此操作")); }
        return Ok(json_response(200, storage.snapshot()?));
    }
    if path == format!("{STORAGE}/command") {
        if method != Method::Post { return Err(ApiError::new(405, "不支持此操作")); }
        return Ok(json_response(200, storage.command(payload(request, 128 * 1024 * 1024)?)?));
    }
    if let Some(id) = path.strip_prefix(&format!("{STORAGE}/books/")).and_then(|value| value.strip_suffix("/pdf")) {
        let file = storage.pdf_path(id)?;
        if method == Method::Get || method == Method::Head { return file_response(&file, "application/pdf", "no-store"); }
        if method == Method::Put { body_limit(request, 1024 * 1024 * 1024)?; storage.write_pdf(id, request.as_reader())?; return Ok(json_response(200, json!({"ok":true}))); }
        return Err(ApiError::new(405, "不支持此操作"));
    }
    if path == API || path.starts_with(&format!("{API}/")) {
        let path = path.strip_prefix(API).unwrap();
        if (path.is_empty() || path == "/") && method == Method::Get { return Ok(json_response(200, shared.snapshot()?)); }
        if path == "/uploads" && method == Method::Post {
            if header(request, "content-type").as_deref().unwrap_or("").split(';').next() != Some("application/pdf") { return Err(ApiError::new(415, "请选择 PDF 文件")); }
            body_limit(request, MAX_PDF)?;
            let name = header(request, "x-s2e-filename").unwrap_or_else(|| "%E6%89%AB%E6%8F%8F%E4%B9%A6.pdf".into());
            let name = percent_decode_str(&name).decode_utf8().map_err(|_| ApiError::new(400, "文件名无法读取"))?;
            return Ok(json_response(201, shared.upload(&name, request.as_reader())?));
        }
        if path == "/jobs" && method == Method::Post { return Ok(json_response(202, shared.start_job(payload(request, 16 * 1024)?)?)); }
        if path == "/cleanup" && method == Method::Post {
            let args = payload(request, 16 * 1024)?;
            return Ok(json_response(200, shared.remove(None, args["keepUploadId"].as_str())?));
        }
        if let Some(upload_path) = path.strip_prefix("/uploads/") {
            let (id, pdf) = match upload_path.split_once('/') {
                None => (upload_path, false),
                Some((id, "pdf")) => (id, true),
                _ => return Err(ApiError::new(404, "找不到此转换接口")),
            };
            if method != Method::Get { return Err(ApiError::new(405, "不支持此操作")); }
            let state = shared.state.lock().unwrap();
            let upload = state.uploads.get(id).ok_or_else(|| ApiError::new(404, "找不到这份 PDF，请重新选择文件"))?;
            if pdf { return file_response(&shared.upload_path(upload), "application/pdf", "no-store"); }
            return Ok(json_response(200, json!(upload)));
        }
        if let Some(job_path) = path.strip_prefix("/jobs/") {
            let parts: Vec<&str> = job_path.split('/').collect();
            match parts.as_slice() {
                [id] if method == Method::Get => return Ok(json_response(200, shared.job(id)?)),
                [id] if method == Method::Delete => return Ok(json_response(200, shared.remove(Some(id), None)?)),
                [id, "cancel"] if method == Method::Post => { payload(request, 16 * 1024)?; return Ok(json_response(200, shared.cancel(id)?)); }
                [id, "files", kind] if method == Method::Get => {
                    shared.job(id)?;
                    let state = shared.state.lock().unwrap();
                    let job = state.jobs.iter().find(|job| job.id == *id).ok_or_else(|| ApiError::new(404, "找不到这项转换任务"))?;
                    let file = job.files.iter().find(|file| file.kind == *kind && job.status == "completed").ok_or_else(|| ApiError::new(404, "文件尚未生成或不存在"))?;
                    let mut response = file_response(&shared.job_dir(id).join(&file.name), "application/octet-stream", "no-store")?;
                    response.add_header(Header::from_bytes("content-disposition", format!("attachment; filename=\"book.{}\"; filename*=UTF-8''{}", file.kind, utf8_percent_encode(&file.name, NON_ALPHANUMERIC))).unwrap());
                    return Ok(response);
                }
                _ => return Err(ApiError::new(404, "找不到这项转换任务或操作")),
            }
        }
        return Err(ApiError::new(404, "找不到此转换接口"));
    }
    if method != Method::Get && method != Method::Head { return Err(ApiError::new(405, "不支持此操作")); }
    let target = dist.join(if path == "/" { "index.html" } else { path.trim_start_matches('/') });
    if Path::new(&path).components().any(|component| matches!(component, std::path::Component::ParentDir)) { return Err(ApiError::new(400, "请求地址超出应用目录")); }
    let target = fs::canonicalize(target).map_err(|_| ApiError::new(404, "文件不存在"))?;
    if !target.starts_with(dist) { return Err(ApiError::new(400, "请求地址超出应用目录")); }
    let cache = if path.starts_with("/assets/") { "public, max-age=31536000, immutable" } else { "no-cache" };
    file_response(&target, mime(&target), cache)
}

fn automation_descriptor(url: &str) -> Value {
    json!({ "url": url, "apiVersion": API_VERSION, "edition": EDITION, "pid": std::process::id() })
}

fn with_automation_lock(path: &Path, update: impl FnOnce(&Path) -> ApiResult<()>) -> ApiResult<()> {
    #[cfg(unix)]
    let _lock = {
        use std::os::fd::AsRawFd;
        // 锁定数据目录，避免另一实例在核对归属后、删除前替换发现文件。
        let directory = File::open(path.parent().unwrap())?;
        if unsafe { libc::flock(directory.as_raw_fd(), libc::LOCK_EX) } != 0 {
            return Err(io::Error::last_os_error().into());
        }
        directory
    };
    update(path)
}

pub struct Backend {
    pub url: String,
    automation_path: Option<PathBuf>,
    shared: Arc<Shared>, server: Option<Arc<Server>>, listener: Option<JoinHandle<()>>, stopping: Arc<AtomicBool>,
}

pub fn start(data_dir: PathBuf, dist_dir: PathBuf, converter_command: Vec<String>) -> Result<Backend, String> {
    let dist = fs::canonicalize(dist_dir).map_err(|_| "未找到应用界面，请重新安装应用".to_owned())?;
    if !dist.join("index.html").is_file() { return Err("未找到应用界面，请重新安装应用".into()); }
    let storage = Arc::new(Storage::new(data_dir.clone()).map_err(|error| error.message)?);
    let shared = Arc::new(Shared::new(data_dir.join("conversions"), converter_command).map_err(|error| error.message)?);
    let server = Arc::new(Server::http("127.0.0.1:0").map_err(|_| "无法启动本地服务，请重新打开应用".to_owned())?);
    let host = server.server_addr().to_string();
    let url = format!("http://{host}");
    let stopping = Arc::new(AtomicBool::new(false));
    let thread_server = server.clone(); let thread_stopping = stopping.clone(); let thread_shared = shared.clone();
    let listener = thread::spawn(move || {
        while !thread_stopping.load(Ordering::Acquire) {
            match thread_server.recv_timeout(Duration::from_millis(150)) {
                Ok(Some(mut request)) => {
                    if thread_stopping.load(Ordering::Acquire) { let _ = request.respond(json_response(503, json!({"error":"应用正在退出"}))); break; }
                    let shared = thread_shared.clone(); let storage = storage.clone(); let dist = dist.clone(); let host = host.clone();
                    thread::spawn(move || {
                        let response = route(&mut request, &shared, &storage, &dist, &host).unwrap_or_else(|error| json_response(error.status, json!({"error":error.message})));
                        let _ = request.respond(response);
                    });
                }
                Ok(None) => {}
                Err(_) => break,
            }
        }
    });
    let path = data_dir.join("automation.json");
    let automation_path = match with_automation_lock(&path, |path| atomic_json(path, &automation_descriptor(&url))) {
        Ok(()) => Some(path),
        Err(error) => {
            eprintln!("Scan2Ebook 无法写入自动化发现文件 {}：{}", path.display(), error.message);
            None
        }
    };
    Ok(Backend { url, automation_path, shared, server: Some(server), listener: Some(listener), stopping })
}

impl Backend {
    pub fn busy(&self) -> bool { let state = self.shared.state.lock().unwrap(); !state.children.is_empty() || !state.inspections.is_empty() }
    pub fn shutdown(&mut self) {
        if let Some(server) = self.server.take() {
            self.stopping.store(true, Ordering::Release);
            if let Some(path) = self.automation_path.take() {
                let result = with_automation_lock(&path, |path| {
                    if read_json(path, Value::Null)? == automation_descriptor(&self.url) {
                        fs::remove_file(path)?;
                    }
                    Ok(())
                });
                if let Err(error) = result {
                    eprintln!("Scan2Ebook 无法清理自动化发现文件 {}：{}", path.display(), error.message);
                }
            }
            server.unblock();
            if let Some(listener) = self.listener.take() { let _ = listener.join(); }
            drop(server);
            self.shared.close();
        }
    }
}
impl Drop for Backend { fn drop(&mut self) { self.shutdown(); } }

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::fs;
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::path::PathBuf;
    use std::thread;
    use std::time::{Duration, Instant};
    use uuid::Uuid;

    const API: &str = "/__scan2ebook__/conversion";
    const STORAGE: &str = "/__scan2ebook__/storage";
    const KEY: &str = "desktop-test-placeholder";

    struct Fixture {
        root: PathBuf,
        backend: Backend,
        command: Vec<String>,
    }

    struct Reply {
        status: u16,
        headers: String,
        body: Vec<u8>,
    }

    impl Reply {
        fn json(&self) -> Value { serde_json::from_slice(&self.body).unwrap() }
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("s2e-desktop-test-{}", Uuid::new_v4()));
            let dist = root.join("dist");
            fs::create_dir_all(dist.join("assets")).unwrap();
            fs::write(dist.join("index.html"), "<title>Desktop fixture</title>").unwrap();
            fs::write(dist.join("assets/app.js"), "console.log('fixture');").unwrap();
            let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            let fixture = if repo.join("../../reader/test/fixtures/converter.mjs").exists() {
                repo.join("../../reader/test/fixtures/converter.mjs")
            } else {
                PathBuf::from(std::env::var("S2E_BACKEND_TEST_REPO").expect("test repo")).join("reader/test/fixtures/converter.mjs")
            };
            let command = vec!["node".into(), fixture.to_string_lossy().into_owned()];
            let backend = start(root.join("data"), dist, command.clone()).unwrap();
            Self { root, backend, command }
        }

        fn restart(&mut self) {
            self.backend.shutdown();
            self.backend = start(self.root.join("data"), self.root.join("dist"), self.command.clone()).unwrap();
        }

        fn request(&self, method: &str, path: &str, body: &[u8], extra: &[(&str, &str)]) -> Reply {
            let host = self.backend.url.strip_prefix("http://").unwrap();
            let mut stream = TcpStream::connect(host).unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
            let host_header = extra.iter().find(|(key, _)| key.eq_ignore_ascii_case("host")).map(|(_, value)| *value).unwrap_or(host);
            let length = extra.iter().find(|(key, _)| key.eq_ignore_ascii_case("content-length")).map(|(_, value)| value.to_string()).unwrap_or_else(|| body.len().to_string());
            write!(stream, "{method} {path} HTTP/1.0\r\nHost: {host_header}\r\nContent-Length: {length}\r\n").unwrap();
            for (key, value) in extra {
                if !key.eq_ignore_ascii_case("host") && !key.eq_ignore_ascii_case("content-length") { write!(stream, "{key}: {value}\r\n").unwrap(); }
            }
            stream.write_all(b"\r\n").unwrap();
            stream.write_all(body).unwrap();
            let mut response = Vec::new();
            stream.read_to_end(&mut response).unwrap();
            let split = response.windows(4).position(|bytes| bytes == b"\r\n\r\n").unwrap();
            let headers = String::from_utf8_lossy(&response[..split]).into_owned();
            let status = headers.lines().next().unwrap().split_whitespace().nth(1).unwrap().parse().unwrap();
            Reply { status, headers: headers.to_ascii_lowercase(), body: response[split + 4..].to_vec() }
        }

        fn json(&self, path: &str, value: Value) -> Reply {
            self.request("POST", path, &serde_json::to_vec(&value).unwrap(), &[("content-type", "application/json")])
        }

        fn upload(&self) -> Value {
            let response = self.request("POST", &format!("{API}/uploads"), b"%PDF-1.7\nDesktop fixture", &[("content-type", "application/pdf"), ("x-s2e-filename", "sample.pdf")]);
            assert_eq!(response.status, 201, "{}", String::from_utf8_lossy(&response.body));
            response.json()
        }

        fn job(&self, upload: &Value, model: &str) -> Value {
            let response = self.json(&format!("{API}/jobs"), json!({ "uploadId": upload["id"], "apiKey": KEY, "model": model, "pageStart": 1, "pageEnd": 3, "workers": 2 }));
            assert_eq!(response.status, 202, "{}", String::from_utf8_lossy(&response.body));
            response.json()
        }

        fn settle(&self, id: &str) -> Value {
            let deadline = Instant::now() + Duration::from_secs(8);
            loop {
                let job = self.request("GET", &format!("{API}/jobs/{id}"), b"", &[]).json();
                if job["status"] != "running" { return job; }
                assert!(Instant::now() < deadline, "fixture conversion did not finish");
                thread::sleep(Duration::from_millis(15));
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) { self.backend.shutdown(); let _ = fs::remove_dir_all(&self.root); }
    }

    #[test]
    fn serves_local_assets_and_rejects_cross_origin_hosts_and_paths() {
        let fixture = Fixture::new();
        assert!(fixture.backend.url.starts_with("http://127.0.0.1:"));
        assert_eq!(fixture.request("GET", "/", b"", &[]).status, 200);
        let asset = fixture.request("GET", "/assets/app.js", b"", &[]);
        assert_eq!(asset.status, 200);
        assert!(asset.headers.contains("immutable"));
        assert_eq!(fixture.request("GET", "/", b"", &[("host", "attacker.invalid")]).status, 403);
        assert_eq!(fixture.request("GET", STORAGE, b"", &[("origin", "https://attacker.invalid")]).status, 403);
        assert_eq!(fixture.request("GET", STORAGE, b"", &[("sec-fetch-site", "cross-site")]).status, 403);
        assert_eq!(fixture.request("GET", "/%2e%2e/private.txt", b"", &[]).status, 400);
        assert_eq!(fixture.request("POST", &format!("{API}/jobs"), b"{}", &[("content-type", "text/plain")]).status, 415);
        assert_eq!(fixture.request("POST", &format!("{API}/uploads"), b"", &[("content-type", "application/pdf"), ("content-length", "536870913")]).status, 413);
        let health = fixture.request("GET", "/__scan2ebook__/health", b"", &[]).json();
        assert_eq!(health["app"], "scan2ebook-reader");
    }

    #[test]
    fn automation_descriptor_matches_health_and_is_removed_on_shutdown() {
        let mut fixture = Fixture::new();
        let path = fixture.root.join("data/automation.json");
        let descriptor: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(descriptor, json!({
            "url":fixture.backend.url, "apiVersion":1, "edition":"macos", "pid":std::process::id()
        }));
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let health = fixture.request("GET", "/__scan2ebook__/health", b"", &[]);
        assert_eq!(health.status, 200);
        assert_eq!(health.json(), json!({
            "app":"scan2ebook-reader", "version":env!("CARGO_PKG_VERSION"),
            "storageDir":fixture.root.join("data"), "apiVersion":1, "edition":"macos", "pid":std::process::id()
        }));
        fixture.backend.shutdown();
        assert!(!path.exists());
    }

    #[test]
    fn shutdown_leaves_a_replacement_automation_descriptor_in_place() {
        let mut fixture = Fixture::new();
        let data = fixture.root.join("data");
        let path = data.join("automation.json");
        let mut replacement = start(data, fixture.root.join("dist"), fixture.command.clone()).unwrap();
        fixture.backend.shutdown();
        let descriptor: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(descriptor["url"], replacement.url);
        replacement.shutdown();
        assert!(!path.exists());
    }

    #[test]
    fn automation_descriptor_write_failure_leaves_backend_usable() {
        let mut fixture = Fixture::new();
        fixture.backend.shutdown();
        let path = fixture.root.join("data/automation.json");
        fs::create_dir_all(&path).unwrap();
        fixture.restart();
        assert_eq!(fixture.request("GET", "/__scan2ebook__/health", b"", &[]).status, 200);
        fixture.backend.shutdown();
        assert!(path.is_dir());
    }

    #[test]
    fn uploaded_pdf_metadata_is_available_after_restart() {
        let mut fixture = Fixture::new();
        let upload = fixture.upload();
        let path = format!("{API}/uploads/{}", upload["id"].as_str().unwrap());
        fixture.restart();
        let metadata = fixture.request("GET", &path, b"", &[]);
        assert_eq!(metadata.status, 200);
        assert_eq!(metadata.json(), upload);
        assert_eq!(fixture.request("GET", &path, b"", &[("origin", "https://attacker.invalid")]).status, 403);
        assert_eq!(fixture.request("GET", upload["url"].as_str().unwrap(), b"", &[]).body, b"%PDF-1.7\nDesktop fixture");
        assert_eq!(fixture.request("GET", &format!("{API}/uploads/{}", Uuid::new_v4()), b"", &[]).status, 404);
    }

    #[test]
    fn library_protocol_roundtrips_pdf_folders_annotations_and_preferences() {
        let mut fixture = Fixture::new();
        assert_eq!(fixture.request("PUT", &format!("{STORAGE}/books/book-a/pdf"), b"%PDF-fixture", &[("content-type", "application/pdf")]).status, 200);
        let command = format!("{STORAGE}/command");
        for value in [
            json!({"action":"putBook", "book":{"id":"book-a","title":"示例书","pdfUrl":"must not persist","pdfBlob":{}}}),
            json!({"action":"putFolder","folder":{"id":"folder-a","name":"阅读中"}}),
            json!({"action":"moveBooks","ids":["book-a"],"folderId":"folder-a"}),
            json!({"action":"replaceAnnotations","bookId":"book-a","records":[{"id":"note-a","text":"批注"}]}),
            json!({"action":"setPreference","key":"s2e-theme","value":"paper"}),
        ] { assert_eq!(fixture.json(&command, value).status, 200); }
        fixture.restart();
        let state = fixture.request("GET", STORAGE, b"", &[]).json();
        assert_eq!(state["books"][0]["folderId"], "folder-a");
        assert!(state["books"][0].get("pdfUrl").is_none());
        assert!(state["books"][0].get("pdfBlob").is_none());
        assert_eq!(state["annotations"]["book-a"][0]["storageKey"], "book-a:note-a");
        assert_eq!(state["preferences"]["s2e-theme"], "paper");
        assert_eq!(fixture.request("GET", &format!("{STORAGE}/books/book-a/pdf"), b"", &[]).body, b"%PDF-fixture");
        assert_eq!(fixture.json(&command, json!({"action":"updateBookAndAnnotations","book":{"id":"book-a","title":"修订"},"records":[]})).status, 200);
        assert_eq!(fixture.json(&command, json!({"action":"deleteFolder","id":"folder-a"})).status, 200);
        assert_eq!(fixture.json(&command, json!({"action":"deleteBooks","ids":["book-a"]})).status, 200);
        assert_eq!(fixture.request("GET", STORAGE, b"", &[]).json()["books"], json!([]));
        assert_eq!(fixture.request("GET", &format!("{STORAGE}/books/book-a/pdf"), b"", &[]).status, 404);
        assert_eq!(fixture.json(&command, json!({"action":"putBook","book":{"id":"../outside"}})).status, 400);
    }

    #[test]
    fn conversion_preserves_progress_downloads_and_history_without_keys_or_raw_logs() {
        let mut fixture = Fixture::new();
        let upload = fixture.upload();
        assert_eq!(fixture.request("GET", upload["url"].as_str().unwrap(), b"", &[]).body, b"%PDF-1.7\nDesktop fixture");
        let started = fixture.job(&upload, "test-success");
        let id = started["id"].as_str().unwrap();
        let complete = fixture.settle(id);
        assert_eq!(complete["status"], "completed");
        assert_eq!(complete["progress"], 100.0);
        assert_eq!(complete["current"], 2);
        assert_eq!(complete["total"], 3);
        assert_eq!(complete["pdfPage"], 2);
        let download = complete["files"].as_array().unwrap().iter().find(|file| file["kind"] == "s2e").unwrap();
        assert!(fixture.request("GET", download["url"].as_str().unwrap(), b"", &[]).body.starts_with(b"PK"));
        let failed = fixture.job(&upload, "test-fail");
        let failure = fixture.settle(failed["id"].as_str().unwrap());
        assert_eq!(failure["status"], "failed");
        assert!(!failure.to_string().contains(KEY));
        fixture.restart();
        let restored = fixture.request("GET", &format!("{API}/jobs/{id}"), b"", &[]).json();
        assert_eq!(restored["status"], "completed");
        assert_eq!(restored["startedAt"], complete["startedAt"]);
        assert_eq!(fixture.json(&format!("{API}/jobs"), json!({"uploadId": upload["id"]})).status, 400);
        let saved = fs::read_to_string(fixture.root.join("data/conversions/state.json")).unwrap();
        for forbidden in [KEY, "测试服务拒绝请求", "DEEPSEEK_API_KEY", "\"command\"", "\"child\"", "\"env\""] { assert!(!saved.contains(forbidden), "history contains {forbidden}"); }
        assert!(!saved.contains(fixture.root.to_str().unwrap()));
    }

    #[test]
    fn cleanup_retains_running_jobs_and_the_draft_upload() {
        let fixture = Fixture::new();
        let upload = fixture.upload();
        let unused = fixture.upload();
        let draft = fixture.upload();
        let first = fixture.job(&upload, "test-success");
        let complete = fixture.settle(first["id"].as_str().unwrap());
        let active = fixture.job(&upload, "test-slow");
        assert!(fixture.backend.busy());
        assert_eq!(fixture.json(&format!("{API}/jobs"), json!({"uploadId":upload["id"],"apiKey":KEY})).status, 409);
        assert_eq!(fixture.request("DELETE", &format!("{API}/jobs/{}", active["id"].as_str().unwrap()), b"", &[]).status, 409);
        let cleanup = fixture.json(&format!("{API}/cleanup"), json!({"keepUploadId":draft["id"]}));
        assert_eq!(cleanup.status, 200);
        assert_eq!(cleanup.json()["removedJobs"], 1);
        assert_eq!(cleanup.json()["removedUploads"], 1);
        let output_bytes: u64 = complete["files"].as_array().unwrap().iter().map(|file| file["size"].as_u64().unwrap()).sum();
        assert_eq!(cleanup.json()["freedBytes"], output_bytes + unused["size"].as_u64().unwrap());
        assert_eq!(fixture.request("GET", upload["url"].as_str().unwrap(), b"", &[]).status, 200);
        assert_eq!(fixture.request("GET", unused["url"].as_str().unwrap(), b"", &[]).status, 404);
        assert_eq!(fixture.request("GET", draft["url"].as_str().unwrap(), b"", &[]).status, 200);
        let cancelled = fixture.json(&format!("{API}/jobs/{}/cancel", active["id"].as_str().unwrap()), json!({}));
        assert_eq!(cancelled.json()["status"], "cancelled");
        assert!(!fixture.backend.busy());
        assert_eq!(fixture.request("DELETE", &format!("{API}/jobs/{}", active["id"].as_str().unwrap()), b"", &[]).json()["removedUploads"], 1);
    }

    #[test]
    fn restart_marks_crashed_jobs_interrupted_and_checks_missing_completed_files() {
        let mut fixture = Fixture::new();
        let upload = fixture.upload();
        let completed = fixture.job(&upload, "test-success");
        let complete = fixture.settle(completed["id"].as_str().unwrap());
        let active = fixture.job(&upload, "test-slow");
        let state_path = fixture.root.join("data/conversions/state.json");
        let running_state = fs::read(&state_path).unwrap();
        fixture.backend.shutdown();
        fs::write(&state_path, running_state).unwrap();
        let ebook = complete["files"].as_array().unwrap().iter().find(|file| file["kind"] == "s2e").unwrap();
        fs::remove_file(fixture.root.join("data/conversions/jobs").join(completed["id"].as_str().unwrap()).join(ebook["name"].as_str().unwrap())).unwrap();
        fixture.restart();
        let interrupted = fixture.request("GET", &format!("{API}/jobs/{}", active["id"].as_str().unwrap()), b"", &[]).json();
        assert_eq!(interrupted["status"], "interrupted");
        assert_eq!(interrupted["message"], "服务已停止，请重新转换");
        assert!(!fixture.backend.busy());
        let missing = fixture.request("GET", &format!("{API}/jobs/{}", completed["id"].as_str().unwrap()), b"", &[]).json();
        assert_eq!(missing["status"], "failed");
        assert_eq!(missing["files"], json!([]));
    }

    #[test]
    fn concurrent_start_has_one_child_and_shutdown_reaps_it_and_closes_listener() {
        let mut fixture = Fixture::new();
        let upload = fixture.upload();
        let args = json!({"uploadId":upload["id"],"apiKey":KEY,"model":"test-slow"});
        let mut statuses = thread::scope(|scope| {
            let first = scope.spawn(|| fixture.json(&format!("{API}/jobs"), args.clone()).status);
            let second = scope.spawn(|| fixture.json(&format!("{API}/jobs"), args.clone()).status);
            vec![first.join().unwrap(), second.join().unwrap()]
        });
        statuses.sort();
        assert_eq!(statuses, vec![202, 409]);
        let process = fixture.backend.shared.state.lock().unwrap().children.values().next().unwrap().clone();
        let address = fixture.backend.url.strip_prefix("http://").unwrap().to_owned();
        let before = Instant::now();
        fixture.backend.shutdown();
        assert!(before.elapsed() < Duration::from_secs(3));
        assert!(process.child.lock().unwrap().try_wait().unwrap().is_some());
        assert!(!fixture.backend.busy());
        assert!(TcpStream::connect(address).is_err());
        fixture.backend.shutdown();
    }

    #[test]
    fn invalid_ranges_workers_and_missing_key_do_not_create_jobs() {
        let fixture = Fixture::new();
        let upload = fixture.upload();
        let base = json!({"uploadId":upload["id"],"apiKey":KEY,"pageStart":1,"pageEnd":3,"workers":2});
        for (field, value) in [("pageStart",json!(0)),("pageStart",json!(1.5)),("pageEnd",json!(4)),("apiKey",json!("")),("workers",json!(17)),("workers",json!(-1))] {
            let mut args = base.clone(); args[field] = value;
            assert_eq!(fixture.json(&format!("{API}/jobs"), args).status, 400);
        }
        assert_eq!(fixture.request("GET", API, b"", &[]).json()["jobs"], json!([]));
        assert!(!fixture.backend.busy());
    }

    #[test]
    fn deleting_one_job_keeps_other_uploads_and_imported_library_copies() {
        let fixture = Fixture::new();
        let used = fixture.upload();
        let unused = fixture.upload();
        let started = fixture.job(&used, "test-success");
        let complete = fixture.settle(started["id"].as_str().unwrap());
        let ebook = complete["files"].as_array().unwrap().iter().find(|file| file["kind"] == "s2e").unwrap();
        let copied = fixture.root.join("data/books/imported/record.json");
        fs::create_dir_all(copied.parent().unwrap()).unwrap();
        fs::write(&copied, b"independent library copy").unwrap();
        let removed = fixture.request("DELETE", &format!("{API}/jobs/{}", started["id"].as_str().unwrap()), b"", &[]);
        assert_eq!(removed.json()["removedUploads"], 1);
        assert_eq!(fixture.request("GET", unused["url"].as_str().unwrap(), b"", &[]).status, 200);
        assert_eq!(fixture.request("GET", ebook["url"].as_str().unwrap(), b"", &[]).status, 404);
        assert_eq!(fs::read(&copied).unwrap(), b"independent library copy");
    }

    #[test]
    fn restored_metadata_cannot_redirect_pdf_or_downloads_outside_owned_folders() {
        let mut fixture = Fixture::new();
        let used = fixture.upload();
        let unsafe_upload = fixture.upload();
        let started = fixture.job(&used, "test-success");
        fixture.settle(started["id"].as_str().unwrap());
        fixture.backend.shutdown();
        let path = fixture.root.join("data/conversions/state.json");
        let mut history: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let external = fixture.root.join("private.pdf");
        fs::write(&external, b"%PDF-PRIVATE").unwrap();
        for upload in history["uploads"].as_array_mut().unwrap() {
            if upload["id"] == used["id"] { upload["file"] = json!(external); }
            if upload["id"] == unsafe_upload["id"] { upload["name"] = json!("../../private.pdf"); }
        }
        history["jobs"][0]["out"] = json!(fixture.root);
        history["jobs"][0]["files"][0]["name"] = json!("../../private.pdf");
        fs::write(path, serde_json::to_vec(&history).unwrap()).unwrap();
        fixture.restart();
        assert_eq!(fixture.request("GET", used["url"].as_str().unwrap(), b"", &[]).body, b"%PDF-1.7\nDesktop fixture");
        assert_eq!(fixture.request("GET", unsafe_upload["url"].as_str().unwrap(), b"", &[]).status, 404);
        let restored = fixture.request("GET", &format!("{API}/jobs/{}", started["id"].as_str().unwrap()), b"", &[]).json();
        let ebook = restored["files"].as_array().unwrap().iter().find(|file| file["kind"] == "s2e").unwrap();
        assert!(fixture.request("GET", ebook["url"].as_str().unwrap(), b"", &[]).body.starts_with(b"PK"));
    }

    #[cfg(unix)]
    #[test]
    fn cancel_and_shutdown_terminate_grandchildren_and_remove_only_job_work() {
        for (shutdown, stubborn) in [(false, false), (true, false), (false, true), (true, true)] {
            let mut fixture = Fixture::new();
            let engine = fixture.root.join("tree-engine.mjs");
            fs::write(&engine, r#"
                import { spawn } from 'node:child_process';
                import { mkdirSync, writeFileSync } from 'node:fs';
                import { join } from 'node:path';
                const args = process.argv.slice(2);
                if (args[0] === 'inspect') { console.log(JSON.stringify({ok:true,pages:3})); process.exit(0); }
                const out = args[args.indexOf('-o') + 1];
                const work = join(out, '.work-00000000-0000-4000-8000-000000000001');
                mkdirSync(work, {recursive:true});
                writeFileSync(join(work, 'private-page.png'), 'fixture intermediate');
                writeFileSync(join(out, 'keep.s2e'), 'completed output stays');
                const stubborn = args[args.indexOf('--vision-model') + 1] === 'test-stubborn';
                const childCode = (stubborn ? 'process.on("SIGTERM", () => {});' : '')
                    + 'require("node:fs").writeFileSync(process.argv[1], "ready");setInterval(() => {}, 1000)';
                const child = spawn(process.execPath, ['-e', childCode, join(out, 'grandchild.ready')], {stdio:'ignore'});
                process.on('SIGTERM', () => {});
                child.on('exit', () => process.exit(0));
                writeFileSync(join(out, 'grandchild.pid'), String(child.pid));
                setInterval(() => {}, 1000);
            "#).unwrap();
            fixture.command = vec!["node".into(), engine.to_string_lossy().into_owned()];
            fixture.restart();
            let upload = fixture.upload();
            let started = fixture.job(&upload, if stubborn { "test-stubborn" } else { "test-slow" });
            let id = started["id"].as_str().unwrap();
            let output = fixture.root.join("data/conversions/jobs").join(id);
            let marker = output.join("grandchild.pid");
            let deadline = Instant::now() + Duration::from_secs(3);
            while !marker.exists() || !output.join("grandchild.ready").exists() { assert!(Instant::now() < deadline); thread::sleep(Duration::from_millis(15)); }
            let pid: i32 = fs::read_to_string(marker).unwrap().parse().unwrap();
            assert_eq!(unsafe { libc::kill(pid, 0) }, 0);
            let before = Instant::now();
            if shutdown { fixture.backend.shutdown(); }
            else { assert_eq!(fixture.json(&format!("{API}/jobs/{id}/cancel"), json!({})).json()["status"], "cancelled"); }
            assert!(before.elapsed() < Duration::from_secs(3));
            let deadline = Instant::now() + Duration::from_secs(2);
            let mut alive = unsafe { libc::kill(pid, 0) } == 0;
            while alive && Instant::now() < deadline { thread::sleep(Duration::from_millis(15)); alive = unsafe { libc::kill(pid, 0) } == 0; }
            if alive { unsafe { libc::kill(pid, libc::SIGKILL); } }
            assert!(!alive, "cancel/shutdown left a live grandchild");
            assert!(!output.join(".work-00000000-0000-4000-8000-000000000001").exists());
            assert_eq!(fs::read(output.join("keep.s2e")).unwrap(), b"completed output stays");
            assert!(fixture.root.join("data/conversions/uploads").join(upload["id"].as_str().unwrap()).join("sample.pdf").exists());
        }
    }

    #[test]
    fn restart_removes_only_recognized_work_directories_inside_owned_jobs() {
        let mut fixture = Fixture::new();
        let upload = fixture.upload();
        let started = fixture.job(&upload, "test-slow");
        let id = started["id"].as_str().unwrap();
        let state_path = fixture.root.join("data/conversions/state.json");
        let running = fs::read(&state_path).unwrap();
        fixture.backend.shutdown();
        fs::write(&state_path, running).unwrap();
        let output = fixture.root.join("data/conversions/jobs").join(id);
        let work = output.join(".work-00000000-0000-4000-8000-000000000002");
        fs::create_dir_all(&work).unwrap();
        fs::write(work.join("page.png"), b"temporary page").unwrap();
        fs::create_dir_all(output.join(".work-user-not-a-uuid")).unwrap();
        fs::write(output.join("keep.s2e"), b"keep").unwrap();
        fixture.restart();
        assert!(!work.exists());
        assert!(output.join(".work-user-not-a-uuid").exists());
        assert_eq!(fs::read(output.join("keep.s2e")).unwrap(), b"keep");
        assert_eq!(fixture.request("GET", &format!("{API}/jobs/{id}"), b"", &[]).json()["status"], "interrupted");
    }
}
