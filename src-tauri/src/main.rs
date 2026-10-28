#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;

// The workspace lives in ProjectPlan.dplan beside the executable. Keeping the
// path fixed means Save and Open always use the same file.
fn data_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe
        .parent()
        .ok_or_else(|| "the executable has no folder".to_string())?;
    Ok(dir.join("ProjectPlan.dplan"))
}

#[tauri::command]
fn load_data() -> Result<Option<String>, String> {
    let path = data_path()?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_data(content: String) -> Result<(), String> {
    let path = data_path()?;
    fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![load_data, save_data])
        .run(tauri::generate_context!())
        .expect("error while running GanttDesk");
}
