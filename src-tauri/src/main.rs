#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct FileInfo {
    name: String,
    extension: String,
    size: String,
    modified: String,
    full_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct FolderPlan {
    name: String,
    description: String,
    files: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OrgPlan {
    folders: Vec<FolderPlan>,
    summary: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct OrganizeResult {
    files_count: usize,
    folders_created: usize,
    moves: usize,
    summary: String,
}

use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct FileMove {
    source: String,
    destination: String,
    file_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct UndoState {
    base_path: String,
    moves: Vec<FileMove>,
    folders_created: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaStatus {
    installed: bool,
    running: bool,
    has_model: bool,
}

#[tauri::command]
async fn ollama_status() -> Result<OllamaStatus, String> {
    // 1) Check if ollama binary is installed
    let installed = Command::new("ollama")
        .arg("--version")
        .output()
        .is_ok();

    // Default: not running, no model
    let mut running = false;
    let mut has_model = false;

    // 2) If server responds, mark running and check models
    if let Ok(resp) = reqwest::Client::new()
        .get("http://localhost:11434/api/tags")
        .send()
        .await
    {
        #[derive(Deserialize)]
        struct Tag {
            name: String,
        }
        #[derive(Deserialize)]
        struct TagsResponse {
            models: Vec<Tag>,
        }

        if let Ok(tags) = resp.json::<TagsResponse>().await {
            running = true;
            has_model = tags
                .models
                .iter()
                .any(|t| t.name == "llama3.2:3b" || t.name.starts_with("llama3.2:3b"));
        }
    }

    Ok(OllamaStatus {
        installed,
        running,
        has_model,
    })
}

#[tauri::command]
async fn start_ollama() -> Result<String, String> {
    // Try to start `ollama serve` detached
    Command::new("ollama")
        .arg("serve")
        .spawn()
        .map_err(|e| format!("Failed to start Ollama: {e}"))?;

    Ok("Ollama starting".into())
}

#[tauri::command]
async fn stop_ollama() -> Result<String, String> {
    // Kill the Ollama process directly since /api/shutdown endpoint doesn't exist
    #[cfg(target_os = "windows")]
    {
        let result = Command::new("taskkill")
            .args(["/F", "/IM", "ollama.exe"])
            .status()
            .map_err(|e| e.to_string())?;
        
        if result.success() {
            return Ok("Ollama stopped".into());
        } else {
            return Err("Failed to stop Ollama".into());
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let result = Command::new("pkill")
            .arg("ollama")
            .status()
            .map_err(|e| e.to_string())?;
        
        if result.success() {
            return Ok("Ollama stopped".into());
        } else {
            return Err("Failed to stop Ollama or process not running".into());
        }
    }
}

#[tauri::command]
async fn pull_default_model() -> Result<String, String> {
    // This may take a while; run synchronously and return when done
    let status = Command::new("ollama")
        .args(["pull", "llama3.2:3b"])
        .status()
        .map_err(|e| format!("Failed to run ollama pull: {e}"))?;

    if status.success() {
        Ok("Model llama3.2:3b downloaded".into())
    } else {
        Err("ollama pull failed".into())
    }
}

// Global undo state
static LAST_UNDO: Mutex<Option<UndoState>> = Mutex::new(None);

/// Scan folder into FileInfo list
fn scan_folder(path: &str) -> Result<Vec<FileInfo>, String> {
    let mut files = Vec::new();
    let base = PathBuf::from(path);

    if !base.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    for entry in fs::read_dir(&base).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let meta = entry.metadata().map_err(|e| e.to_string())?;

        if meta.is_file() {
            let file_path = entry.path();
            let name = file_path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();

            if name.starts_with('.') {
                continue;
            }

            let ext = file_path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            let size_bytes = meta.len();
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.elapsed().ok())
                .map(|_| "unknown".to_string())
                .unwrap_or_else(|| "unknown".to_string());

            files.push(FileInfo {
                name,
                extension: if ext.is_empty() { "no_extension".into() } else { format!(".{ext}") },
                size: format_size(size_bytes),
                modified,
                full_path: file_path.to_string_lossy().to_string(),
            });
        }
    }
    Ok(files)
}

fn format_size(bytes: u64) -> String {
    if bytes < 1024 {
        return format!("{bytes} B");
    }
    if bytes < 1024 * 1024 {
        return format!("{:.1} KB", bytes as f64 / 1024.0);
    }
    format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
}

fn build_prompt(files: &[FileInfo]) -> String {
    let list = files
        .iter()
        .map(|f| format!(
            "- {} (type: {}, size: {}, modified: {})",
            f.name, f.extension, f.size, f.modified
        ))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        r#"
You are a file organization assistant.
You get a flat list of files and must group them into folders.

FILES:
{list}

RULES:
- Create clear, human-readable folder names (lowercase_with_underscores)
- Max 8 folders
- Every file must be assigned to some folder
- Group by purpose/topic when possible, not just extension
- Respond ONLY with JSON, no explanation outside JSON:
{{
  "folders": [
    {{
      "name": "folder_name",
      "description": "why these files go here",
      "files": ["filename1.ext", "filename2.ext"]
    }}
  ],
  "summary": "short explanation"
}}
"#
    )
}

async fn ask_ollama(prompt: &str) -> Result<OrgPlan, String> {
    #[derive(Serialize)]
    struct OllamaRequest<'a> {
        model: &'a str,
        prompt: &'a str,
        stream: bool,
        format: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        options: Option<serde_json::Value>,
    }

    #[derive(Deserialize)]
    struct OllamaResponse {
        response: String,
    }

    let client = reqwest::Client::new();
    let body = OllamaRequest {
        model: "llama3.2:3b",
        prompt,
        stream: false,
        format: "json",
        options: None,
    };

    let res = client
        .post("http://localhost:11434/api/generate")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama error: {e}"))?;

    let data: OllamaResponse = res
        .json()
        .await
        .map_err(|e| format!("Ollama parse error: {e}"))?;

    // Try direct JSON first
    if let Ok(plan) = serde_json::from_str::<OrgPlan>(&data.response) {
        return Ok(plan);
    }

    // Fallback: extract JSON block
    if let Some(start) = data.response.find('{') {
        if let Some(end) = data.response.rfind('}') {
            let slice = &data.response[start..=end];
            let plan: OrgPlan =
                serde_json::from_str(slice).map_err(|e| format!("Plan JSON error: {e}"))?;
            return Ok(plan);
        }
    }

    Err("Could not parse plan JSON from model response".into())
}

fn execute_plan_internal(
    base_path: &str,
    plan: &OrgPlan,
    files: &[FileInfo],
) -> Result<OrganizeResult, String> {
    let base = PathBuf::from(base_path);
    let mut moves = 0;
    let mut folders_created = 0;
    let mut move_log: Vec<FileMove> = Vec::new();
    let mut created_folders: Vec<String> = Vec::new();

    for folder in &plan.folders {
        let folder_path = base.join(&folder.name);
        if !folder_path.exists() {
            fs::create_dir_all(&folder_path).map_err(|e| e.to_string())?;
            folders_created += 1;
            created_folders.push(folder_path.to_string_lossy().to_string());
        }

        for filename in &folder.files {
            if let Some(file) = files.iter().find(|f| f.name == *filename) {
                let src = PathBuf::from(&file.full_path);
                let dest = folder_path.join(&file.name);

                if src == dest {
                    continue;
                }

                if let Err(e) = fs::rename(&src, &dest) {
                    eprintln!("Failed to move {}: {}", file.name, e);
                    continue;
                }

                move_log.push(FileMove {
                    source: src.to_string_lossy().to_string(),
                    destination: dest.to_string_lossy().to_string(),
                    file_name: file.name.clone(),
                });

                moves += 1;
            }
        }
    }

    // Save undo state
    let undo_state = UndoState {
        base_path: base_path.to_string(),
        moves: move_log,
        folders_created: created_folders,
    };

    if let Ok(mut lock) = LAST_UNDO.lock() {
        *lock = Some(undo_state);
    }

    Ok(OrganizeResult {
        files_count: files.len(),
        folders_created,
        moves,
        summary: plan.summary.clone(),
    })
}

// #[tauri::command]
// async fn organize_folder(path: String) -> Result<OrganizeResult, String> {
//     let files = scan_folder(&path)?;
//     if files.is_empty() {
//         return Err("No files found in folder".into());
//     }

//     let prompt = build_prompt(&files);
//     let plan = ask_ollama(&prompt).await?;
//     let result = execute_plan(&path, &plan, &files)?;
//     Ok(result)
// }

#[tauri::command]
async fn plan_folder(path: String) -> Result<OrgPlan, String> {
    let files = scan_folder(&path)?;
    if files.is_empty() {
        return Err("No files found in folder".into());
    }

    let prompt = build_prompt(&files);
    let plan = ask_ollama(&prompt).await?;
    Ok(plan)
}

#[tauri::command]
async fn execute_plan(path: String, plan: OrgPlan) -> Result<OrganizeResult, String> {
    let files = scan_folder(&path)?;
    if files.is_empty() {
        return Err("No files found in folder".into());
    }

    let result = execute_plan_internal(&path, &plan, &files)?;
    Ok(result)
}

#[tauri::command]
async fn undo_last() -> Result<String, String> {
    let undo_state = {
        let lock = LAST_UNDO.lock().map_err(|e| e.to_string())?;
        match lock.clone() {
            Some(state) => state,
            None => return Err("Nothing to undo".into()),
        }
    };

    let mut restored = 0;

    // Reverse all file moves
    for file_move in undo_state.moves.iter().rev() {
        let src = PathBuf::from(&file_move.destination);
        let dest = PathBuf::from(&file_move.source);

        if src.exists() {
            if let Err(e) = fs::rename(&src, &dest) {
                eprintln!("Undo failed for {}: {}", file_move.file_name, e);
                continue;
            }
            restored += 1;
        }
    }

    // Remove created folders if they're empty
    for folder_path in undo_state.folders_created.iter().rev() {
        let path = PathBuf::from(folder_path);
        if path.exists() {
            if let Ok(entries) = fs::read_dir(&path) {
                if entries.count() == 0 {
                    let _ = fs::remove_dir(&path);
                }
            }
        }
    }

    // Clear undo state
    if let Ok(mut lock) = LAST_UNDO.lock() {
        *lock = None;
    }

    Ok(format!("Restored {} files to original locations", restored))
}

fn scan_photos(path: &str) -> Result<Vec<FileInfo>, String> {
    let mut files = Vec::new();
    let base = PathBuf::from(path);

    if !base.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    let exts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".bmp", ".tiff"];

    for entry in fs::read_dir(&base).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let meta = entry.metadata().map_err(|e| e.to_string())?;

        if meta.is_file() {
            let file_path = entry.path();
            let name = file_path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();

            if name.starts_with('.') {
                continue;
            }

            let ext = file_path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            let ext_dot = if ext.is_empty() { "".into() } else { format!(".{ext}") };

            if !exts.contains(&ext_dot.as_str()) {
                continue;
            }

            let size_bytes = meta.len();
            let modified = "unknown".to_string();

            files.push(FileInfo {
                name,
                extension: ext_dot,
                size: format_size(size_bytes),
                modified,
                full_path: file_path.to_string_lossy().to_string(),
            });
        }
    }
    Ok(files)
}

