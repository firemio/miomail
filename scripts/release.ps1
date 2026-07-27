# MioMail リリース一括スクリプト
# 使い方:
#   powershell -ExecutionPolicy Bypass -File scripts/release.ps1                 # パッチ版を上げてリリース
#   powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -Bump minor     # マイナー版を上げる
#   powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -Version 2.2.0  # 明示指定
#   powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -Notes "..."    # リリースノート指定
#
# やること:
#   1. バージョンを 3 ファイル（package.json / src-tauri/Cargo.toml / src-tauri/tauri.conf.json）で同期更新
#   2. コミット・タグ・プッシュ
#   3. 署名付き tauri build（miomail-mcp.exe のロックは自動解除）
#   4. latest.json 生成
#   5. GitHub Release 作成（exe / sig / latest.json の 3 点アップロード）

param(
  [ValidateSet("patch", "minor", "major")]
  [string]$Bump = "patch",
  [string]$Version = "",
  [string]$Notes = ""
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)  # リポジトリルート

function Invoke-Native {
  param([string]$File, [string[]]$Args, [string]$What)
  & $File @Args
  if ($LASTEXITCODE -ne 0) { throw "$What に失敗しました (exit $LASTEXITCODE): $File $Args" }
}

# --- ツールの PATH 解決（このマシンの既知の場所をフォールバックに使う） ---
$knownPaths = @(
  "C:\Program Files\nodejs",
  "$env:USERPROFILE\.cargo\bin",
  "C:\Program Files\GitHub CLI"
)
foreach ($p in $knownPaths) {
  if ((Test-Path $p) -and ($env:Path -notlike "*$p*")) { $env:Path = "$p;$env:Path" }
}
foreach ($tool in @("node", "npm", "cargo", "gh")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool が見つかりません。PATH を確認してください。" }
}

# --- 前提チェック ---
if (git status --porcelain) { throw "作業ツリーがクリーンではありません。コミットか stash を先に行ってください。" }
$branch = (git branch --show-current).Trim()
if ($branch -ne "main") { throw "main ブランチではありません (現在: $branch)" }
Invoke-Native git @("fetch", "origin", "main", "--tags") "git fetch"
$behind = [int](git rev-list --count "HEAD..origin/main")
if ($behind -gt 0) { throw "origin/main に $behind コミット遅れています。先に pull してください。" }

# --- 現在バージョンと新バージョン ---
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$cur = $pkg.version
if ($Version) {
  $new = $Version.TrimStart("v")
} else {
  $parts = $cur.Split(".")
  switch ($Bump) {
    "major" { $parts[0] = [string]([int]$parts[0] + 1); $parts[1] = "0"; $parts[2] = "0" }
    "minor" { $parts[1] = [string]([int]$parts[1] + 1); $parts[2] = "0" }
    "patch" { $parts[2] = [string]([int]$parts[2] + 1) }
  }
  $new = $parts -join "."
}
if (git rev-parse -q --verify "refs/tags/v$new") { throw "タグ v$new は既に存在します。" }
Write-Host "バージョン: $cur -> $new" -ForegroundColor Cyan

# --- リリースノート（未指定なら前回タグからのコミット一覧を使う） ---
if (-not $Notes) {
  $prevTag = (git describe --tags --abbrev=0).Trim()
  $log = git log "$prevTag..HEAD" --pretty=format:"- %s" | Where-Object { $_ -notmatch "^- chore: v\d" }
  $Notes = "## 変更点`n`n" + ($log -join "`n")
  Write-Host "ノート未指定のため ${prevTag} からのコミット一覧を使用します:" -ForegroundColor DarkGray
  Write-Host $Notes -ForegroundColor DarkGray
}

# --- 1. バージョン 3 ファイル同期 ---
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function Rewrite-Version([string]$Path, [string]$Pattern, [string]$Replacement) {
  $full = Join-Path (Get-Location) $Path
  $content = [System.IO.File]::ReadAllText($full)
  $updated = [regex]::Replace($content, $Pattern, $Replacement, 1)
  if ($updated -eq $content) { throw "$Path 内にバージョン表記が見つかりません: $Pattern" }
  [System.IO.File]::WriteAllText($full, $updated, $utf8NoBom)
}
Rewrite-Version "package.json" "`"version`": `"$([regex]::Escape($cur))`"" "`"version`": `"$new`""
Rewrite-Version "src-tauri/tauri.conf.json" "`"version`": `"$([regex]::Escape($cur))`"" "`"version`": `"$new`""
Rewrite-Version "src-tauri/Cargo.toml" "(?m)^version = `"$([regex]::Escape($cur))`"" "version = `"$new`""

# --- 2. コミット・タグ・プッシュ ---
Invoke-Native git @("commit", "-am", "chore: v$new") "コミット"
Invoke-Native git @("tag", "v$new") "タグ付け"
Invoke-Native git @("push") "プッシュ"
Invoke-Native git @("push", "--tags") "タグのプッシュ"

# --- 3. 署名付きビルド ---
# miomail-mcp.exe が target/release 内の exe をロックしてビルドが失敗するのを防ぐ
Get-Process miomail-mcp -ErrorAction SilentlyContinue | Stop-Process -Force
$keyPath = "$env:USERPROFILE\.tauri\miomail.key"
if (-not (Test-Path $keyPath)) { throw "署名鍵が見つかりません: $keyPath" }
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content $keyPath -Raw)
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
Invoke-Native npm @("run", "tauri", "build") "tauri build"

# --- 4. latest.json ---
Invoke-Native node @("scripts/make-latest-json.mjs", "--notes", $Notes) "latest.json 生成"

# --- 5. GitHub Release ---
$nsis = "src-tauri/target/release/bundle/nsis"
$exe  = "$nsis/MioMail_${new}_x64-setup.exe"
$sig  = "$exe.sig"
foreach ($f in @($exe, $sig, "$nsis/latest.json")) {
  if (-not (Test-Path $f)) { throw "成果物が見つかりません: $f" }
}
Invoke-Native gh @("release", "create", "v$new", $exe, $sig, "$nsis/latest.json",
  "--title", "MioMail v$new", "--notes", $Notes) "GitHub Release 作成"

Invoke-Native gh @("release", "view", "v$new") "リリース確認"
Write-Host "`n✅ MioMail v$new をリリースしました" -ForegroundColor Green
Write-Host "https://github.com/firemio/miomail/releases/tag/v$new"
