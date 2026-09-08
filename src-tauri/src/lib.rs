use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveResult {
    pub file_path: String,
    pub file_name: String,
    pub timestamp: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MediaCheckResult {
    pub exists: bool,
    pub extension: String,
    pub size_bytes: u64,
    pub is_ts: bool,
}

#[tauri::command]
fn select_folder(default_path: Option<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new();
    if let Some(ref p) = default_path {
        if Path::new(p).exists() {
            dialog = dialog.set_directory(p);
        }
    }
    dialog.pick_folder().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn select_video_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("视频文件 (*.mp4, *.ts, *.mkv, *.webm, *.mov, *.avi, *.m4v)", &["mp4", "ts", "mkv", "webm", "mov", "avi", "flv", "m4v"])
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn open_path(target_path: String) -> Result<(), String> {
    let path = Path::new(&target_path);
    if !path.exists() {
        return Err(format!("路径不存在: {}", target_path));
    }

    #[cfg(target_os = "windows")]
    {
        // 如果是文件，在资源管理器中选中高亮该文件；如果是目录，直接打开目录
        if path.is_file() {
            let _ = Command::new("explorer")
                .arg(format!("/select,{}", path.to_string_lossy()))
                .spawn();
            return Ok(());
        }
    }

    open::that(&target_path).map_err(|e| format!("无法打开路径: {}", e))
}

#[tauri::command]
fn save_snapshot(
    output_dir: String,
    file_prefix: Option<String>,
    format: String,
    base64_data: String,
) -> Result<SaveResult, String> {
    let dir = Path::new(&output_dir);
    if !dir.exists() {
        fs::create_dir_all(dir).map_err(|e| format!("创建输出目录失败: {}", e))?;
    }

    // 去除 base64 前缀 (如 "data:image/jpeg;base64,")
    let raw_b64 = if let Some(idx) = base64_data.find(',') {
        &base64_data[idx + 1..]
    } else {
        &base64_data
    };

    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(raw_b64)
        .map_err(|e| format!("解码图片 Base64 失败: {}", e))?;

    let now = chrono::Local::now();
    let time_str = now.format("%Y%m%d_%H%M%S_%3f").to_string();
    let ext = match format.to_lowercase().as_str() {
        "png" => "png",
        "webp" => "webp",
        _ => "jpg",
    };

    let prefix = file_prefix.unwrap_or_else(|| "snap".to_string());
    // 过滤前缀非法字符
    let safe_prefix: String = prefix
        .chars()
        .map(|c| if ['\\', '/', ':', '*', '?', '"', '<', '>', '|'].contains(&c) { '_' } else { c })
        .collect();

    let file_name = format!("{}_{}.{}", safe_prefix, time_str, ext);
    let full_path = dir.join(&file_name);

    fs::write(&full_path, bytes).map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(SaveResult {
        file_path: full_path.to_string_lossy().to_string(),
        file_name,
        timestamp: now.timestamp_millis(),
    })
}

#[tauri::command]
#[allow(non_snake_case)]
fn delete_snapshot(file_path: Option<String>, filePath: Option<String>) -> Result<bool, String> {
    let raw = file_path.or(filePath).unwrap_or_default();
    if raw.is_empty() {
        return Ok(false);
    }

    // 清洗 URL 前缀与各种编码
    let clean = raw
        .trim_start_matches("file://")
        .trim_start_matches("asset://localhost/")
        .trim_start_matches("asset://");

    let path = PathBuf::from(clean);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("物理删除失败: {}", e))?;
        return Ok(true);
    }

    // 尝试 Windows 反斜杠替换
    let win_path = PathBuf::from(clean.replace('/', "\\"));
    if win_path.exists() {
        fs::remove_file(&win_path).map_err(|e| format!("物理删除失败: {}", e))?;
        return Ok(true);
    }

    // 尝试正斜杠替换
    let unix_path = PathBuf::from(clean.replace('\\', "/"));
    if unix_path.exists() {
        fs::remove_file(&unix_path).map_err(|e| format!("物理删除失败: {}", e))?;
        return Ok(true);
    }

    Ok(false)
}

#[tauri::command]
fn check_media_file(file_path: String) -> MediaCheckResult {
    let path = Path::new(&file_path);
    if !path.exists() {
        return MediaCheckResult {
            exists: false,
            extension: String::new(),
            size_bytes: 0,
            is_ts: false,
        };
    }

    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let is_ts = ext == "ts" || ext == "m2ts";

    MediaCheckResult {
        exists: true,
        extension: ext,
        size_bytes: size,
        is_ts,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            select_folder,
            select_video_file,
            open_path,
            save_snapshot,
            delete_snapshot,
            check_media_file
        ])
        .run(tauri::generate_context!())
        .expect("运行快门应用程序失败");
}