fn build_photos_prompt(files: &[FileInfo]) -> String {
    let list = files
        .iter()
        .map(|f| format!("- {} (size: {}, ext: {})", f.name, f.size, f.extension))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        r#"
You are a photo organization assistant.
You get a flat list of images and must group them into folders.

FILES:
{list}

RULES:
- Create clear folder names based on content/purpose when possible:
  examples: "screenshots", "work_assets", "social_media", "vacation_photos"
- Group screenshots separately from regular photos if possible
- Use lowercase_with_underscores
- Max 10 folders
- Every file must be assigned to some folder
- Respond ONLY with JSON:
{{
  "folders": [
    {{
      "name": "folder_name",
      "description": "why these files go here",
      "files": ["filename1.jpg", "filename2.png"]
    }}
  ],
  "summary": "short explanation"
}}
"#
    )
}

#[tauri::command]
async fn plan_photos(path: String) -> Result<OrgPlan, String> {
    let files = scan_photos(&path)?;
    if files.is_empty() {
        return Err("No photos found in folder".into());
    }

    let prompt = build_photos_prompt(&files);
    let plan = ask_ollama(&prompt).await?;
    Ok(plan)
}

#[tauri::command]
async fn execute_photo_plan(path: String, plan: OrgPlan) -> Result<OrganizeResult, String> {
    let files = scan_photos(&path)?;
    if files.is_empty() {
        return Err("No photos found in folder".into());
    }

    let result = execute_plan_internal(&path, &plan, &files)?;
    Ok(result)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            plan_folder,
            execute_plan,
            plan_photos,
            execute_photo_plan,
            undo_last,
            ollama_status,
            start_ollama,
            pull_default_model,
            stop_ollama
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}