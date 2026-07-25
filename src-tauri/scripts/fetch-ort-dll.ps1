# fetch-ort-dll.ps1 — 新しい Windows ML の onnxruntime.dll を特定して使えるようにする。
#
# MioMail のセマンティック検索(src/embed.rs)は ort クレートを `load-dynamic` で
# 使うため、onnxruntime.dll は実行時にロードされる(リンク不要・protoc 不要)。
# 解決順は find_ort_dll() 参照:
#   1. 環境変数 ORT_DYLIB_PATH(フルパス)
#   2. exe と同じディレクトリの onnxruntime.dll
#
# ▼ 対象は「新しい Windows ML」(Windows App SDK 2.x = Microsoft.WindowsAppRuntime.2
#   パッケージ同梱の ONNX Runtime 1.24 系)の onnxruntime.dll のみ。
#   この DLL だけが EP カタログ経由で各ベンダーの NPU/GPU EP
#   (Intel=OpenVINO / AMD=VitisAI / Qualcomm=QNN / NVIDIA=TensorRT, および DirectML)を
#   供給する。GitHub の汎用リリース(onnxruntime-win-x64-*.zip)は CPU EP しか持たず、
#   GPU も NPU も列挙されない。過去にこの汎用ビルドへ暗黙フォールバックした結果、
#   「GPU/NPU が無い」と誤診する事故が起きたため、フォールバックは廃止した。
#
# 本スクリプトの動作:
#   (A) ORT_DYLIB_PATH が既に有効ならそれを表示して終了。
#   (B) Get-AppxPackage で Microsoft.WindowsAppRuntime.2 の InstallLocation を取得し、
#       その中の onnxruntime.dll を指す ORT_DYLIB_PATH 設定コマンドを表示する。
#       ※ WindowsApps 配下は「ルートの列挙」が権限で拒否されるため、
#          Get-ChildItem による探索ではなく Get-AppxPackage を使うこと。
#   (C) 見つからなければエラーで終了(汎用ビルドへは落ちない)。
#
# 使い方:
#   powershell -ExecutionPolicy Bypass -File src-tauri/scripts/fetch-ort-dll.ps1

param(
    # 取得するパッケージのアーキテクチャ(X64 / Arm64 / X86)。
    # 未指定なら実行中の PowerShell のアーキテクチャに合わせる。
    [ValidateSet("X64", "Arm64", "X86")]
    [string]$Arch
)

$ErrorActionPreference = "Stop"

# (A) ORT_DYLIB_PATH が既に有効
if ($env:ORT_DYLIB_PATH -and (Test-Path $env:ORT_DYLIB_PATH)) {
    $v = (Get-Item $env:ORT_DYLIB_PATH).VersionInfo.ProductVersion
    Write-Host "ORT_DYLIB_PATH is set and valid:"
    Write-Host "  $env:ORT_DYLIB_PATH  (v$v)"
    if ($v -notmatch '^1\.2[4-9]') {
        Write-Warning "この DLL は WinML 1.24 系ではありません。GPU/NPU EP が列挙されない可能性があります。"
    }
    exit 0
}

# (B) 導入済み Windows ML(Windows App SDK 2.x)の onnxruntime.dll を特定
Write-Host "Locating the Windows ML (Microsoft.WindowsAppRuntime.2) onnxruntime.dll ..."

# onnxruntime.dll はプロセスのアーキテクチャと一致していなければロードできない。
# ARM64 機で x64 ビルドをエミュレーション実行する場合は X64 パッケージが要る、
# ネイティブ ARM64 ビルドなら Arm64 パッケージが要る、という関係。
# 既定はこのスクリプトを動かしている PowerShell のアーキテクチャに合わせ、
# クロス検証用に -Arch で上書きできるようにする。
if (-not $Arch) {
    $Arch = switch ($env:PROCESSOR_ARCHITECTURE) {
        "ARM64" { "Arm64" }
        "AMD64" { "X64" }
        "x86"   { "X86" }
        default { "X64" }
    }
}
Write-Host "  target architecture: $Arch"

$pkg = Get-AppxPackage -Name "Microsoft.WindowsAppRuntime.2" |
    Where-Object { $_.Architecture -eq $Arch -and $_.InstallLocation } |
    Sort-Object { [version]$_.Version } -Descending |
    Select-Object -First 1

if (-not $pkg) {
    Write-Host "Windows ML (Microsoft.WindowsAppRuntime.2, $Arch) が見つかりません。" -ForegroundColor Red
    Write-Host ""
    Write-Host "MioMail のセマンティック検索は新しい Windows ML の ONNX Runtime 1.24 系が前提です。"
    Write-Host "Windows App SDK 2.x ランタイムを導入するか、ORT_DYLIB_PATH に WinML の"
    Write-Host "onnxruntime.dll のフルパスを設定してください。"
    Write-Host ""
    Write-Host "GitHub の汎用 onnxruntime は CPU EP のみで GPU/NPU が一切列挙されないため、"
    Write-Host "代替として使ってはいけません。"
    exit 1
}

$dll = Join-Path $pkg.InstallLocation "onnxruntime.dll"
if (-not (Test-Path $dll)) {
    Write-Error "パッケージは見つかりましたが onnxruntime.dll がありません: $($pkg.InstallLocation)"
    exit 1
}

$ver = (Get-Item $dll).VersionInfo.ProductVersion
Write-Host ""
Write-Host "Found Windows ML onnxruntime.dll:"
Write-Host "  $dll"
Write-Host "  version: $ver   (package $($pkg.Name) $($pkg.Version))"
Write-Host ""
Write-Host "この DLL はパッケージ内の依存 DLL と同居した状態でロードする必要があるため、"
Write-Host "コピーせず ORT_DYLIB_PATH で直接指すこと。以下を実行してください:"
Write-Host ""
Write-Host "  # 現在のセッションのみ" -ForegroundColor DarkGray
Write-Host "  `$env:ORT_DYLIB_PATH = `"$dll`"" -ForegroundColor Cyan
Write-Host ""
Write-Host "  # 永続化(ユーザー環境変数)" -ForegroundColor DarkGray
Write-Host "  [Environment]::SetEnvironmentVariable('ORT_DYLIB_PATH', `"$dll`", 'User')" -ForegroundColor Cyan
Write-Host ""
Write-Host "設定後の確認(EP 列挙):"
Write-Host "  cargo test --manifest-path src-tauri/Cargo.toml --lib diag_ep_devices -- --ignored --nocapture" -ForegroundColor Cyan
