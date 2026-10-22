use notify::{recommended_watcher, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Serialize, Clone)]
struct Doc {
    path: String,
    content: String,
}

fn load(path: &Path) -> Option<Doc> {
    std::fs::read_to_string(path).ok().map(|content| Doc {
        path: path.display().to_string(),
        content,
    })
}

struct AppState {
    file: Mutex<Option<PathBuf>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
}

impl AppState {
    fn watch(&self, app: &AppHandle, target: &Path) {
        let dir = target
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf();
        let target = target.to_path_buf();
        let target_canonical = target.canonicalize().unwrap_or_else(|_| target.clone());
        let app = app.clone();

        let watcher = recommended_watcher(move |res: Result<Event, notify::Error>| {
            let Ok(event) = res else { return };
            if !matches!(
                event.kind,
                EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
            ) {
                return;
            }
            let hit = event.paths.iter().any(|p| {
                p == &target || p.canonicalize().ok().as_ref() == Some(&target_canonical)
            });
            if !hit {
                return;
            }
            if let Some(doc) = load(&target) {
                let _ = app.emit("file-changed", doc);
            }
        });

        match watcher {
            Ok(mut w) => {
                if let Err(e) = w.watch(&dir, RecursiveMode::NonRecursive) {
                    eprintln!("failed to watch {}: {e}", dir.display());
                    return;
                }
                *self.watcher.lock().unwrap() = Some(w);
            }
            Err(e) => eprintln!("failed to create file watcher: {e}"),
        }
    }
}

#[tauri::command]
fn get_content(state: State<AppState>) -> Option<Doc> {
    state.file.lock().unwrap().as_ref().and_then(|p| load(p))
}

#[tauri::command]
fn open_file(app: AppHandle, state: State<AppState>, path: String) -> Option<Doc> {
    let path = PathBuf::from(&path).canonicalize().ok()?;
    if !path.is_file() {
        return None;
    }
    *state.file.lock().unwrap() = Some(path.clone());
    state.watch(&app, &path);
    load(&path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            file: Mutex::new(None),
            watcher: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![get_content, open_file])
        .setup(|app| {
            if let Some(arg) = std::env::args().nth(1) {
                if let Ok(path) = PathBuf::from(&arg).canonicalize() {
                    if path.is_file() {
                        let state = app.state::<AppState>();
                        *state.file.lock().unwrap() = Some(path.clone());
                        state.watch(app.handle(), &path);
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
