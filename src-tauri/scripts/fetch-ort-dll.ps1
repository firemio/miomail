# fetch-ort-dll.ps1 — place onnxruntime.dll next to the cargo build outputs.
#
# MioMail's semantic search (src/embed.rs) uses the ort crate with the
# `load-dynamic` feature, so onnxruntime.dll is loaded at RUNTIME (no linking,
# no protoc). This script downloads the official microsoft/onnxruntime
# v1.23.2 release (the version ort-sys 2.0.0-rc.11 expects) and copies the
# DLL into target/debug, target/release and target/debug/deps (for cargo test).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File src-tauri/scripts/fetch-ort-dll.ps1
#
# Manual alternative:
#   1. Download https://github.com/microsoft/onnxruntime/releases/download/v1.23.2/onnxruntime-win-x64-1.23.2.zip
#   2. Copy lib/onnxruntime.dll from the zip next to the exe (e.g. target/debug/)
#   3. Or set the ORT_DYLIB_PATH environment variable to the full DLL path.

$ErrorActionPreference = "Stop"

$OrtVersion = "1.23.2"
$ZipUrl = "https://github.com/microsoft/onnxruntime/releases/download/v$OrtVersion/onnxruntime-win-x64-$OrtVersion.zip"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$TauriDir = Split-Path -Parent $ScriptDir          # src-tauri
$WorkDir = Join-Path $TauriDir "target\ort-dll"
$ZipPath = Join-Path $WorkDir "onnxruntime-win-x64-$OrtVersion.zip"

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

if (-not (Test-Path $ZipPath)) {
    Write-Host "Downloading $ZipUrl ..."
    Invoke-WebRequest -Uri $ZipUrl -OutFile $ZipPath
}

Write-Host "Extracting ..."
Expand-Archive -Path $ZipPath -DestinationPath $WorkDir -Force
$Dll = Join-Path $WorkDir "onnxruntime-win-x64-$OrtVersion\lib\onnxruntime.dll"
if (-not (Test-Path $Dll)) {
    throw "onnxruntime.dll not found in the extracted archive"
}

# The DirectML EP is built into onnxruntime.dll; copy providers_shared too.
$Extra = Join-Path $WorkDir "onnxruntime-win-x64-$OrtVersion\lib\onnxruntime_providers_shared.dll"

foreach ($Profile in @("debug", "release")) {
    $TargetDir = Join-Path $TauriDir "target\$Profile"
    if (Test-Path $TargetDir) {
        Copy-Item $Dll $TargetDir -Force
        if (Test-Path $Extra) { Copy-Item $Extra $TargetDir -Force }
        Write-Host "Copied to $TargetDir"
    }
}

# cargo test binaries live in target/debug/deps
$DepsDir = Join-Path $TauriDir "target\debug\deps"
if (Test-Path $DepsDir) {
    Copy-Item $Dll $DepsDir -Force
    if (Test-Path $Extra) { Copy-Item $Extra $DepsDir -Force }
    Write-Host "Copied to $DepsDir"
}

Write-Host "Done. onnxruntime.dll $OrtVersion is ready (resolved at runtime via load-dynamic)."
