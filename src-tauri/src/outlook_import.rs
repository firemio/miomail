use anyhow::Result;
use serde_json::Value;
use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Manager};

fn get_script_path(app: &AppHandle) -> Result<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // Dev mode: the scripts directory next to the project root
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("scripts").join("extract_outlook.py"));
    }

    // Packaged app: "../scripts/extract_outlook.py" resources land under
    // resource_dir()/_up_/scripts/ (Tauri maps parent dirs to "_up_")
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("extract_outlook.py"));
        candidates.push(
            resource_dir
                .join("_up_")
                .join("scripts")
                .join("extract_outlook.py"),
        );
    }

    candidates
        .into_iter()
        .find(|p| p.exists())
        .ok_or_else(|| anyhow::anyhow!("extract_outlook.py not found"))
}

fn find_python() -> Result<String> {
    for candidate in ["python", "python3", "py"] {
        let ok = Command::new(candidate)
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if ok {
            return Ok(candidate.to_string());
        }
    }
    Err(anyhow::anyhow!(
        "Pythonが見つかりません。Outlookインポートには Python 3 と ccl_chromium_reader パッケージのインストールが必要です。"
    ))
}

pub fn run_extract(app: &AppHandle, args: &[&str]) -> Result<Value> {
    let script_path = get_script_path(app)?;
    let python = find_python()?;

    let output = Command::new(&python)
        .arg(&script_path)
        .args(args)
        // Force UTF-8 on the pipe so Japanese mail doesn't arrive as cp932
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow::anyhow!("Python script failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let value: Value = serde_json::from_str(stdout.trim())?;
    Ok(value)
}
