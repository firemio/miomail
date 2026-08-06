use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{Arc, RwLock},
};
use tauri::{ipc::Response, AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const MOD_FOLDER_NAME: &str = "character-mods";
const MANIFEST_NAME: &str = "character.json";
const MAX_MODS: usize = 64;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_THUMBNAIL_BYTES: u64 = 512 * 1024;
const MAX_IMAGE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_GLB_BYTES: u64 = 32 * 1024 * 1024;
const MAX_GLB_JSON_BYTES: usize = 2 * 1024 * 1024;
const MAX_PACKAGE_BYTES: u64 = 48 * 1024 * 1024;
const MAX_IMAGE_DIMENSION: u32 = 4096;
const MAX_IMAGE_PIXELS: u64 = 16_777_216;
const MAX_THUMBNAIL_DIMENSION: u32 = 512;
const MAX_GLB_TEXTURE_PIXELS: u64 = 8_388_608;
const MAX_SPRITE_TEXTURE_PIXELS: u64 = 33_554_432;
const MAX_ACCESSORS: usize = 512;
const MAX_ACCESSOR_COUNT: u64 = 500_000;
const MAX_ACCESSOR_COMPONENTS: u64 = 8_000_000;
const MAX_PRIMITIVES: usize = 256;
const MAX_ANIMATION_CHANNELS: usize = 512;
const MAX_ANIMATION_FLOAT_VALUES: u64 = 4_000_000;
const MAX_NODE_EDGES: usize = 512;
const MAX_EXPANDED_PRIMITIVES: usize = 512;
const MAX_ARCHIVE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ARCHIVE_UNPACKED_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 600;
const ARCHIVE_TMP_PREFIX: &str = ".install-";
const SKIPPED_ARCHIVE_FILES: [&str; 3] = [".DS_Store", "Thumbs.db", "desktop.ini"];
const MAX_SCENE_BYTES: u64 = 512 * 1024;
const MAX_SCENE_NODES: usize = 400;
const MAX_SCENE_DEPTH: usize = 12;
const MAX_PATH_DATA_CHARS: usize = 12_000;
const MAX_SCENE_ANIMATIONS: usize = 32;
const MAX_KEYFRAMES_PER_ANIMATION: usize = 24;
const MAX_GRADIENT_STOPS: usize = 8;
const MAX_CLIP_PATH_POINTS: usize = 24;
const MAX_BACKGROUND_LAYERS: usize = 4;
const MAX_SHADOWS: usize = 6;
const ALLOWED_STROKE_LINECAPS: [&str; 3] = ["butt", "round", "square"];
const ALLOWED_STROKE_LINEJOINS: [&str; 3] = ["miter", "round", "bevel"];
const ALLOWED_EXPRESSIONS: [&str; 4] = ["normal", "sleepy", "happy", "sad"];
const ALLOWED_EASINGS: [&str; 5] = ["linear", "ease", "ease-in", "ease-out", "ease-in-out"];
const PATH_DATA_ALLOWED_BYTES: &[u8] = b"MmLlHhVvCcSsQqTtAaZz0123456789 .,+-eE\n\t\r";
const ALLOWED_MOTIONS: [&str; 10] = [
    "idle",
    "look-around",
    "alert",
    "bounce",
    "self-care",
    "rest",
    "inspect",
    "celebrate",
    "walk",
    "deliver",
];

const MOD_README: &str = include_str!("../../../docs/character-mods/MOD_FOLDER_README.txt");
const MOD_SCHEMA: &str = include_str!("../../../docs/character-mods/character.schema.json");
const MOD_SCENE_SCHEMA: &str = include_str!("../../../docs/character-mods/scene.schema.json");
const SPRITE_EXAMPLE: &str =
    include_str!("../../../docs/character-mods/examples/sprite-sheet.example.json");
const SEQUENCE_EXAMPLE: &str =
    include_str!("../../../docs/character-mods/examples/image-sequence.example.json");
const GLB_EXAMPLE: &str =
    include_str!("../../../docs/character-mods/examples/blender-glb.example.json");
const DOM_SVG_EXAMPLE: &str =
    include_str!("../../../docs/character-mods/examples/dom-svg.example.json");

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CharacterModRenderer {
    #[serde(rename = "sprite-2d")]
    Sprite2d,
    #[serde(rename = "gltf-3d")]
    Gltf3d,
    #[serde(rename = "dom-svg")]
    DomSvg,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpriteSheetMotion {
    pub frames: Vec<u32>,
    pub fps: f32,
    #[serde(default = "default_true")]
    pub r#loop: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpriteSequenceMotion {
    pub files: Vec<String>,
    pub fps: f32,
    #[serde(default = "default_true")]
    pub r#loop: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GltfMotion {
    pub clip: String,
    #[serde(default = "default_true")]
    pub r#loop: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DomSvgTransform {
    #[serde(default)]
    pub rotate: Option<f32>,
    #[serde(default)]
    pub rotate_x: Option<f32>,
    #[serde(default)]
    pub rotate_y: Option<f32>,
    #[serde(default)]
    pub translate_x: Option<f32>,
    #[serde(default)]
    pub translate_y: Option<f32>,
    #[serde(default)]
    pub scale: Option<f32>,
    #[serde(default)]
    pub scale_x: Option<f32>,
    #[serde(default)]
    pub scale_y: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DomSvgMotion {
    #[serde(default)]
    pub pose: Option<DomSvgTransform>,
    /// モデル全体に掛けるアニメーション。spriteのframes、gltfのclipに相当する
    #[serde(default)]
    pub pose_animation: Option<String>,
    #[serde(default)]
    pub pose_origin: Option<[f32; 2]>,
    #[serde(default)]
    pub animations: Vec<String>,
    #[serde(default)]
    pub expression: Option<String>,
    #[serde(default = "default_true")]
    pub r#loop: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CharacterSource {
    Sheet {
        file: String,
        frame_width: u32,
        frame_height: u32,
        columns: u32,
        #[serde(default)]
        rows: Option<u32>,
        #[serde(default)]
        image_rendering: Option<String>,
        motions: HashMap<String, SpriteSheetMotion>,
    },
    Sequence {
        motions: HashMap<String, SpriteSequenceMotion>,
    },
    Model {
        file: String,
        #[serde(default)]
        scale: Option<f32>,
        #[serde(default)]
        ground_offset: Option<f32>,
        #[serde(default)]
        rotation_y: Option<f32>,
        motions: HashMap<String, GltfMotion>,
    },
    Scene {
        file: String,
        motions: HashMap<String, DomSvgMotion>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterModManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub license: Option<String>,
    pub behavior_profile: String,
    pub renderer: CharacterModRenderer,
    #[serde(default)]
    pub thumbnail: Option<String>,
    pub source: CharacterSource,
}

/// MODの出自。builtin=アプリ同梱（リソースdir、読み取り専用）、user=ユーザーが導入
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CharacterModOrigin {
    Builtin,
    User,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterModPackage {
    pub manifest: CharacterModManifest,
    pub revision: String,
    pub origin: CharacterModOrigin,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterModIssue {
    pub folder: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterModScanResult {
    pub packages: Vec<CharacterModPackage>,
    pub issues: Vec<CharacterModIssue>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterModInstallResult {
    pub installed_id: String,
    pub installed_name: String,
    pub replaced: bool,
    pub scan: CharacterModScanResult,
}

#[derive(Debug, Clone, Copy)]
enum AssetRole {
    Thumbnail,
    Sprite,
    Model,
    Scene,
}

#[derive(Debug, Clone)]
struct AssetDeclaration {
    key: String,
    relative_path: String,
    role: AssetRole,
}

struct LoadedPackage {
    descriptor: CharacterModPackage,
    assets: HashMap<String, RegisteredAsset>,
}

#[derive(Debug, Clone)]
struct RegisteredAsset {
    path: PathBuf,
    byte_len: u64,
    digest: [u8; 32],
}

#[derive(Debug)]
struct RegisteredPackage {
    revision: String,
    assets: HashMap<String, RegisteredAsset>,
}

#[derive(Default)]
pub struct CharacterModRegistry {
    packages: RwLock<HashMap<String, RegisteredPackage>>,
}

impl CharacterModRegistry {
    fn replace(&self, loaded: &[LoadedPackage]) -> Result<(), String> {
        let packages = loaded
            .iter()
            .map(|package| {
                (
                    package.descriptor.manifest.id.clone(),
                    RegisteredPackage {
                        revision: package.descriptor.revision.clone(),
                        assets: package.assets.clone(),
                    },
                )
            })
            .collect();
        *self
            .packages
            .write()
            .map_err(|_| "MOD registryの更新ロックが壊れています")? = packages;
        Ok(())
    }

    fn resolve(
        &self,
        mod_id: &str,
        revision: &str,
        asset_key: &str,
    ) -> Result<RegisteredAsset, String> {
        let packages = self
            .packages
            .read()
            .map_err(|_| "MOD registryの参照ロックが壊れています")?;
        let package = packages
            .get(mod_id)
            .ok_or("指定されたMODは再読み込み後のregistryにありません")?;
        if package.revision != revision {
            return Err("MODが変更されました。設定から再読み込みしてください".into());
        }
        package
            .assets
            .get(asset_key)
            .cloned()
            .ok_or_else(|| "指定されたassetはmanifestに宣言されていません".into())
    }
}

fn mods_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join(MOD_FOLDER_NAME))
        .map_err(|error| format!("MODフォルダーを決定できません: {error}"))
}

/// アプリ同梱MOD（既定4キャラ）のリソースフォルダー。
/// 見つからない環境（テスト等）は同梱なしとして扱う。
fn builtin_mods_root(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resolve("mods", tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|path| path.is_dir())
}

fn ensure_mod_root(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|error| format!("MODフォルダーを作成できません: {error}"))?;
    let readme = root.join("README.txt");
    if !readme.exists() {
        let mut file = File::create(&readme)
            .map_err(|error| format!("MODフォルダーのREADMEを作成できません: {error}"))?;
        file.write_all(MOD_README.as_bytes())
            .map_err(|error| format!("MODフォルダーのREADMEを書き込めません: {error}"))?;
    }
    for (name, contents) in [
        ("character.schema.json", MOD_SCHEMA),
        ("scene.schema.json", MOD_SCENE_SCHEMA),
        ("sprite-sheet.example.json", SPRITE_EXAMPLE),
        ("image-sequence.example.json", SEQUENCE_EXAMPLE),
        ("blender-glb.example.json", GLB_EXAMPLE),
        ("dom-svg.example.json", DOM_SVG_EXAMPLE),
    ] {
        let path = root.join(name);
        if !path.exists() {
            fs::write(&path, contents)
                .map_err(|error| format!("MOD仕様ファイルを書き込めません（{name}）: {error}"))?;
        }
    }
    Ok(())
}

fn read_limited(path: &Path, limit: u64, label: &str) -> Result<Vec<u8>, String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("{label}を確認できません: {error}"))?;
    if !metadata.is_file() {
        return Err(format!("{label}がファイルではありません"));
    }
    if metadata.len() > limit {
        return Err(format!(
            "{label}が上限（{} MiB）を超えています",
            limit / 1024 / 1024
        ));
    }
    let file = File::open(path).map_err(|error| format!("{label}を開けません: {error}"))?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("{label}を読めません: {error}"))?;
    if bytes.len() as u64 > limit {
        return Err(format!("{label}が読み込み上限を超えています"));
    }
    Ok(bytes)
}

fn validate_identifier(id: &str) -> Result<(), String> {
    if !(3..=64).contains(&id.len()) {
        return Err("idは3〜64文字にしてください".into());
    }
    if !id.bytes().all(|byte| {
        byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
    }) {
        return Err("idは半角小文字・数字・. _ - のみ使用できます".into());
    }
    if !id.as_bytes()[0].is_ascii_alphanumeric() {
        return Err("idの先頭は半角小文字または数字にしてください".into());
    }
    Ok(())
}

fn validate_text(value: &str, label: &str, max_chars: usize, required: bool) -> Result<(), String> {
    let count = value.chars().count();
    if required && value.trim().is_empty() {
        return Err(format!("{label}は必須です"));
    }
    if count > max_chars || value.chars().any(char::is_control) {
        return Err(format!("{label}が長すぎるか、制御文字を含んでいます"));
    }
    Ok(())
}

fn validate_motion_name(name: &str) -> Result<(), String> {
    if ALLOWED_MOTIONS.contains(&name) {
        Ok(())
    } else {
        Err(format!("未対応の動作名です: {name}"))
    }
}

fn validate_motion_rate(fps: f32, frames: usize, label: &str) -> Result<(), String> {
    if !fps.is_finite() || !(1.0..=60.0).contains(&fps) {
        return Err(format!("{label}のfpsは1〜60にしてください"));
    }
    if !(1..=240).contains(&frames) {
        return Err(format!("{label}のコマ数は1〜240にしてください"));
    }
    Ok(())
}

fn validate_dom_svg_transform(transform: &DomSvgTransform) -> Result<(), String> {
    if [transform.rotate, transform.rotate_x, transform.rotate_y]
        .into_iter()
        .flatten()
        .any(|value| !value.is_finite() || value.abs() > 360.0)
    {
        return Err("dom-svgのposeのrotateは-360〜360にしてください".into());
    }
    if transform
        .translate_x
        .is_some_and(|value| !value.is_finite() || value.abs() > 200.0)
        || transform
            .translate_y
            .is_some_and(|value| !value.is_finite() || value.abs() > 200.0)
    {
        return Err("dom-svgのposeのtranslateは-200〜200にしてください".into());
    }
    if [transform.scale, transform.scale_x, transform.scale_y]
        .into_iter()
        .flatten()
        .any(|value| !value.is_finite() || !(0.01..=10.0).contains(&value))
    {
        return Err("dom-svgのposeのscaleは0.01〜10にしてください".into());
    }
    Ok(())
}

fn validate_manifest(manifest: &CharacterModManifest) -> Result<(), String> {
    if manifest.schema_version != 1 {
        return Err(format!(
            "未対応のschemaVersionです: {}",
            manifest.schema_version
        ));
    }
    validate_identifier(&manifest.id)?;
    validate_text(&manifest.name, "name", 80, true)?;
    validate_text(&manifest.version, "version", 32, true)?;
    validate_text(&manifest.author, "author", 80, true)?;
    validate_text(&manifest.description, "description", 300, false)?;
    if let Some(license) = &manifest.license {
        validate_text(license, "license", 80, false)?;
    }
    if !matches!(
        manifest.behavior_profile.as_str(),
        "makko" | "mio" | "posty" | "saeta"
    ) {
        return Err("behaviorProfileはmakko / mio / posty / saetaのいずれかです".into());
    }

    match (&manifest.renderer, &manifest.source) {
        (
            CharacterModRenderer::Sprite2d,
            CharacterSource::Sheet {
                frame_width,
                frame_height,
                columns,
                rows,
                image_rendering,
                motions,
                ..
            },
        ) => {
            if !(16..=2048).contains(frame_width) || !(16..=2048).contains(frame_height) {
                return Err("spriteのframeWidth/frameHeightは16〜2048にしてください".into());
            }
            if !(1..=64).contains(columns) || rows.is_some_and(|value| !(1..=64).contains(&value)) {
                return Err("spriteのcolumns/rowsは1〜64にしてください".into());
            }
            if image_rendering
                .as_deref()
                .is_some_and(|value| !matches!(value, "auto" | "pixelated"))
            {
                return Err("imageRenderingはautoまたはpixelatedです".into());
            }
            if motions.is_empty() || !motions.contains_key("idle") {
                return Err("2D MODにはidleモーションが必要です".into());
            }
            for (name, motion) in motions {
                validate_motion_name(name)?;
                validate_motion_rate(motion.fps, motion.frames.len(), name)?;
                let available = columns.saturating_mul(rows.unwrap_or(64));
                if motion.frames.iter().any(|frame| *frame >= available) {
                    return Err(format!("{name}にシート範囲外のframeがあります"));
                }
            }
        }
        (CharacterModRenderer::Sprite2d, CharacterSource::Sequence { motions }) => {
            if motions.is_empty() || !motions.contains_key("idle") {
                return Err("2D MODにはidleモーションが必要です".into());
            }
            let total_frames: usize = motions.values().map(|motion| motion.files.len()).sum();
            if total_frames > 480 {
                return Err("画像連番はパッケージ全体で480枚までです".into());
            }
            for (name, motion) in motions {
                validate_motion_name(name)?;
                validate_motion_rate(motion.fps, motion.files.len(), name)?;
            }
        }
        (
            CharacterModRenderer::Gltf3d,
            CharacterSource::Model {
                scale,
                ground_offset,
                rotation_y,
                motions,
                ..
            },
        ) => {
            if scale.is_some_and(|value| !value.is_finite() || !(0.1..=10.0).contains(&value)) {
                return Err("3Dのscaleは0.1〜10にしてください".into());
            }
            if ground_offset
                .is_some_and(|value| !value.is_finite() || !(-5.0..=5.0).contains(&value))
            {
                return Err("3DのgroundOffsetは-5〜5にしてください".into());
            }
            if rotation_y
                .is_some_and(|value| !value.is_finite() || !(-360.0..=360.0).contains(&value))
            {
                return Err("3DのrotationYは-360〜360にしてください".into());
            }
            if !motions.is_empty() && !motions.contains_key("idle") {
                return Err("動く3D MODにはidleモーションを指定してください".into());
            }
            for (name, motion) in motions {
                validate_motion_name(name)?;
                validate_text(&motion.clip, "clip", 80, true)?;
            }
        }
        (CharacterModRenderer::DomSvg, CharacterSource::Scene { motions, .. }) => {
            if motions.is_empty() || !motions.contains_key("idle") {
                return Err("DOM/SVG MODにはidleモーションが必要です".into());
            }
            for (name, motion) in motions {
                validate_motion_name(name)?;
                if motion.animations.len() > MAX_SCENE_ANIMATIONS {
                    return Err(format!("{name}のanimations指定数が多すぎます"));
                }
                for animation_name in &motion.animations {
                    validate_scene_animation_name(animation_name)?;
                }
                if let Some(expression) = &motion.expression {
                    if !ALLOWED_EXPRESSIONS.contains(&expression.as_str()) {
                        return Err(format!("未対応のexpressionです: {expression}"));
                    }
                }
                if let Some(pose) = &motion.pose {
                    validate_dom_svg_transform(pose)?;
                }
                if let Some(pose_animation) = &motion.pose_animation {
                    validate_scene_animation_name(pose_animation)?;
                }
                if motion
                    .pose_origin
                    .is_some_and(|origin| origin.iter().any(|value| !value.is_finite()))
                {
                    return Err(format!("{name}のposeOriginは有限数にしてください"));
                }
            }
        }
        _ => return Err("rendererとsource.typeの組み合わせが一致しません".into()),
    }
    Ok(())
}

fn validate_relative_path(relative: &str) -> Result<(), String> {
    if relative.is_empty()
        || relative.len() > 240
        || relative.contains('\0')
        || relative.contains(':')
        || relative.contains('\\')
        || relative.starts_with('/')
    {
        return Err("asset pathは240文字以内の相対POSIXパスにしてください".into());
    }
    let path = Path::new(relative);
    if path.is_absolute()
        || !path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        return Err("asset pathに絶対パス、.、..、UNCは使用できません".into());
    }
    Ok(())
}

fn canonical_asset_path(mod_dir: &Path, relative: &str) -> Result<PathBuf, String> {
    validate_relative_path(relative)?;
    let canonical_root = fs::canonicalize(mod_dir)
        .map_err(|error| format!("MODフォルダーを確認できません: {error}"))?;
    let candidate = fs::canonicalize(mod_dir.join(relative))
        .map_err(|error| format!("assetが見つかりません（{relative}）: {error}"))?;
    if !candidate.starts_with(&canonical_root) || !candidate.is_file() {
        return Err(format!(
            "assetがMODフォルダー外を参照しています: {relative}"
        ));
    }
    Ok(candidate)
}

fn image_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    if bytes.len() >= 24 && bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
        let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
        return Ok((width, height));
    }

    if bytes.len() >= 30 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        let mut offset = 12usize;
        while offset + 8 <= bytes.len() {
            let kind = &bytes[offset..offset + 4];
            let length =
                u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
            let data_start = offset + 8;
            let data_end = data_start
                .checked_add(length)
                .ok_or("WebP chunkが不正です")?;
            if data_end > bytes.len() {
                return Err("WebP chunkが途中で切れています".into());
            }
            let data = &bytes[data_start..data_end];
            if kind == b"VP8X" && data.len() >= 10 {
                let width = 1 + u32::from_le_bytes([data[4], data[5], data[6], 0]);
                let height = 1 + u32::from_le_bytes([data[7], data[8], data[9], 0]);
                return Ok((width, height));
            }
            if kind == b"VP8L" && data.len() >= 5 && data[0] == 0x2f {
                let bits = u32::from_le_bytes([data[1], data[2], data[3], data[4]]);
                let width = (bits & 0x3fff) + 1;
                let height = ((bits >> 14) & 0x3fff) + 1;
                return Ok((width, height));
            }
            if kind == b"VP8 " && data.len() >= 10 && data[3..6] == [0x9d, 0x01, 0x2a] {
                let width = u16::from_le_bytes([data[6], data[7]]) as u32 & 0x3fff;
                let height = u16::from_le_bytes([data[8], data[9]]) as u32 & 0x3fff;
                return Ok((width, height));
            }
            offset = data_end + (length % 2);
        }
    }
    Err("画像は正しいPNGまたはWebPではありません".into())
}

fn reject_animated_image(bytes: &[u8], label: &str) -> Result<(), String> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        let mut offset = 8usize;
        let mut found_iend = false;
        while offset + 12 <= bytes.len() {
            let length = u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
            let kind = &bytes[offset + 4..offset + 8];
            let end = offset
                .checked_add(12)
                .and_then(|value| value.checked_add(length))
                .ok_or_else(|| format!("{label}のPNG chunkが不正です"))?;
            if end > bytes.len() {
                return Err(format!("{label}のPNG chunkが途中で切れています"));
            }
            if kind == b"acTL" {
                return Err(format!("{label}はAPNGではなく静止PNGにしてください"));
            }
            if kind == b"IEND" {
                found_iend = true;
                break;
            }
            offset = end;
        }
        if !found_iend {
            return Err(format!("{label}のPNGにIEND chunkがありません"));
        }
        return Ok(());
    }

    if bytes.starts_with(b"RIFF") && bytes.len() >= 12 && &bytes[8..12] == b"WEBP" {
        let declared_length = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize + 8;
        if declared_length != bytes.len() {
            return Err(format!("{label}のWebP RIFF lengthが不正です"));
        }
        let mut offset = 12usize;
        while offset + 8 <= bytes.len() {
            let kind = &bytes[offset..offset + 4];
            let length =
                u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
            let data_start = offset + 8;
            let data_end = data_start
                .checked_add(length)
                .ok_or_else(|| format!("{label}のWebP chunkが不正です"))?;
            if data_end > bytes.len() {
                return Err(format!("{label}のWebP chunkが途中で切れています"));
            }
            if (kind == b"ANIM" || kind == b"ANMF")
                || (kind == b"VP8X" && length > 0 && bytes[data_start] & 0x02 != 0)
            {
                return Err(format!("{label}はアニメWebPではなく静止WebPにしてください"));
            }
            offset = data_end + (length % 2);
        }
        if offset != bytes.len() {
            return Err(format!("{label}のWebP chunk境界が不正です"));
        }
    }
    Ok(())
}

fn validate_image(bytes: &[u8], label: &str) -> Result<(u32, u32), String> {
    reject_animated_image(bytes, label)?;
    let (width, height) = image_dimensions(bytes)?;
    if width == 0
        || height == 0
        || width > MAX_IMAGE_DIMENSION
        || height > MAX_IMAGE_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS
    {
        return Err(format!(
            "{label}の画像寸法が上限（4096px / 16MP）を超えています"
        ));
    }
    Ok((width, height))
}

fn value_array_len(root: &Value, key: &str) -> usize {
    root.get(key).and_then(Value::as_array).map_or(0, Vec::len)
}

fn accessor_count(root: &Value, index: usize) -> u64 {
    root.get("accessors")
        .and_then(Value::as_array)
        .and_then(|items| items.get(index))
        .and_then(|item| item.get("count"))
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

fn contains_object_key(value: &Value, key: &str) -> bool {
    match value {
        Value::Array(items) => items.iter().any(|item| contains_object_key(item, key)),
        Value::Object(object) => {
            object.contains_key(key) || object.values().any(|item| contains_object_key(item, key))
        }
        _ => false,
    }
}

fn node_index(value: &Value, node_count: usize, label: &str) -> Result<usize, String> {
    let index = value
        .as_u64()
        .ok_or_else(|| format!("{label}は整数indexにしてください"))? as usize;
    if index >= node_count {
        return Err(format!("{label}がnodes範囲外です"));
    }
    Ok(index)
}

fn visit_node_forest(
    index: usize,
    adjacency: &[Vec<usize>],
    states: &mut [u8],
) -> Result<(), String> {
    match states[index] {
        1 => return Err("GLB nodeのchildrenにcycleがあります".into()),
        2 => return Ok(()),
        _ => {}
    }
    states[index] = 1;
    for child in &adjacency[index] {
        visit_node_forest(*child, adjacency, states)?;
    }
    states[index] = 2;
    Ok(())
}

fn validate_scene_forest(root: &Value) -> Result<(usize, HashSet<usize>), String> {
    let nodes = root
        .get("nodes")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let node_count = nodes.len();
    let scene = root
        .pointer("/scenes/0")
        .and_then(Value::as_object)
        .ok_or("GLB scene 0が不正です")?;
    let roots: &[Value] = match scene.get("nodes") {
        Some(value) => value
            .as_array()
            .ok_or("GLB scene.nodesはindex配列にしてください")?
            .as_slice(),
        None => &[],
    };
    let mut incoming = vec![0u8; node_count];
    let mut adjacency = vec![Vec::new(); node_count];
    let mut root_indexes = Vec::new();
    let mut edge_count = roots.len();

    for value in roots {
        let index = node_index(value, node_count, "GLB scene node")?;
        incoming[index] = incoming[index].saturating_add(1);
        if incoming[index] > 1 {
            return Err("GLB nodeを複数のroot/parentから参照できません".into());
        }
        root_indexes.push(index);
    }
    for (parent, node) in nodes.iter().enumerate() {
        let children = match node.get("children") {
            Some(value) => value
                .as_array()
                .ok_or("GLB node.childrenはindex配列にしてください")?,
            None => continue,
        };
        edge_count = edge_count.saturating_add(children.len());
        for value in children {
            let child = node_index(value, node_count, "GLB child node")?;
            if child == parent {
                return Err("GLB nodeは自分自身をchildにできません".into());
            }
            incoming[child] = incoming[child].saturating_add(1);
            if incoming[child] > 1 {
                return Err("GLB nodeを複数のroot/parentから参照できません".into());
            }
            adjacency[parent].push(child);
        }
    }
    let mut states = vec![0u8; node_count];
    for index in 0..node_count {
        visit_node_forest(index, &adjacency, &mut states)?;
    }
    let mut reachable = HashSet::new();
    let mut stack = root_indexes;
    while let Some(index) = stack.pop() {
        if reachable.insert(index) {
            stack.extend(adjacency[index].iter().copied());
        }
    }
    Ok((edge_count, reachable))
}

fn node_number_array(
    node: &Value,
    key: &str,
    expected_len: usize,
    max_abs: f64,
) -> Result<Option<Vec<f64>>, String> {
    let Some(value) = node.get(key) else {
        return Ok(None);
    };
    let items = value
        .as_array()
        .ok_or_else(|| format!("GLB node.{key}は数値配列にしてください"))?;
    if items.len() != expected_len {
        return Err(format!("GLB node.{key}は{expected_len}要素にしてください"));
    }
    let numbers = items
        .iter()
        .map(|item| {
            let number = item
                .as_f64()
                .ok_or_else(|| format!("GLB node.{key}に数値以外があります"))?;
            if !number.is_finite() || number.abs() > max_abs {
                return Err(format!("GLB node.{key}の値が範囲外です"));
            }
            Ok(number)
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(Some(numbers))
}

fn validate_node_transform(node: &Value) -> Result<(), String> {
    let matrix = node_number_array(node, "matrix", 16, 1_000.0)?;
    if matrix.is_some()
        && ["translation", "rotation", "scale"]
            .iter()
            .any(|key| node.get(key).is_some())
    {
        return Err("GLB nodeはmatrixとTRSを同時に指定できません".into());
    }
    node_number_array(node, "translation", 3, 1_000.0)?;
    if let Some(rotation) = node_number_array(node, "rotation", 4, 1.01)? {
        let norm_squared: f64 = rotation.iter().map(|value| value * value).sum();
        if !(0.5..=1.5).contains(&norm_squared) {
            return Err("GLB node.rotationは正規化したquaternionにしてください".into());
        }
    }
    if let Some(scale) = node_number_array(node, "scale", 3, 100.0)? {
        if scale.iter().any(|value| value.abs() < 0.001) {
            return Err("GLB node.scaleは各軸0.001〜100にしてください".into());
        }
    }
    if let Some(weights) = node.get("weights") {
        let values = weights
            .as_array()
            .ok_or("GLB node.weightsは数値配列にしてください")?;
        if values.len() > 8
            || values.iter().any(|value| {
                value
                    .as_f64()
                    .is_none_or(|number| !number.is_finite() || number.abs() > 10.0)
            })
        {
            return Err("GLB node.weightsは8要素以内の有限値にしてください".into());
        }
    }
    Ok(())
}

fn validate_glb(bytes: &[u8]) -> Result<HashSet<String>, String> {
    if bytes.len() < 20 || &bytes[0..4] != b"glTF" {
        return Err("GLB magicが不正です".into());
    }
    let version = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    let declared_length = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
    if version != 2 || declared_length != bytes.len() {
        return Err("GLBはversion 2かつ正しいlengthで書き出してください".into());
    }

    let mut offset = 12usize;
    let mut json_chunk: Option<&[u8]> = None;
    let mut bin_chunk: Option<&[u8]> = None;
    while offset + 8 <= bytes.len() {
        let length = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        let kind = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap());
        let start = offset + 8;
        let end = start
            .checked_add(length)
            .ok_or("GLB chunk lengthが不正です")?;
        if end > bytes.len() {
            return Err("GLB chunkが途中で切れています".into());
        }
        match kind {
            0x4E4F534A if json_chunk.is_none() => json_chunk = Some(&bytes[start..end]),
            0x004E4942 if bin_chunk.is_none() => bin_chunk = Some(&bytes[start..end]),
            0x4E4F534A | 0x004E4942 => return Err("GLBに同種chunkが複数あります".into()),
            _ => return Err("GLBに未対応のchunkがあります".into()),
        }
        offset = end;
    }
    if offset != bytes.len() {
        return Err("GLB末尾のchunk境界が不正です".into());
    }
    let mut json_bytes = json_chunk.ok_or("GLBにJSON chunkがありません")?;
    if json_bytes.len() > MAX_GLB_JSON_BYTES {
        return Err("GLBのJSON chunkは2 MiB以下にしてください".into());
    }
    while json_bytes
        .last()
        .is_some_and(|byte| matches!(byte, b' ' | 0))
    {
        json_bytes = &json_bytes[..json_bytes.len() - 1];
    }
    let root: Value = serde_json::from_slice(json_bytes)
        .map_err(|error| format!("GLB JSONが不正です: {error}"))?;
    let asset_version = root
        .pointer("/asset/version")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !asset_version.starts_with("2.") {
        return Err("GLB asset.versionは2.xにしてください".into());
    }

    if value_array_len(&root, "nodes") > 256
        || value_array_len(&root, "meshes") > 128
        || value_array_len(&root, "materials") > 32
        || value_array_len(&root, "textures") > 16
        || value_array_len(&root, "samplers") > 16
        || value_array_len(&root, "images") > 16
        || value_array_len(&root, "animations") > 32
        || value_array_len(&root, "skins") > 16
        || value_array_len(&root, "bufferViews") > 512
        || value_array_len(&root, "accessors") > MAX_ACCESSORS
        || value_array_len(&root, "scenes") != 1
    {
        return Err(
            "GLBのnode / mesh / material / texture / animation数が上限を超えています".into(),
        );
    }
    if value_array_len(&root, "cameras") > 0 {
        return Err("GLB内のcameraは削除してください（カメラはMioMail側で管理します）".into());
    }

    for extension_list in ["extensionsRequired", "extensionsUsed"] {
        if root
            .get(extension_list)
            .and_then(Value::as_array)
            .is_some_and(|extensions| !extensions.is_empty())
        {
            return Err("GLB extensionはv1では使用できません".into());
        }
    }
    if contains_object_key(&root, "extensions") {
        return Err("GLB内のextensions objectはv1では使用できません".into());
    }
    if contains_object_key(&root, "extras") {
        return Err("GLB内のextrasはv1では使用できません".into());
    }

    if root.get("scene").and_then(Value::as_u64).unwrap_or(0) != 0 {
        return Err("GLBの既定sceneは0にしてください".into());
    }
    let mesh_count = value_array_len(&root, "meshes");
    let (node_edges, reachable_nodes) = validate_scene_forest(&root)?;
    if node_edges > MAX_NODE_EDGES {
        return Err("GLBのscene/node参照数が上限を超えています".into());
    }
    let skin_count = value_array_len(&root, "skins");
    let mut used_skins = HashSet::new();
    if let Some(nodes) = root.get("nodes").and_then(Value::as_array) {
        for (node_index, node) in nodes.iter().enumerate() {
            validate_node_transform(node)?;
            if let Some(mesh) = node.get("mesh") {
                if !reachable_nodes.contains(&node_index) {
                    return Err("GLBのscene外nodeにmeshを置けません".into());
                }
                let index = mesh
                    .as_u64()
                    .ok_or("GLB node.meshは整数indexにしてください")?
                    as usize;
                if index >= mesh_count {
                    return Err("GLB nodeのmesh参照が不正です".into());
                }
            }
            if let Some(skin) = node.get("skin") {
                if node.get("mesh").is_none() || !reachable_nodes.contains(&node_index) {
                    return Err("GLB node.skinはscene内のmesh nodeだけに指定できます".into());
                }
                let index = skin
                    .as_u64()
                    .ok_or("GLB node.skinは整数indexにしてください")?
                    as usize;
                if index >= skin_count {
                    return Err("GLB node.skinの参照が不正です".into());
                }
                used_skins.insert(index);
            }
        }
    }

    if let Some(buffers) = root.get("buffers").and_then(Value::as_array) {
        if buffers.len() > 1 || buffers.iter().any(|buffer| buffer.get("uri").is_some()) {
            return Err("GLBのbufferは埋め込み1個だけ使用できます".into());
        }
    }
    if root
        .get("images")
        .and_then(Value::as_array)
        .is_some_and(|images| images.iter().any(|image| image.get("uri").is_some()))
    {
        return Err("GLB画像は外部URIではなくGLBへ埋め込んでください".into());
    }

    let bin = bin_chunk.unwrap_or_default();
    if let Some(buffers) = root.get("buffers").and_then(Value::as_array) {
        if let Some(buffer) = buffers.first() {
            let declared = buffer
                .get("byteLength")
                .and_then(Value::as_u64)
                .ok_or("GLB bufferにbyteLengthがありません")? as usize;
            if declared > bin.len() || bin.len().saturating_sub(declared) > 3 {
                return Err("GLB bufferのbyteLengthとBIN chunkが一致しません".into());
            }
        }
    } else if !bin.is_empty() {
        return Err("GLBにBIN chunk用のbuffer宣言がありません".into());
    }

    if let Some(buffer_views) = root.get("bufferViews").and_then(Value::as_array) {
        for view in buffer_views {
            if view.get("buffer").and_then(Value::as_u64).unwrap_or(0) != 0 {
                return Err("GLB bufferViewは埋め込みbuffer 0だけ参照できます".into());
            }
            let start = view.get("byteOffset").and_then(Value::as_u64).unwrap_or(0) as usize;
            let length = view
                .get("byteLength")
                .and_then(Value::as_u64)
                .ok_or("GLB bufferViewにbyteLengthがありません")? as usize;
            let end = start
                .checked_add(length)
                .ok_or("GLB bufferViewの範囲が不正です")?;
            if end > bin.len() {
                return Err("GLB bufferViewがBIN chunk外を参照しています".into());
            }
            if view
                .get("byteStride")
                .and_then(Value::as_u64)
                .is_some_and(|stride| !(4..=252).contains(&stride) || stride % 4 != 0)
            {
                return Err("GLB bufferViewのbyteStrideが不正です".into());
            }
        }
    }

    let mut accessor_components = 0u64;
    if let Some(accessors) = root.get("accessors").and_then(Value::as_array) {
        for accessor in accessors {
            let count = accessor
                .get("count")
                .and_then(Value::as_u64)
                .ok_or("GLB accessorにcountがありません")?;
            if count > MAX_ACCESSOR_COUNT {
                return Err("GLB accessorの要素数が上限を超えています".into());
            }
            let width = match accessor.get("type").and_then(Value::as_str) {
                Some("SCALAR") => 1,
                Some("VEC2") => 2,
                Some("VEC3") => 3,
                Some("VEC4") | Some("MAT2") => 4,
                Some("MAT3") => 9,
                Some("MAT4") => 16,
                _ => return Err("GLB accessorのtypeが不正です".into()),
            };
            accessor_components = accessor_components
                .checked_add(count.saturating_mul(width))
                .ok_or("GLB accessorの展開サイズが大きすぎます")?;
            if accessor_components > MAX_ACCESSOR_COMPONENTS {
                return Err("GLB accessorの合計展開サイズが上限を超えています".into());
            }
            if accessor
                .get("bufferView")
                .and_then(Value::as_u64)
                .is_some_and(|index| index as usize >= value_array_len(&root, "bufferViews"))
            {
                return Err("GLB accessorのbufferView参照が不正です".into());
            }
            if accessor
                .pointer("/sparse/count")
                .and_then(Value::as_u64)
                .is_some_and(|sparse_count| sparse_count > count)
            {
                return Err("GLB sparse accessorのcountが不正です".into());
            }
        }
    }

    let mut triangles = 0u64;
    let mut primitive_count = 0usize;
    let mut mesh_primitive_counts = Vec::new();
    let mut mesh_triangle_counts = Vec::new();
    let mut mesh_morph_counts = Vec::new();
    let accessor_len = value_array_len(&root, "accessors");
    let material_len = value_array_len(&root, "materials");
    if let Some(meshes) = root.get("meshes").and_then(Value::as_array) {
        for mesh in meshes {
            let primitives = mesh.get("primitives").and_then(Value::as_array);
            mesh_primitive_counts.push(primitives.map_or(0, Vec::len));
            let mut mesh_triangles = 0u64;
            let mut mesh_morph_count = None;
            if let Some(primitives) = primitives {
                primitive_count = primitive_count.saturating_add(primitives.len());
                if primitive_count > MAX_PRIMITIVES {
                    return Err("GLBのprimitive数が上限を超えています".into());
                }
                for primitive in primitives {
                    let attributes = primitive
                        .get("attributes")
                        .and_then(Value::as_object)
                        .ok_or("GLB primitiveにattributesがありません")?;
                    for accessor in attributes.values() {
                        let index = accessor
                            .as_u64()
                            .ok_or("GLB attributesは整数accessor indexにしてください")?
                            as usize;
                        if index >= accessor_len {
                            return Err("GLB attributesのaccessor参照が不正です".into());
                        }
                    }
                    let position_index = attributes
                        .get("POSITION")
                        .and_then(Value::as_u64)
                        .ok_or("GLB primitiveにはPOSITION attributeが必要です")?
                        as usize;
                    let position_count = accessor_count(&root, position_index);
                    if position_count == 0 {
                        return Err("GLB primitiveのPOSITIONが空です".into());
                    }
                    if let Some(material) = primitive.get("material") {
                        let index = material
                            .as_u64()
                            .ok_or("GLB primitive.materialは整数indexにしてください")?
                            as usize;
                        if index >= material_len {
                            return Err("GLB primitive.materialの参照が不正です".into());
                        }
                    }
                    let targets = match primitive.get("targets") {
                        Some(value) => Some(
                            value
                                .as_array()
                                .ok_or("GLB primitive.targetsは配列にしてください")?,
                        ),
                        None => None,
                    };
                    let target_count = targets.map_or(0, Vec::len);
                    if target_count > 8 {
                        return Err("GLBのmorph targetはprimitiveごとに8個までです".into());
                    }
                    if mesh_morph_count.is_some_and(|count| count != target_count) {
                        return Err("同じmesh内のprimitiveはmorph target数を揃えてください".into());
                    }
                    mesh_morph_count = Some(target_count);
                    if let Some(targets) = targets {
                        for target in targets {
                            let target = target
                                .as_object()
                                .ok_or("GLB morph targetはobjectにしてください")?;
                            if target.values().any(|value| {
                                value
                                    .as_u64()
                                    .is_none_or(|index| index as usize >= accessor_len)
                            }) {
                                return Err("GLB morph targetのaccessor参照が不正です".into());
                            }
                        }
                    }
                    let count = match primitive.get("indices") {
                        Some(value) => {
                            let index = value
                                .as_u64()
                                .ok_or("GLB primitive.indicesは整数indexにしてください")?
                                as usize;
                            if index >= accessor_len {
                                return Err("GLB primitive.indicesの参照が不正です".into());
                            }
                            accessor_count(&root, index)
                        }
                        None => position_count,
                    };
                    let mode = primitive.get("mode").and_then(Value::as_u64).unwrap_or(4);
                    let primitive_triangles = match mode {
                        4 => count / 3,
                        _ => return Err("GLB primitive.modeはTRIANGLESだけ使用できます".into()),
                    };
                    triangles = triangles.saturating_add(primitive_triangles);
                    mesh_triangles = mesh_triangles.saturating_add(primitive_triangles);
                }
            }
            mesh_triangle_counts.push(mesh_triangles);
            mesh_morph_counts.push(mesh_morph_count.unwrap_or(0));
        }
    }
    if triangles > 100_000 {
        return Err("GLBは合計10万triangle以下にしてください".into());
    }
    let mut expanded_primitives = 0usize;
    let mut expanded_triangles = 0u64;
    if let Some(nodes) = root.get("nodes").and_then(Value::as_array) {
        for (node_index, node) in nodes.iter().enumerate() {
            if !reachable_nodes.contains(&node_index) {
                continue;
            }
            if let Some(mesh_index) = node.get("mesh").and_then(Value::as_u64) {
                expanded_primitives = expanded_primitives.saturating_add(
                    mesh_primitive_counts
                        .get(mesh_index as usize)
                        .copied()
                        .unwrap_or(0),
                );
                expanded_triangles = expanded_triangles.saturating_add(
                    mesh_triangle_counts
                        .get(mesh_index as usize)
                        .copied()
                        .unwrap_or(0),
                );
            }
        }
    }
    if expanded_primitives == 0 {
        return Err("GLBのsceneに表示可能なmesh/primitiveがありません".into());
    }
    if expanded_primitives > MAX_EXPANDED_PRIMITIVES {
        return Err("GLBのscene展開後primitive数が上限を超えています".into());
    }
    if expanded_triangles > 100_000 {
        return Err("GLBのscene展開後triangle数は10万以下にしてください".into());
    }
    let node_len = value_array_len(&root, "nodes");
    let accessors = root
        .get("accessors")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let mut animation_entries = 0usize;
    let mut expanded_tracks = 0usize;
    let mut animation_float_values = 0u64;
    if let Some(animations) = root.get("animations").and_then(Value::as_array) {
        for animation in animations {
            let channels = animation
                .get("channels")
                .and_then(Value::as_array)
                .ok_or("GLB animation.channelsがありません")?;
            let samplers = animation
                .get("samplers")
                .and_then(Value::as_array)
                .ok_or("GLB animation.samplersがありません")?;
            if channels.is_empty() || samplers.is_empty() {
                return Err("GLB animationにはchannelとsamplerが必要です".into());
            }
            animation_entries = animation_entries
                .saturating_add(channels.len())
                .saturating_add(samplers.len());
            let mut sampler_accessors = Vec::with_capacity(samplers.len());
            for sampler in samplers {
                let input_index = sampler
                    .get("input")
                    .and_then(Value::as_u64)
                    .ok_or("GLB animation sampler.inputが不正です")?
                    as usize;
                let output_index = sampler
                    .get("output")
                    .and_then(Value::as_u64)
                    .ok_or("GLB animation sampler.outputが不正です")?
                    as usize;
                let input = accessors
                    .get(input_index)
                    .ok_or("GLB animation sampler.inputがaccessors範囲外です")?;
                let output = accessors
                    .get(output_index)
                    .ok_or("GLB animation sampler.outputがaccessors範囲外です")?;
                for (label, accessor) in [("input", input), ("output", output)] {
                    if accessor.get("componentType").and_then(Value::as_u64) != Some(5126)
                        || accessor
                            .get("normalized")
                            .and_then(Value::as_bool)
                            .unwrap_or(false)
                    {
                        return Err(format!(
                            "GLB animation sampler.{label}はnormalized=falseのFLOAT accessorにしてください"
                        ));
                    }
                }
                if input.get("type").and_then(Value::as_str) != Some("SCALAR")
                    || input.get("count").and_then(Value::as_u64).unwrap_or(0) == 0
                {
                    return Err(
                        "GLB animation sampler.inputは空でないFLOAT/SCALARにしてください".into(),
                    );
                }
                let interpolation = sampler
                    .get("interpolation")
                    .and_then(Value::as_str)
                    .unwrap_or("LINEAR");
                if !matches!(interpolation, "LINEAR" | "STEP" | "CUBICSPLINE") {
                    return Err("GLB animation interpolationが不正です".into());
                }
                sampler_accessors.push((input_index, output_index, interpolation == "CUBICSPLINE"));
            }
            let mut targets = HashSet::new();
            for channel in channels {
                let sampler_index = channel
                    .get("sampler")
                    .and_then(Value::as_u64)
                    .ok_or("GLB animation channel.samplerが不正です")?
                    as usize;
                let (input_index, output_index, cubic_spline) = sampler_accessors
                    .get(sampler_index)
                    .copied()
                    .ok_or("GLB animation channel.samplerが範囲外です")?;
                let input = &accessors[input_index];
                let output = &accessors[output_index];
                let target = channel
                    .get("target")
                    .and_then(Value::as_object)
                    .ok_or("GLB animation channel.targetが不正です")?;
                let target_node = target
                    .get("node")
                    .and_then(Value::as_u64)
                    .ok_or("GLB animation target.nodeが不正です")?
                    as usize;
                if target_node >= node_len || !reachable_nodes.contains(&target_node) {
                    return Err("GLB animation target.nodeがscene範囲外です".into());
                }
                let target_path = target
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or("GLB animation target.pathが不正です")?;
                if !matches!(
                    target_path,
                    "translation" | "rotation" | "scale" | "weights"
                ) {
                    return Err("GLB animation target.pathが未対応です".into());
                }
                if !targets.insert((target_node, target_path)) {
                    return Err("GLB animation内で同じnode/pathを重複指定できません".into());
                }
                let mesh_index = root
                    .pointer(&format!("/nodes/{target_node}/mesh"))
                    .and_then(Value::as_u64)
                    .map(|index| index as usize);
                let (track_count, output_type, output_width, morph_count) = match target_path {
                    "translation" | "scale" => (1, "VEC3", 3u64, 1u64),
                    "rotation" => (1, "VEC4", 4u64, 1u64),
                    "weights" => {
                        let mesh_index = mesh_index
                            .ok_or("GLB weights animationの対象nodeにmeshがありません")?;
                        let primitive_count =
                            mesh_primitive_counts.get(mesh_index).copied().unwrap_or(0);
                        let morph_count = mesh_morph_counts.get(mesh_index).copied().unwrap_or(0);
                        if morph_count == 0 {
                            return Err(
                                "GLB weights animationの対象meshにmorph targetがありません".into(),
                            );
                        }
                        (primitive_count, "SCALAR", 1u64, morph_count as u64)
                    }
                    _ => unreachable!(),
                };
                if output.get("type").and_then(Value::as_str) != Some(output_type) {
                    return Err(format!(
                        "GLB {target_path} animationのoutput accessor typeが不正です"
                    ));
                }
                let input_count = input.get("count").and_then(Value::as_u64).unwrap_or(0);
                let spline_multiplier = if cubic_spline { 3 } else { 1 };
                let expected_output_count = input_count
                    .checked_mul(morph_count)
                    .and_then(|count| count.checked_mul(spline_multiplier))
                    .ok_or("GLB animation output countが大きすぎます")?;
                if output.get("count").and_then(Value::as_u64) != Some(expected_output_count) {
                    return Err(format!(
                        "GLB {target_path} animationのinput/output countが一致しません"
                    ));
                }
                expanded_tracks = expanded_tracks.saturating_add(track_count);
                animation_float_values = animation_float_values
                    .saturating_add(input_count.saturating_mul(track_count as u64))
                    .saturating_add(
                        expected_output_count
                            .saturating_mul(output_width)
                            .saturating_mul(track_count as u64),
                    );
            }
        }
    }
    if animation_entries > MAX_ANIMATION_CHANNELS
        || expanded_tracks > MAX_ANIMATION_CHANNELS
        || animation_float_values > MAX_ANIMATION_FLOAT_VALUES
    {
        return Err("GLBのanimation展開量が上限を超えています".into());
    }
    if let Some(skins) = root.get("skins").and_then(Value::as_array) {
        for (skin_index, skin) in skins.iter().enumerate() {
            if !used_skins.contains(&skin_index) {
                return Err("GLBにscene内meshから未使用のskinがあります".into());
            }
            let joints = skin
                .get("joints")
                .and_then(Value::as_array)
                .ok_or("GLB skin.jointsがありません")?;
            if joints.is_empty() || joints.len() > 128 {
                return Err("GLBのboneはskinごとに1〜128本です".into());
            }
            let mut joint_indexes = HashSet::new();
            for joint in joints {
                let index = joint
                    .as_u64()
                    .ok_or("GLB skin.jointsは整数indexにしてください")?
                    as usize;
                if index >= node_len || !reachable_nodes.contains(&index) {
                    return Err("GLB skin.jointsがscene内nodes範囲外です".into());
                }
                if !joint_indexes.insert(index) {
                    return Err("GLB skin.jointsに重複があります".into());
                }
            }
            if let Some(skeleton) = skin.get("skeleton") {
                let index = skeleton
                    .as_u64()
                    .ok_or("GLB skin.skeletonは整数indexにしてください")?
                    as usize;
                if index >= node_len || !reachable_nodes.contains(&index) {
                    return Err("GLB skin.skeletonがscene内nodes範囲外です".into());
                }
            }
            if let Some(inverse_bind_matrices) = skin.get("inverseBindMatrices") {
                let index = inverse_bind_matrices
                    .as_u64()
                    .ok_or("GLB skin.inverseBindMatricesは整数indexにしてください")?
                    as usize;
                let accessor = root
                    .get("accessors")
                    .and_then(Value::as_array)
                    .and_then(|accessors| accessors.get(index))
                    .ok_or("GLB skin.inverseBindMatricesがaccessors範囲外です")?;
                if accessor.get("type").and_then(Value::as_str) != Some("MAT4")
                    || accessor.get("componentType").and_then(Value::as_u64) != Some(5126)
                    || accessor.get("count").and_then(Value::as_u64) != Some(joints.len() as u64)
                {
                    return Err(
                        "GLB inverseBindMatricesはjoint数と同じFLOAT/MAT4 accessorにしてください"
                            .into(),
                    );
                }
            }
        }
    }

    let buffer_views = root.get("bufferViews").and_then(Value::as_array);
    let mut total_texture_pixels = 0u64;
    let mut image_pixels = Vec::new();
    if let Some(images) = root.get("images").and_then(Value::as_array) {
        for image in images {
            let mime = image
                .get("mimeType")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !matches!(mime, "image/png" | "image/webp") {
                return Err("GLBの埋め込み画像はPNGまたはWebPだけ使用できます".into());
            }
            let view_index = image
                .get("bufferView")
                .and_then(Value::as_u64)
                .ok_or("GLB画像にbufferViewがありません")? as usize;
            let view = buffer_views
                .and_then(|views| views.get(view_index))
                .ok_or("GLB画像のbufferViewが不正です")?;
            let start = view.get("byteOffset").and_then(Value::as_u64).unwrap_or(0) as usize;
            let length = view
                .get("byteLength")
                .and_then(Value::as_u64)
                .ok_or("GLB画像のbyteLengthがありません")? as usize;
            let end = start
                .checked_add(length)
                .ok_or("GLB画像のbyteLengthが不正です")?;
            if end > bin.len() {
                return Err("GLB画像がBIN chunk外を参照しています".into());
            }
            let (width, height) = validate_image(&bin[start..end], "GLB埋め込み画像")?;
            total_texture_pixels = total_texture_pixels
                .checked_add(u64::from(width) * u64::from(height))
                .ok_or("GLB textureの合計サイズが大きすぎます")?;
            image_pixels.push(u64::from(width) * u64::from(height));
            if total_texture_pixels > MAX_GLB_TEXTURE_PIXELS {
                return Err("GLB textureは合計8MP以下にしてください".into());
            }
        }
    }
    let sampler_count = value_array_len(&root, "samplers");
    let mut texture_uploads = HashSet::new();
    let mut uploaded_pixels = 0u64;
    if let Some(textures) = root.get("textures").and_then(Value::as_array) {
        for texture in textures {
            let source = texture
                .get("source")
                .and_then(Value::as_u64)
                .ok_or("GLB texture.sourceは整数indexで指定してください")?
                as usize;
            let pixels = image_pixels
                .get(source)
                .copied()
                .ok_or("GLB texture.sourceがimages範囲外です")?;
            let sampler = match texture.get("sampler") {
                Some(value) => {
                    let index = value
                        .as_u64()
                        .ok_or("GLB texture.samplerは整数indexで指定してください")?
                        as usize;
                    if index >= sampler_count {
                        return Err("GLB texture.samplerがsamplers範囲外です".into());
                    }
                    Some(index)
                }
                None => None,
            };
            if texture_uploads.insert((source, sampler)) {
                uploaded_pixels = uploaded_pixels
                    .checked_add(pixels)
                    .ok_or("GLB texture uploadの合計サイズが大きすぎます")?;
            }
        }
    }
    if uploaded_pixels > MAX_GLB_TEXTURE_PIXELS {
        return Err("GLB textureのGPU展開量は合計8MP以下にしてください".into());
    }
    let mut animation_names = HashSet::new();
    if let Some(animations) = root.get("animations").and_then(Value::as_array) {
        for animation in animations {
            let Some(name) = animation.get("name").and_then(Value::as_str) else {
                continue;
            };
            validate_text(name, "GLB animation name", 80, true)?;
            if !animation_names.insert(name.to_string()) {
                return Err(format!("GLB内のAnimation Clip名が重複しています: {name}"));
            }
        }
    }
    Ok(animation_names)
}

// dom-svg MODは生のHTML/CSS/SVGマークアップを一切受け取らない。scene.jsonは固定語彙の
// ノード木として構造化JSONで表現し、色・path data・寸法などの値をここで厳格に検証したうえで、
// フロント側が数値/enumからスタイルを組み立てる（MOD文字列がそのままDOM/CSSへ渡ることはない）。

struct SceneWalkState<'a> {
    animation_names: &'a HashSet<String>,
    node_budget: usize,
}

fn assert_object_keys(
    object: &serde_json::Map<String, Value>,
    allowed: &[&str],
    label: &str,
) -> Result<(), String> {
    for key in object.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(format!("{label}に未対応のキーがあります: {key}"));
        }
    }
    Ok(())
}

fn opt_f64_range(
    object: &serde_json::Map<String, Value>,
    key: &str,
    min: f64,
    max: f64,
    label: &str,
) -> Result<Option<f64>, String> {
    match object.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => {
            let number = value
                .as_f64()
                .ok_or_else(|| format!("{label}.{key}は数値にしてください"))?;
            if !number.is_finite() || number < min || number > max {
                return Err(format!("{label}.{key}は{min}〜{max}にしてください"));
            }
            Ok(Some(number))
        }
    }
}

fn validate_scene_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err("dom-svg sceneのidは半角小文字・数字・-のみ、64文字以内にしてください".into());
    }
    Ok(())
}

fn validate_scene_animation_name(name: &str) -> Result<(), String> {
    let valid = !name.is_empty()
        && name.len() <= 40
        && name.as_bytes()[0].is_ascii_lowercase()
        && name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-');
    if valid {
        Ok(())
    } else {
        Err(format!("animation名の形式が不正です: {name}"))
    }
}

fn validate_view_box(items: &[Value]) -> Result<(), String> {
    if items.len() != 2 {
        return Err("viewBoxは[width,height]の2要素にしてください".into());
    }
    for item in items {
        let number = item.as_f64().ok_or("viewBoxは数値にしてください")?;
        if !number.is_finite() || !(1.0..=4096.0).contains(&number) {
            return Err("viewBoxの値は1〜4096にしてください".into());
        }
    }
    Ok(())
}

fn validate_color(color: &str) -> Result<(), String> {
    if color.len() > 32 {
        return Err("colorが長すぎます".into());
    }
    if color == "transparent" {
        return Ok(());
    }
    if let Some(hex) = color.strip_prefix('#') {
        if matches!(hex.len(), 3 | 4 | 6 | 8) && hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Ok(());
        }
        return Err(format!("colorのhex表記が不正です: {color}"));
    }
    for (prefix, expected_components) in [("rgba(", 4), ("rgb(", 3)] {
        if let Some(rest) = color.strip_prefix(prefix) {
            let rest = rest
                .strip_suffix(')')
                .ok_or_else(|| format!("colorの括弧が不正です: {color}"))?;
            let parts: Vec<&str> = rest.split(',').map(str::trim).collect();
            if parts.len() != expected_components {
                return Err(format!("colorの要素数が不正です: {color}"));
            }
            for (index, part) in parts.iter().enumerate() {
                let number: f64 = part
                    .parse()
                    .map_err(|_| format!("colorの数値が不正です: {color}"))?;
                let max = if index == 3 { 1.0 } else { 255.0 };
                if !number.is_finite() || number < 0.0 || number > max {
                    return Err(format!("colorの数値が範囲外です: {color}"));
                }
            }
            return Ok(());
        }
    }
    Err(format!("未対応のcolor形式です: {color}"))
}

fn validate_gradient_stops(object: &serde_json::Map<String, Value>) -> Result<(), String> {
    let stops = object
        .get("stops")
        .and_then(Value::as_array)
        .ok_or("paintにstopsが必要です")?;
    if stops.is_empty() || stops.len() > MAX_GRADIENT_STOPS {
        return Err(format!("paint.stopsは1〜{MAX_GRADIENT_STOPS}個にしてください"));
    }
    for stop in stops {
        let stop_object = stop.as_object().ok_or("paint.stopはobjectにしてください")?;
        assert_object_keys(stop_object, &["color", "at"], "paint.stop")?;
        let color = stop_object
            .get("color")
            .and_then(Value::as_str)
            .ok_or("paint.stopにcolorが必要です")?;
        validate_color(color)?;
        opt_f64_range(stop_object, "at", 0.0, 100.0, "paint.stop")?
            .ok_or("paint.stopにatが必要です")?;
    }
    Ok(())
}

fn validate_paint(value: &Value) -> Result<(), String> {
    let object = value.as_object().ok_or("paintはobjectにしてください")?;
    let paint_type = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or("paint.typeが必要です")?;
    match paint_type {
        "solid" => {
            assert_object_keys(object, &["type", "color"], "solid paint")?;
            let color = object
                .get("color")
                .and_then(Value::as_str)
                .ok_or("solid paintにcolorが必要です")?;
            validate_color(color)?;
        }
        "linear" => {
            assert_object_keys(object, &["type", "angle", "stops"], "linear paint")?;
            opt_f64_range(object, "angle", -360.0, 360.0, "linear paint")?
                .ok_or("linear paintにangleが必要です")?;
            validate_gradient_stops(object)?;
        }
        "radial" => {
            assert_object_keys(object, &["type", "shape", "cx", "cy", "stops"], "radial paint")?;
            let shape = object
                .get("shape")
                .and_then(Value::as_str)
                .ok_or("radial paintにshapeが必要です")?;
            if !matches!(shape, "ellipse" | "circle") {
                return Err("radial paint.shapeはellipseまたはcircleにしてください".into());
            }
            opt_f64_range(object, "cx", -100.0, 200.0, "radial paint")?
                .ok_or("radial paintにcxが必要です")?;
            opt_f64_range(object, "cy", -100.0, 200.0, "radial paint")?
                .ok_or("radial paintにcyが必要です")?;
            validate_gradient_stops(object)?;
        }
        other => return Err(format!("未対応のpaint.typeです: {other}")),
    }
    Ok(())
}

// backgroundは単一paint、またはCSSと同じ「先頭が最前面」のレイヤー配列を取れる
fn validate_background(value: &Value) -> Result<(), String> {
    let layers = match value.as_array() {
        Some(layers) => {
            if layers.is_empty() || layers.len() > MAX_BACKGROUND_LAYERS {
                return Err(format!(
                    "backgroundのレイヤーは1〜{MAX_BACKGROUND_LAYERS}枚にしてください"
                ));
            }
            layers.as_slice()
        }
        None => std::slice::from_ref(value),
    };
    for layer in layers {
        validate_paint(layer)?;
    }
    Ok(())
}

fn validate_shadow_list(value: &Value, label: &str, allow_inset: bool) -> Result<(), String> {
    let shadows = value
        .as_array()
        .ok_or_else(|| format!("{label}は配列にしてください"))?;
    if shadows.is_empty() || shadows.len() > MAX_SHADOWS {
        return Err(format!("{label}は1〜{MAX_SHADOWS}個にしてください"));
    }
    for shadow in shadows {
        let object = shadow
            .as_object()
            .ok_or_else(|| format!("{label}の要素はobjectにしてください"))?;
        let allowed: &[&str] = if allow_inset {
            &["dx", "dy", "blur", "spread", "color", "inset"]
        } else {
            &["dx", "dy", "blur", "color"]
        };
        assert_object_keys(object, allowed, label)?;
        opt_f64_range(object, "dx", -50.0, 50.0, label)?.ok_or(format!("{label}にdxが必要です"))?;
        opt_f64_range(object, "dy", -50.0, 50.0, label)?.ok_or(format!("{label}にdyが必要です"))?;
        opt_f64_range(object, "blur", 0.0, 50.0, label)?;
        if allow_inset {
            opt_f64_range(object, "spread", -50.0, 50.0, label)?;
            if object
                .get("inset")
                .is_some_and(|value| !value.is_boolean())
            {
                return Err(format!("{label}.insetは真偽値にしてください"));
            }
        }
        let color = object
            .get("color")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("{label}にcolorが必要です"))?;
        validate_color(color)?;
    }
    Ok(())
}

fn validate_border(value: &Value, label: &str) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| format!("{label}はobjectにしてください"))?;
    assert_object_keys(object, &["width", "color"], label)?;
    opt_f64_range(object, "width", 0.0, 20.0, label)?.ok_or(format!("{label}にwidthが必要です"))?;
    let color = object
        .get("color")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{label}にcolorが必要です"))?;
    validate_color(color)
}

fn validate_border_radius(value: &str) -> Result<(), String> {
    if value.len() > 64 {
        return Err("borderRadiusが長すぎます".into());
    }
    let mut token_count = 0usize;
    for token in value.split(|c: char| c == ' ' || c == '/') {
        if token.is_empty() {
            continue;
        }
        // CSSと同じく、ゼロだけは単位なしで書ける
        let number_part = match token.strip_suffix('%') {
            Some(number_part) => number_part,
            None if token == "0" => token,
            None => return Err(format!("borderRadiusは%指定にしてください: {value}")),
        };
        let number: f64 = number_part
            .parse()
            .map_err(|_| format!("borderRadiusの数値が不正です: {value}"))?;
        if !number.is_finite() || !(0.0..=100.0).contains(&number) {
            return Err(format!("borderRadiusは0〜100%にしてください: {value}"));
        }
        token_count += 1;
        if token_count > 8 {
            return Err("borderRadiusの指定数が多すぎます".into());
        }
    }
    if token_count == 0 {
        return Err("borderRadiusが空です".into());
    }
    Ok(())
}

fn validate_clip_path(value: &str) -> Result<(), String> {
    if value.len() > 512 {
        return Err("clipPathが長すぎます".into());
    }
    let inner = value
        .strip_prefix("polygon(")
        .and_then(|rest| rest.strip_suffix(')'))
        .ok_or("clipPathはpolygon(...)にしてください")?;
    let points: Vec<&str> = inner.split(',').collect();
    if points.is_empty() || points.len() > MAX_CLIP_PATH_POINTS {
        return Err(format!(
            "clipPathの頂点数は1〜{MAX_CLIP_PATH_POINTS}個にしてください"
        ));
    }
    for point in points {
        let coords: Vec<&str> = point.split_whitespace().collect();
        if coords.len() != 2 {
            return Err("clipPathの頂点は\"x% y%\"の形式にしてください".into());
        }
        for coord in coords {
            let number_part = match coord.strip_suffix('%') {
                Some(number_part) => number_part,
                None if coord == "0" => coord,
                None => return Err("clipPathの座標は%指定にしてください".into()),
            };
            let number: f64 = number_part
                .parse()
                .map_err(|_| "clipPathの数値が不正です".to_string())?;
            if !number.is_finite() || !(-50.0..=150.0).contains(&number) {
                return Err("clipPathの座標は-50〜150%にしてください".into());
            }
        }
    }
    Ok(())
}

fn validate_path_data(d: &str) -> Result<(), String> {
    if d.is_empty() || d.chars().count() > MAX_PATH_DATA_CHARS {
        return Err(format!(
            "path dataは1〜{MAX_PATH_DATA_CHARS}文字にしてください"
        ));
    }
    if !d.bytes().all(|byte| PATH_DATA_ALLOWED_BYTES.contains(&byte)) {
        return Err("path dataに使用できない文字が含まれています".into());
    }
    let first = d.trim_start().bytes().next();
    if !matches!(first, Some(b'M') | Some(b'm')) {
        return Err("path dataはMまたはmで始めてください".into());
    }
    Ok(())
}

fn validate_animation_ref(
    object: &serde_json::Map<String, Value>,
    animation_names: &HashSet<String>,
    label: &str,
) -> Result<(), String> {
    if let Some(animation) = object.get("animation") {
        let name = animation
            .as_str()
            .ok_or_else(|| format!("{label}.animationは文字列にしてください"))?;
        if !animation_names.contains(name) {
            return Err(format!("未定義のanimationを参照しています: {name}"));
        }
    }
    Ok(())
}

fn validate_transform_origin(
    object: &serde_json::Map<String, Value>,
    label: &str,
) -> Result<(), String> {
    let Some(origin) = object.get("transformOrigin") else {
        return Ok(());
    };
    let items = origin
        .as_array()
        .ok_or_else(|| format!("{label}.transformOriginは[x,y]にしてください"))?;
    if items.len() != 2 {
        return Err(format!("{label}.transformOriginは[x,y]の2要素にしてください"));
    }
    for item in items {
        let number = item
            .as_f64()
            .ok_or_else(|| format!("{label}.transformOriginは数値にしてください"))?;
        if !number.is_finite() {
            return Err(format!("{label}.transformOriginは有限数にしてください"));
        }
    }
    Ok(())
}

fn validate_visible_in(
    object: &serde_json::Map<String, Value>,
    label: &str,
) -> Result<(), String> {
    let Some(visible_in) = object.get("visibleIn") else {
        return Ok(());
    };
    let items = visible_in
        .as_array()
        .ok_or_else(|| format!("{label}.visibleInは配列にしてください"))?;
    if items.len() > ALLOWED_EXPRESSIONS.len() {
        return Err(format!("{label}.visibleInの要素数が多すぎます"));
    }
    let mut seen = HashSet::new();
    for item in items {
        let expression = item
            .as_str()
            .ok_or_else(|| format!("{label}.visibleInは文字列配列にしてください"))?;
        if !ALLOWED_EXPRESSIONS.contains(&expression) {
            return Err(format!("未対応のexpressionです: {expression}"));
        }
        if !seen.insert(expression) {
            return Err(format!("{label}.visibleInに重複があります"));
        }
    }
    Ok(())
}

fn validate_common_node_fields(
    object: &serde_json::Map<String, Value>,
    animation_names: &HashSet<String>,
) -> Result<(), String> {
    if let Some(id) = object.get("id") {
        let id = id.as_str().ok_or("node.idは文字列にしてください")?;
        validate_scene_id(id)?;
    }
    for key in ["left", "right", "top", "bottom", "width", "height"] {
        opt_f64_range(object, key, -200.0, 300.0, "node")?;
    }
    opt_f64_range(object, "z", 0.0, 200.0, "node")?;
    for key in ["rotate", "rotateX", "rotateY"] {
        opt_f64_range(object, key, -360.0, 360.0, "node")?;
    }
    opt_f64_range(object, "translateX", -200.0, 200.0, "node")?;
    opt_f64_range(object, "translateY", -200.0, 200.0, "node")?;
    for key in ["scale", "scaleX", "scaleY"] {
        opt_f64_range(object, key, 0.01, 10.0, "node")?;
    }
    opt_f64_range(object, "opacity", 0.0, 1.0, "node")?;
    if object
        .get("overflowHidden")
        .is_some_and(|value| !value.is_boolean())
    {
        return Err("node.overflowHiddenは真偽値にしてください".into());
    }
    if let Some(filter) = object.get("filter") {
        validate_shadow_list(filter, "node.filter", false)?;
    }
    validate_animation_ref(object, animation_names, "node")?;
    validate_transform_origin(object, "node")?;
    validate_visible_in(object, "node")?;
    Ok(())
}

// 全nodeが共通で持てるキー。各kindはこれに固有キーを足したものを許可する
macro_rules! common_node_keys {
    ($($extra:literal),* $(,)?) => {
        &[
            "kind", "id",
            "left", "right", "top", "bottom", "width", "height",
            "z", "rotate", "rotateX", "rotateY", "translateX", "translateY", "scale", "scaleX", "scaleY",
            "opacity", "overflowHidden", "filter",
            "animation", "transformOrigin", "visibleIn",
            $($extra,)*
        ]
    };
}

const GROUP_NODE_KEYS: &[&str] = common_node_keys!("children");
const BOX_NODE_KEYS: &[&str] = common_node_keys!(
    "children",
    "background",
    "borderRadius",
    "clipPath",
    "border",
    "borderBottom",
    "boxShadow",
);
const SVG_NODE_KEYS: &[&str] = common_node_keys!("children", "viewBox");

fn validate_shape_common_fields(
    object: &serde_json::Map<String, Value>,
    animation_names: &HashSet<String>,
) -> Result<(), String> {
    if let Some(id) = object.get("id") {
        let id = id.as_str().ok_or("shape.idは文字列にしてください")?;
        validate_scene_id(id)?;
    }
    opt_f64_range(object, "opacity", 0.0, 1.0, "shape")?;
    validate_animation_ref(object, animation_names, "shape")?;
    validate_transform_origin(object, "shape")?;
    validate_visible_in(object, "shape")?;
    Ok(())
}

// 全shapeが共通で持てるキー。塗り・線を持つshapeはさらにpaint系を足す
macro_rules! shape_paint_keys {
    ($($extra:literal),* $(,)?) => {
        &[
            "kind", "id", "opacity", "animation", "transformOrigin", "visibleIn",
            "fill", "stroke", "strokeWidth", "strokeLinecap", "strokeLinejoin", "nonScalingStroke",
            $($extra,)*
        ]
    };
}

const PATH_SHAPE_KEYS: &[&str] = shape_paint_keys!("d");
const ELLIPSE_SHAPE_KEYS: &[&str] = shape_paint_keys!("cx", "cy", "rx", "ry");
const RECT_SHAPE_KEYS: &[&str] = shape_paint_keys!("x", "y", "width", "height", "rx");

// path / ellipse / rect が共通で持つ塗り・線の指定
fn validate_shape_paint_fields(object: &serde_json::Map<String, Value>) -> Result<(), String> {
    if let Some(fill) = object.get("fill") {
        validate_paint(fill)?;
    }
    if let Some(stroke) = object.get("stroke") {
        validate_paint(stroke)?;
    }
    opt_f64_range(object, "strokeWidth", 0.0, 20.0, "shape")?;
    if let Some(linecap) = object.get("strokeLinecap") {
        let linecap = linecap
            .as_str()
            .ok_or("shape.strokeLinecapは文字列にしてください")?;
        if !ALLOWED_STROKE_LINECAPS.contains(&linecap) {
            return Err(format!("未対応のstrokeLinecapです: {linecap}"));
        }
    }
    if let Some(linejoin) = object.get("strokeLinejoin") {
        let linejoin = linejoin
            .as_str()
            .ok_or("shape.strokeLinejoinは文字列にしてください")?;
        if !ALLOWED_STROKE_LINEJOINS.contains(&linejoin) {
            return Err(format!("未対応のstrokeLinejoinです: {linejoin}"));
        }
    }
    if object
        .get("nonScalingStroke")
        .is_some_and(|value| !value.is_boolean())
    {
        return Err("shape.nonScalingStrokeは真偽値にしてください".into());
    }
    Ok(())
}

fn validate_scene_node(
    value: &Value,
    depth: usize,
    state: &mut SceneWalkState,
) -> Result<(), String> {
    if depth > MAX_SCENE_DEPTH {
        return Err("dom-svg sceneのネスト階層が深すぎます".into());
    }
    state.node_budget = state
        .node_budget
        .checked_sub(1)
        .ok_or("dom-svg sceneのノード数が上限を超えています")?;
    let object = value.as_object().ok_or("dom-svg sceneのnodeはobjectにしてください")?;
    let kind = object
        .get("kind")
        .and_then(Value::as_str)
        .ok_or("dom-svg sceneのnodeにkindが必要です")?;
    match kind {
        "group" => {
            assert_object_keys(object, GROUP_NODE_KEYS, "group node")?;
            validate_common_node_fields(object, state.animation_names)?;
            let children = object
                .get("children")
                .and_then(Value::as_array)
                .ok_or("groupにはchildrenが必要です")?;
            for child in children {
                validate_scene_node(child, depth + 1, state)?;
            }
        }
        "box" => {
            assert_object_keys(object, BOX_NODE_KEYS, "box node")?;
            validate_common_node_fields(object, state.animation_names)?;
            if let Some(background) = object.get("background") {
                validate_background(background)?;
            }
            if let Some(border_radius) = object.get("borderRadius") {
                let value = border_radius
                    .as_str()
                    .ok_or("box.borderRadiusは文字列にしてください")?;
                validate_border_radius(value)?;
            }
            if let Some(clip_path) = object.get("clipPath") {
                let value = clip_path
                    .as_str()
                    .ok_or("box.clipPathは文字列にしてください")?;
                validate_clip_path(value)?;
            }
            if let Some(border) = object.get("border") {
                validate_border(border, "box.border")?;
            }
            if let Some(border_bottom) = object.get("borderBottom") {
                validate_border(border_bottom, "box.borderBottom")?;
            }
            if let Some(box_shadow) = object.get("boxShadow") {
                validate_shadow_list(box_shadow, "box.boxShadow", true)?;
            }
            if let Some(children) = object.get("children") {
                let children = children
                    .as_array()
                    .ok_or("box.childrenは配列にしてください")?;
                for child in children {
                    validate_scene_node(child, depth + 1, state)?;
                }
            }
        }
        "svg" => {
            assert_object_keys(object, SVG_NODE_KEYS, "svg node")?;
            validate_common_node_fields(object, state.animation_names)?;
            let view_box = object
                .get("viewBox")
                .and_then(Value::as_array)
                .ok_or("svg nodeにはviewBoxが必要です")?;
            validate_view_box(view_box)?;
            let children = object
                .get("children")
                .and_then(Value::as_array)
                .ok_or("svg nodeにはchildrenが必要です")?;
            for child in children {
                validate_scene_shape(child, depth + 1, state)?;
            }
        }
        other => return Err(format!("未対応のnode kindです: {other}")),
    }
    Ok(())
}

fn validate_scene_shape(
    value: &Value,
    depth: usize,
    state: &mut SceneWalkState,
) -> Result<(), String> {
    if depth > MAX_SCENE_DEPTH {
        return Err("dom-svg sceneのネスト階層が深すぎます".into());
    }
    state.node_budget = state
        .node_budget
        .checked_sub(1)
        .ok_or("dom-svg sceneのノード数が上限を超えています")?;
    let object = value
        .as_object()
        .ok_or("dom-svg sceneのshapeはobjectにしてください")?;
    let kind = object
        .get("kind")
        .and_then(Value::as_str)
        .ok_or("dom-svg sceneのshapeにkindが必要です")?;
    match kind {
        "path" => {
            assert_object_keys(object, PATH_SHAPE_KEYS, "path")?;
            validate_shape_common_fields(object, state.animation_names)?;
            let d = object
                .get("d")
                .and_then(Value::as_str)
                .ok_or("pathにはdが必要です")?;
            validate_path_data(d)?;
            validate_shape_paint_fields(object)?;
        }
        "ellipse" => {
            assert_object_keys(object, ELLIPSE_SHAPE_KEYS, "ellipse")?;
            validate_shape_common_fields(object, state.animation_names)?;
            for key in ["cx", "cy", "rx", "ry"] {
                opt_f64_range(object, key, -2000.0, 4096.0, "ellipse")?
                    .ok_or_else(|| format!("ellipseに{key}が必要です"))?;
            }
            validate_shape_paint_fields(object)?;
        }
        "rect" => {
            assert_object_keys(object, RECT_SHAPE_KEYS, "rect")?;
            validate_shape_common_fields(object, state.animation_names)?;
            for key in ["x", "y", "width", "height"] {
                opt_f64_range(object, key, -2000.0, 4096.0, "rect")?
                    .ok_or_else(|| format!("rectに{key}が必要です"))?;
            }
            opt_f64_range(object, "rx", 0.0, 2048.0, "rect")?;
            validate_shape_paint_fields(object)?;
        }
        "shapeGroup" => {
            assert_object_keys(
                object,
                &[
                    "kind",
                    "id",
                    "opacity",
                    "animation",
                    "transformOrigin",
                    "visibleIn",
                    "children",
                ],
                "shapeGroup",
            )?;
            validate_shape_common_fields(object, state.animation_names)?;
            let children = object
                .get("children")
                .and_then(Value::as_array)
                .ok_or("shapeGroupにはchildrenが必要です")?;
            for child in children {
                validate_scene_shape(child, depth + 1, state)?;
            }
        }
        other => return Err(format!("未対応のshape kindです: {other}")),
    }
    Ok(())
}

fn validate_scene_animations(value: Option<&Value>) -> Result<HashSet<String>, String> {
    let mut names = HashSet::new();
    let Some(value) = value else {
        return Ok(names);
    };
    let object = value
        .as_object()
        .ok_or("scene.animationsはobjectにしてください")?;
    if object.len() > MAX_SCENE_ANIMATIONS {
        return Err(format!(
            "scene.animationsは{MAX_SCENE_ANIMATIONS}個までにしてください"
        ));
    }
    for (name, definition) in object {
        validate_scene_animation_name(name)?;
        if !names.insert(name.clone()) {
            return Err(format!("animation名が重複しています: {name}"));
        }
        let def_object = definition
            .as_object()
            .ok_or_else(|| format!("animation定義はobjectにしてください: {name}"))?;
        assert_object_keys(
            def_object,
            &["durationMs", "easing", "iteration", "delayMs", "keyframes"],
            "animation",
        )?;
        opt_f64_range(def_object, "durationMs", 100.0, 30_000.0, "animation")?
            .ok_or_else(|| format!("animation.durationMsが必要です: {name}"))?;
        let easing = def_object
            .get("easing")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("animation.easingが必要です: {name}"))?;
        if !ALLOWED_EASINGS.contains(&easing) {
            return Err(format!("未対応のeasingです: {easing}"));
        }
        match def_object.get("iteration") {
            Some(Value::String(value)) if value == "infinite" => {}
            Some(Value::Number(number)) => {
                let count = number
                    .as_f64()
                    .ok_or_else(|| format!("animation.iterationが不正です: {name}"))?;
                if !count.is_finite() || !(1.0..=1000.0).contains(&count) {
                    return Err(format!("animation.iterationは1〜1000にしてください: {name}"));
                }
            }
            _ => {
                return Err(format!(
                    "animation.iterationは\"infinite\"または1〜1000の数値にしてください: {name}"
                ))
            }
        }
        opt_f64_range(def_object, "delayMs", 0.0, 10_000.0, "animation")?;
        let keyframes = def_object
            .get("keyframes")
            .and_then(Value::as_array)
            .ok_or_else(|| format!("animation.keyframesが必要です: {name}"))?;
        if keyframes.is_empty() || keyframes.len() > MAX_KEYFRAMES_PER_ANIMATION {
            return Err(format!(
                "animation.keyframesは1〜{MAX_KEYFRAMES_PER_ANIMATION}個にしてください: {name}"
            ));
        }
        let mut previous_at = -1.0f64;
        for keyframe in keyframes {
            let keyframe_object = keyframe
                .as_object()
                .ok_or_else(|| format!("keyframeはobjectにしてください: {name}"))?;
            assert_object_keys(keyframe_object, &["at", "transform", "opacity"], "keyframe")?;
            let at = opt_f64_range(keyframe_object, "at", 0.0, 100.0, "keyframe")?
                .ok_or_else(|| format!("keyframe.atが必要です: {name}"))?;
            if at <= previous_at {
                return Err(format!("keyframe.atは昇順にしてください: {name}"));
            }
            previous_at = at;
            if let Some(transform) = keyframe_object.get("transform") {
                let transform_object = transform
                    .as_object()
                    .ok_or_else(|| format!("keyframe.transformはobjectにしてください: {name}"))?;
                assert_object_keys(
                    transform_object,
                    &[
                        "rotate", "rotateX", "rotateY",
                        "translateX", "translateY",
                        "scale", "scaleX", "scaleY",
                    ],
                    "keyframe.transform",
                )?;
                for key in ["rotate", "rotateX", "rotateY"] {
                    opt_f64_range(transform_object, key, -360.0, 360.0, "transform")?;
                }
                opt_f64_range(transform_object, "translateX", -200.0, 200.0, "transform")?;
                opt_f64_range(transform_object, "translateY", -200.0, 200.0, "transform")?;
                for key in ["scale", "scaleX", "scaleY"] {
                    opt_f64_range(transform_object, key, 0.01, 10.0, "transform")?;
                }
            }
            opt_f64_range(keyframe_object, "opacity", 0.0, 1.0, "keyframe")?;
        }
    }
    Ok(names)
}

fn validate_scene(bytes: &[u8]) -> Result<HashSet<String>, String> {
    let root: Value = serde_json::from_slice(bytes)
        .map_err(|error| format!("scene.jsonを解析できません: {error}"))?;
    let object = root.as_object().ok_or("scene.jsonはobjectにしてください")?;
    assert_object_keys(
        object,
        &["sceneVersion", "viewBox", "animations", "root"],
        "scene.json",
    )?;

    let scene_version = object
        .get("sceneVersion")
        .and_then(Value::as_u64)
        .ok_or("scene.jsonにsceneVersionが必要です")?;
    if scene_version != 1 {
        return Err(format!("未対応のsceneVersionです: {scene_version}"));
    }
    let view_box = object
        .get("viewBox")
        .and_then(Value::as_array)
        .ok_or("scene.jsonにviewBoxが必要です")?;
    validate_view_box(view_box)?;

    let animation_names = validate_scene_animations(object.get("animations"))?;

    let root_nodes = object
        .get("root")
        .and_then(Value::as_array)
        .ok_or("scene.jsonにrootが必要です")?;
    if root_nodes.is_empty() {
        return Err("scene.jsonのrootは最低1個のnodeが必要です".into());
    }
    let mut state = SceneWalkState {
        animation_names: &animation_names,
        node_budget: MAX_SCENE_NODES,
    };
    for node in root_nodes {
        validate_scene_node(node, 1, &mut state)?;
    }
    Ok(animation_names)
}

fn validate_scene_motion_refs(
    manifest: &CharacterModManifest,
    animation_names: Option<&HashSet<String>>,
) -> Result<(), String> {
    let CharacterSource::Scene { motions, .. } = &manifest.source else {
        return Ok(());
    };
    let animation_names = animation_names.ok_or("dom-svg sceneのanimationを検証できませんでした")?;
    for (motion_name, motion) in motions {
        for animation in motion.animations.iter().chain(&motion.pose_animation) {
            if !animation_names.contains(animation) {
                return Err(format!(
                    "{motion_name}が参照するanimationがsceneにありません: {animation}"
                ));
            }
        }
    }
    Ok(())
}

fn asset_declarations(manifest: &CharacterModManifest) -> Vec<AssetDeclaration> {
    let mut declarations = Vec::new();
    if let Some(thumbnail) = &manifest.thumbnail {
        declarations.push(AssetDeclaration {
            key: "thumbnail".into(),
            relative_path: thumbnail.clone(),
            role: AssetRole::Thumbnail,
        });
    }
    match &manifest.source {
        CharacterSource::Sheet { file, .. } => declarations.push(AssetDeclaration {
            key: "sheet".into(),
            relative_path: file.clone(),
            role: AssetRole::Sprite,
        }),
        CharacterSource::Sequence { motions } => {
            for (motion_name, motion) in motions {
                for (index, file) in motion.files.iter().enumerate() {
                    declarations.push(AssetDeclaration {
                        key: format!("sequence:{motion_name}:{index}"),
                        relative_path: file.clone(),
                        role: AssetRole::Sprite,
                    });
                }
            }
        }
        CharacterSource::Model { file, .. } => declarations.push(AssetDeclaration {
            key: "model".into(),
            relative_path: file.clone(),
            role: AssetRole::Model,
        }),
        CharacterSource::Scene { file, .. } => declarations.push(AssetDeclaration {
            key: "scene".into(),
            relative_path: file.clone(),
            role: AssetRole::Scene,
        }),
    }
    declarations.sort_by(|left, right| left.key.cmp(&right.key));
    declarations
}

fn normalize_sheet_layout(
    manifest: &mut CharacterModManifest,
    sheet_bytes: Option<&[u8]>,
) -> Result<(), String> {
    let CharacterSource::Sheet {
        frame_width,
        frame_height,
        columns,
        rows,
        motions,
        ..
    } = &mut manifest.source
    else {
        return Ok(());
    };
    let bytes = sheet_bytes.ok_or("sprite sheetの検証済みassetがありません")?;
    let (image_width, image_height) = image_dimensions(bytes)?;
    let expected_width = frame_width
        .checked_mul(*columns)
        .ok_or("sprite sheetの横幅指定が大きすぎます")?;
    if image_width != expected_width {
        return Err(format!(
            "sprite sheetの横幅はframeWidth × columns（{expected_width}px）にしてください"
        ));
    }
    if image_height % *frame_height != 0 {
        return Err("sprite sheetの縦幅はframeHeightの倍数にしてください".into());
    }
    let actual_rows = image_height / *frame_height;
    if !(1..=64).contains(&actual_rows) {
        return Err("sprite sheetの実際のrowsは1〜64にしてください".into());
    }
    if rows.is_some_and(|declared| declared != actual_rows) {
        return Err(format!(
            "sprite sheetのrows指定と画像の実寸が一致しません（実寸: {actual_rows}行）"
        ));
    }
    let available_frames = columns
        .checked_mul(actual_rows)
        .ok_or("sprite sheetのコマ数が大きすぎます")?;
    if motions
        .values()
        .flat_map(|motion| motion.frames.iter())
        .any(|frame| *frame >= available_frames)
    {
        return Err("sprite sheetに画像範囲外のframeがあります".into());
    }
    *rows = Some(actual_rows);
    Ok(())
}

fn validate_model_motion_clips(
    manifest: &CharacterModManifest,
    animation_names: Option<&HashSet<String>>,
) -> Result<(), String> {
    let CharacterSource::Model { motions, .. } = &manifest.source else {
        return Ok(());
    };
    let animation_names = animation_names.ok_or("GLBのAnimation Clipを検証できませんでした")?;
    for (motion_name, motion) in motions {
        if !animation_names.contains(&motion.clip) {
            return Err(format!(
                "{motion_name}が参照するAnimation ClipがGLBにありません: {}",
                motion.clip
            ));
        }
    }
    Ok(())
}

fn validate_asset_extension(path: &Path, role: AssetRole) -> Result<(), String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let valid = match role {
        AssetRole::Thumbnail | AssetRole::Sprite => matches!(extension.as_str(), "png" | "webp"),
        AssetRole::Model => extension == "glb",
        AssetRole::Scene => extension == "json",
    };
    if valid {
        Ok(())
    } else {
        Err(match role {
            AssetRole::Thumbnail | AssetRole::Sprite => {
                "2D画像は.pngまたは.webpにしてください".into()
            }
            AssetRole::Model => "3Dモデルは単一.glbにしてください".into(),
            AssetRole::Scene => "dom-svgのsceneは単一.jsonにしてください".into(),
        })
    }
}

fn load_package(mod_dir: &Path) -> Result<LoadedPackage, String> {
    let canonical_parent =
        fs::canonicalize(mod_dir.parent().ok_or("MODフォルダーの親がありません")?)
            .map_err(|error| format!("MODルートを確認できません: {error}"))?;
    let canonical_mod = fs::canonicalize(mod_dir)
        .map_err(|error| format!("MODフォルダーを確認できません: {error}"))?;
    if !canonical_mod.starts_with(&canonical_parent) {
        return Err("symlink / junctionでMODルート外を参照しています".into());
    }

    let manifest_path = canonical_asset_path(&canonical_mod, MANIFEST_NAME)?;
    let manifest_bytes = read_limited(&manifest_path, MAX_MANIFEST_BYTES, MANIFEST_NAME)?;
    let mut manifest: CharacterModManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| format!("character.jsonを解析できません: {error}"))?;
    validate_manifest(&manifest)?;

    let mut hasher = Sha256::new();
    hasher.update(&manifest_bytes);
    let mut total_bytes = manifest_bytes.len() as u64;
    let mut seen_asset_paths = HashSet::new();
    let mut assets = HashMap::new();
    let mut model_animation_names = None;
    let mut scene_animation_names = None;
    let mut sheet_bytes = None;
    let mut total_sprite_pixels = 0u64;

    for declaration in asset_declarations(&manifest) {
        let path = canonical_asset_path(&canonical_mod, &declaration.relative_path)?;
        if !seen_asset_paths.insert(path.clone()) {
            return Err(format!(
                "同じassetファイルを複数の用途・コマで再利用できません: {}",
                declaration.relative_path
            ));
        }
        validate_asset_extension(&path, declaration.role)?;
        let limit = match declaration.role {
            AssetRole::Thumbnail => MAX_THUMBNAIL_BYTES,
            AssetRole::Sprite => MAX_IMAGE_BYTES,
            AssetRole::Model => MAX_GLB_BYTES,
            AssetRole::Scene => MAX_SCENE_BYTES,
        };
        let bytes = Arc::new(read_limited(&path, limit, &declaration.relative_path)?);
        total_bytes = total_bytes.saturating_add(bytes.len() as u64);
        if total_bytes > MAX_PACKAGE_BYTES {
            return Err("MODパッケージが合計48 MiBを超えています".into());
        }
        match declaration.role {
            AssetRole::Thumbnail => {
                let (width, height) = validate_image(&bytes, &declaration.relative_path)?;
                if width > MAX_THUMBNAIL_DIMENSION || height > MAX_THUMBNAIL_DIMENSION {
                    return Err("thumbnailは512×512px以内にしてください".into());
                }
            }
            AssetRole::Sprite => {
                let (width, height) = validate_image(&bytes, &declaration.relative_path)?;
                total_sprite_pixels = total_sprite_pixels
                    .checked_add(u64::from(width) * u64::from(height))
                    .ok_or("2D画像の合計展開サイズが大きすぎます")?;
                if total_sprite_pixels > MAX_SPRITE_TEXTURE_PIXELS {
                    return Err("2D画像はパッケージ合計32MP以下にしてください".into());
                }
            }
            AssetRole::Model => model_animation_names = Some(validate_glb(&bytes)?),
            AssetRole::Scene => scene_animation_names = Some(validate_scene(&bytes)?),
        }
        if declaration.key == "sheet" {
            sheet_bytes = Some(bytes.clone());
        }
        hasher.update(declaration.key.as_bytes());
        hasher.update(bytes.as_slice());
        assets.insert(
            declaration.key,
            RegisteredAsset {
                path,
                byte_len: bytes.len() as u64,
                digest: Sha256::digest(bytes.as_slice()).into(),
            },
        );
    }
    normalize_sheet_layout(&mut manifest, sheet_bytes.as_deref().map(Vec::as_slice))?;
    validate_model_motion_clips(&manifest, model_animation_names.as_ref())?;
    validate_scene_motion_refs(&manifest, scene_animation_names.as_ref())?;

    let revision = format!("{:x}", hasher.finalize());
    Ok(LoadedPackage {
        descriptor: CharacterModPackage {
            manifest,
            revision,
            origin: CharacterModOrigin::User,
        },
        assets,
    })
}

fn mod_directories(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut directories = Vec::new();
    let entries =
        fs::read_dir(root).map_err(|error| format!("MODフォルダーを読めません: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("MODフォルダー項目を読めません: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("MOD項目を確認できません: {error}"))?;
        // ドット始まり(インストール一時フォルダーなど)はMODとして扱わない
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        if file_type.is_dir() || file_type.is_symlink() {
            directories.push(entry.path());
        }
    }
    directories.sort();
    if directories.len() > MAX_MODS {
        directories.truncate(MAX_MODS);
    }
    Ok(directories)
}

struct ArchiveBudget {
    entries: usize,
    bytes: u64,
}

impl ArchiveBudget {
    fn new() -> Self {
        Self {
            entries: MAX_ARCHIVE_ENTRIES,
            bytes: MAX_ARCHIVE_UNPACKED_BYTES,
        }
    }
}

fn should_skip_archive_entry(relative: &str) -> bool {
    if relative.split('/').next() == Some("__MACOSX") {
        return true;
    }
    relative
        .rsplit('/')
        .next()
        .is_some_and(|name| SKIPPED_ARCHIVE_FILES.contains(&name))
}

fn write_archive_entry(
    dest_root: &Path,
    relative: &str,
    reader: &mut dyn Read,
    budget: &mut ArchiveBudget,
) -> Result<(), String> {
    validate_relative_path(relative)?;
    budget.entries = budget
        .entries
        .checked_sub(1)
        .ok_or("アーカイブのファイル数が上限（600）を超えています")?;
    let target = dest_root.join(relative);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("展開先フォルダーを作成できません: {error}"))?;
    }
    let mut file = File::create(&target)
        .map_err(|error| format!("展開先ファイルを作成できません（{relative}）: {error}"))?;
    let written = std::io::copy(&mut reader.take(budget.bytes.saturating_add(1)), &mut file)
        .map_err(|error| format!("アーカイブを展開できません（{relative}）: {error}"))?;
    if written > budget.bytes {
        return Err("アーカイブの展開後サイズが上限（64 MiB）を超えています".into());
    }
    budget.bytes -= written;
    Ok(())
}

fn extract_zip_archive(archive_path: &Path, dest_root: &Path) -> Result<(), String> {
    let file =
        File::open(archive_path).map_err(|error| format!("アーカイブを開けません: {error}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|error| format!("ZIPを読めません: {error}"))?;
    let mut budget = ArchiveBudget::new();
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("ZIP内のファイルを読めません: {error}"))?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().replace('\\', "/");
        let name = name.strip_prefix("./").unwrap_or(&name).to_string();
        if should_skip_archive_entry(&name) {
            continue;
        }
        write_archive_entry(dest_root, &name, &mut entry, &mut budget)?;
    }
    Ok(())
}

struct CappedWriter {
    bytes: Vec<u8>,
    cap: u64,
}

impl Write for CappedWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if self.bytes.len() as u64 + buf.len() as u64 > self.cap {
            return Err(std::io::Error::other(
                "XZの展開後サイズが上限を超えています",
            ));
        }
        self.bytes.extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn extract_tar_xz_archive(archive_path: &Path, dest_root: &Path) -> Result<(), String> {
    let compressed = read_limited(archive_path, MAX_ARCHIVE_BYTES, "アーカイブ")?;
    // tarのヘッダー/パディング分（512Bx600エントリー超の余裕）を上限に上乗せする
    let mut writer = CappedWriter {
        bytes: Vec::new(),
        cap: MAX_ARCHIVE_UNPACKED_BYTES + 4 * 1024 * 1024,
    };
    lzma_rs::xz_decompress(&mut std::io::Cursor::new(&compressed), &mut writer)
        .map_err(|error| format!("XZを展開できません: {error:?}"))?;
    let mut archive = tar::Archive::new(std::io::Cursor::new(writer.bytes));
    let mut budget = ArchiveBudget::new();
    for entry in archive
        .entries()
        .map_err(|error| format!("tarを読めません: {error}"))?
    {
        let mut entry = entry.map_err(|error| format!("tar内のファイルを読めません: {error}"))?;
        match entry.header().entry_type() {
            tar::EntryType::Regular => {}
            tar::EntryType::Symlink | tar::EntryType::Link => {
                return Err("tar内のリンクは使用できません".into())
            }
            _ => continue,
        }
        let name = entry
            .path()
            .map_err(|error| format!("tar内のパスを読めません: {error}"))?
            .to_str()
            .ok_or("tar内のパスがUTF-8ではありません")?
            .replace('\\', "/");
        if should_skip_archive_entry(&name) {
            continue;
        }
        write_archive_entry(dest_root, &name, &mut entry, &mut budget)?;
    }
    Ok(())
}

fn locate_extracted_mod_dir(extract_root: &Path) -> Result<PathBuf, String> {
    if extract_root.join(MANIFEST_NAME).is_file() {
        return Ok(extract_root.to_path_buf());
    }
    let mut directories = Vec::new();
    let entries = fs::read_dir(extract_root)
        .map_err(|error| format!("展開結果を読めません: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("展開結果の項目を読めません: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("展開結果の項目を確認できません: {error}"))?;
        if file_type.is_dir() {
            directories.push(entry.path());
        }
    }
    if directories.len() == 1 && directories[0].join(MANIFEST_NAME).is_file() {
        return Ok(directories.remove(0));
    }
    Err(format!(
        "アーカイブの直下（または単一フォルダー内）に{MANIFEST_NAME}が必要です"
    ))
}

fn install_archive(root: &Path, archive_path: &Path) -> Result<(String, String, bool), String> {
    let metadata = fs::metadata(archive_path)
        .map_err(|error| format!("アーカイブを確認できません: {error}"))?;
    if !metadata.is_file() {
        return Err("アーカイブがファイルではありません".into());
    }
    if metadata.len() > MAX_ARCHIVE_BYTES {
        return Err("アーカイブは64 MiB以下にしてください".into());
    }
    let file_name = archive_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let extract_root = root.join(format!("{ARCHIVE_TMP_PREFIX}{nanos}"));
    fs::create_dir_all(&extract_root)
        .map_err(|error| format!("一時フォルダーを作成できません: {error}"))?;
    let result = (|| -> Result<(String, String, bool), String> {
        if file_name.ends_with(".zip") {
            extract_zip_archive(archive_path, &extract_root)?;
        } else if file_name.ends_with(".xz") || file_name.ends_with(".txz") {
            extract_tar_xz_archive(archive_path, &extract_root)?;
        } else {
            return Err("対応形式は .zip / .tar.xz（XZ / LZMA2）です".into());
        }
        let mod_dir = locate_extracted_mod_dir(&extract_root)?;
        let package = load_package(&mod_dir)?;
        let manifest = &package.descriptor.manifest;
        let folder_name = manifest.id.trim_end_matches(['.', ' ']).to_string();
        if folder_name.is_empty() {
            return Err("MOD idからフォルダー名を作れません".into());
        }
        let target = root.join(&folder_name);
        let replaced = target.exists();
        if replaced {
            fs::remove_dir_all(&target)
                .map_err(|error| format!("既存の同名MODを置き換えられません: {error}"))?;
        }
        fs::rename(&mod_dir, &target)
            .map_err(|error| format!("MODを配置できません: {error}"))?;
        Ok((manifest.id.clone(), manifest.name.clone(), replaced))
    })();
    let _ = fs::remove_dir_all(&extract_root);
    result
}

fn folder_label(path: &Path) -> String {
    path.file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "unknown".into())
}

fn scan_packages(root: &Path) -> Result<(Vec<LoadedPackage>, Vec<CharacterModIssue>), String> {
    let directories = mod_directories(root)?;
    let mut loaded = Vec::new();
    let mut issues = Vec::new();
    for directory in directories {
        match load_package(&directory) {
            Ok(package) => loaded.push(package),
            Err(message) => issues.push(CharacterModIssue {
                folder: folder_label(&directory),
                message,
            }),
        }
    }

    let mut counts: HashMap<String, usize> = HashMap::new();
    for package in &loaded {
        *counts
            .entry(package.descriptor.manifest.id.clone())
            .or_default() += 1;
    }
    let duplicate_ids: HashSet<String> = counts
        .into_iter()
        .filter_map(|(id, count)| (count > 1).then_some(id))
        .collect();
    if !duplicate_ids.is_empty() {
        loaded.retain(|package| {
            let id = &package.descriptor.manifest.id;
            if duplicate_ids.contains(id) {
                issues.push(CharacterModIssue {
                    folder: id.clone(),
                    message: "同じidのMODが複数あります。idを一意にしてください".into(),
                });
                false
            } else {
                true
            }
        });
    }
    loaded.sort_by(|left, right| {
        left.descriptor
            .manifest
            .name
            .cmp(&right.descriptor.manifest.name)
    });
    Ok((loaded, issues))
}

/// 同梱MODとユーザーMODをまとめてスキャンする。
/// 同じidが両方にある場合はユーザーMODを優先する（上書き導入を許す）。
fn scan_all_packages(
    builtin_root: Option<&Path>,
    user_root: &Path,
) -> Result<(Vec<LoadedPackage>, Vec<CharacterModIssue>), String> {
    let (user_loaded, mut issues) = scan_packages(user_root)?;
    let mut loaded = user_loaded;
    if let Some(builtin_root) = builtin_root {
        match scan_packages(builtin_root) {
            Ok((builtin_loaded, builtin_issues)) => {
                for issue in builtin_issues {
                    issues.push(CharacterModIssue {
                        folder: format!("{}（同梱）", issue.folder),
                        message: issue.message,
                    });
                }
                let user_ids: HashSet<String> = loaded
                    .iter()
                    .map(|package| package.descriptor.manifest.id.clone())
                    .collect();
                for mut package in builtin_loaded {
                    if user_ids.contains(&package.descriptor.manifest.id) {
                        continue;
                    }
                    package.descriptor.origin = CharacterModOrigin::Builtin;
                    loaded.push(package);
                }
            }
            Err(message) => issues.push(CharacterModIssue {
                folder: "（同梱）".into(),
                message,
            }),
        }
    }
    loaded.sort_by(|left, right| {
        left.descriptor
            .manifest
            .name
            .cmp(&right.descriptor.manifest.name)
    });
    Ok((loaded, issues))
}

fn read_registered_asset(asset: &RegisteredAsset) -> Result<Vec<u8>, String> {
    let bytes = read_limited(&asset.path, asset.byte_len, "MOD asset")?;
    if bytes.len() as u64 != asset.byte_len
        || <[u8; 32]>::from(Sha256::digest(&bytes)) != asset.digest
    {
        return Err("MOD assetが検証後に変更されました。設定から再読み込みしてください".into());
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn character_mod_list(
    app: AppHandle,
    registry: State<'_, CharacterModRegistry>,
) -> Result<CharacterModScanResult, String> {
    let root = mods_root(&app)?;
    ensure_mod_root(&root)?;
    let builtin_root = builtin_mods_root(&app);
    let (loaded, issues) =
        tauri::async_runtime::spawn_blocking(move || scan_all_packages(builtin_root.as_deref(), &root))
            .await
            .map_err(|error| format!("MOD検出処理に失敗しました: {error}"))??;
    registry.replace(&loaded)?;
    Ok(CharacterModScanResult {
        packages: loaded
            .into_iter()
            .map(|package| package.descriptor)
            .collect(),
        issues,
    })
}

#[tauri::command]
pub async fn character_mod_read_asset(
    registry: State<'_, CharacterModRegistry>,
    mod_id: String,
    revision: String,
    asset_key: String,
) -> Result<Response, String> {
    validate_identifier(&mod_id)?;
    if revision.len() != 64 || !revision.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("revisionが不正です".into());
    }
    if asset_key.len() > 100 || asset_key.chars().any(char::is_control) {
        return Err("asset keyが不正です".into());
    }
    let asset = registry.resolve(&mod_id, &revision, &asset_key)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || read_registered_asset(&asset))
        .await
        .map_err(|error| format!("MOD asset処理に失敗しました: {error}"))??;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn character_mod_open_folder(app: AppHandle) -> Result<(), String> {
    let root = mods_root(&app)?;
    ensure_mod_root(&root)?;
    app.opener()
        .open_path(root.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|error| format!("MODフォルダーを開けません: {error}"))
}

#[tauri::command]
pub async fn character_mod_install_archive(
    app: AppHandle,
    registry: State<'_, CharacterModRegistry>,
) -> Result<Option<CharacterModInstallResult>, String> {
    let root = mods_root(&app)?;
    ensure_mod_root(&root)?;
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter("キャラクターMODアーカイブ", &["zip", "xz", "txz"])
        .set_title("キャラクターMODのアーカイブを選択")
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let archive_path = picked
        .into_path()
        .map_err(|error| format!("選択したファイルのパスを取得できません: {error}"))?;
    let install_root = root.clone();
    let (installed_id, installed_name, replaced) =
        tauri::async_runtime::spawn_blocking(move || install_archive(&install_root, &archive_path))
            .await
            .map_err(|error| format!("MODの追加処理に失敗しました: {error}"))??;
    let builtin_root = builtin_mods_root(&app);
    let (loaded, issues) =
        tauri::async_runtime::spawn_blocking(move || scan_all_packages(builtin_root.as_deref(), &root))
            .await
            .map_err(|error| format!("MOD検出処理に失敗しました: {error}"))??;
    registry.replace(&loaded)?;
    Ok(Some(CharacterModInstallResult {
        installed_id,
        installed_name,
        replaced,
        scan: CharacterModScanResult {
            packages: loaded
                .into_iter()
                .map(|package| package.descriptor)
                .collect(),
            issues,
        },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal_animated_glb() -> Vec<u8> {
        let root = serde_json::json!({
            "asset": { "version": "2.0" },
            "scene": 0,
            "scenes": [{ "nodes": [0] }],
            "nodes": [{ "mesh": 0 }],
            "meshes": [{ "primitives": [{ "attributes": { "POSITION": 0 }, "mode": 4 }] }],
            "buffers": [{ "byteLength": 36 }],
            "bufferViews": [{ "buffer": 0, "byteOffset": 0, "byteLength": 36 }],
            "accessors": [
                { "bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3" },
                { "componentType": 5126, "count": 2, "type": "SCALAR" },
                { "componentType": 5126, "count": 2, "type": "VEC3" }
            ],
            "animations": [{
                "name": "Idle",
                "samplers": [{ "input": 1, "output": 2, "interpolation": "LINEAR" }],
                "channels": [{ "sampler": 0, "target": { "node": 0, "path": "translation" } }]
            }]
        });
        let mut json = serde_json::to_vec(&root).unwrap();
        while json.len() % 4 != 0 {
            json.push(b' ');
        }
        let bin = vec![0u8; 36];
        let total_length = 12 + 8 + json.len() + 8 + bin.len();
        let mut glb = Vec::with_capacity(total_length);
        glb.extend_from_slice(b"glTF");
        glb.extend_from_slice(&2u32.to_le_bytes());
        glb.extend_from_slice(&(total_length as u32).to_le_bytes());
        glb.extend_from_slice(&(json.len() as u32).to_le_bytes());
        glb.extend_from_slice(&0x4E4F534Au32.to_le_bytes());
        glb.extend_from_slice(&json);
        glb.extend_from_slice(&(bin.len() as u32).to_le_bytes());
        glb.extend_from_slice(&0x004E4942u32.to_le_bytes());
        glb.extend_from_slice(&bin);
        glb
    }

    #[test]
    fn skips_archive_junk_entries() {
        assert!(should_skip_archive_entry("__MACOSX/pack/._character.json"));
        assert!(should_skip_archive_entry("pack/.DS_Store"));
        assert!(should_skip_archive_entry("Thumbs.db"));
        assert!(!should_skip_archive_entry("pack/character.json"));
    }

    #[test]
    fn zip_extraction_writes_files_and_rejects_traversal() {
        use zip::write::SimpleFileOptions;
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        let mut buffer = std::io::Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut buffer);
            writer.start_file("pack/character.json", options).unwrap();
            writer.write_all(b"{}").unwrap();
            writer
                .start_file("__MACOSX/pack/._character.json", options)
                .unwrap();
            writer.write_all(b"junk").unwrap();
            writer.finish().unwrap();
        }
        let dest = std::env::temp_dir().join(format!("miomail-zip-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dest);
        fs::create_dir_all(&dest).unwrap();
        let archive_path = dest.join("pack.zip");
        fs::write(&archive_path, buffer.into_inner()).unwrap();
        extract_zip_archive(&archive_path, &dest.join("out")).unwrap();
        assert!(dest.join("out/pack/character.json").is_file());
        assert!(!dest.join("out/__MACOSX").exists());

        let mut evil = std::io::Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut evil);
            writer.start_file("../evil.txt", options).unwrap();
            writer.write_all(b"x").unwrap();
            writer.finish().unwrap();
        }
        let evil_path = dest.join("evil.zip");
        fs::write(&evil_path, evil.into_inner()).unwrap();
        assert!(extract_zip_archive(&evil_path, &dest.join("out2")).is_err());
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn extracts_tar_xz_archives() {
        let mut tar_bytes = Vec::new();
        {
            let mut builder = tar::Builder::new(&mut tar_bytes);
            let data = b"{}";
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder
                .append_data(&mut header, "pack/character.json", &data[..])
                .unwrap();
            builder.finish().unwrap();
        }
        let mut xz_bytes = Vec::new();
        lzma_rs::xz_compress(&mut std::io::Cursor::new(&tar_bytes), &mut xz_bytes).unwrap();
        let dest = std::env::temp_dir().join(format!("miomail-txz-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dest);
        fs::create_dir_all(&dest).unwrap();
        let archive_path = dest.join("pack.tar.xz");
        fs::write(&archive_path, xz_bytes).unwrap();
        extract_tar_xz_archive(&archive_path, &dest.join("out")).unwrap();
        assert!(dest.join("out/pack/character.json").is_file());
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn rejects_path_traversal_and_windows_paths() {
        for invalid in [
            "../secret.png",
            "C:/secret.png",
            "//server/share.png",
            "assets\\x.png",
            "asset:stream.png",
        ] {
            assert!(validate_relative_path(invalid).is_err(), "{invalid}");
        }
        assert!(validate_relative_path("assets/idle/0001.webp").is_ok());
    }

    #[test]
    fn validates_mod_identifiers() {
        assert!(validate_identifier("creator.fluffy-bear").is_ok());
        assert!(validate_identifier("Creator Bear").is_err());
        assert!(validate_identifier("../bear").is_err());
    }

    #[test]
    fn reads_png_dimensions_without_decoding_pixels() {
        let mut png = vec![0u8; 24];
        png[0..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        png[16..20].copy_from_slice(&512u32.to_be_bytes());
        png[20..24].copy_from_slice(&256u32.to_be_bytes());
        assert_eq!(image_dimensions(&png).unwrap(), (512, 256));
    }

    #[test]
    fn normalizes_sprite_rows_from_the_validated_image() {
        let mut manifest: CharacterModManifest = serde_json::from_str(SPRITE_EXAMPLE).unwrap();
        if let CharacterSource::Sheet { rows, .. } = &mut manifest.source {
            *rows = None;
        }
        let mut png = vec![0u8; 24];
        png[0..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        png[16..20].copy_from_slice(&1024u32.to_be_bytes());
        png[20..24].copy_from_slice(&768u32.to_be_bytes());
        normalize_sheet_layout(&mut manifest, Some(&png)).unwrap();
        let CharacterSource::Sheet { rows, .. } = manifest.source else {
            panic!("sprite example must stay a sheet");
        };
        assert_eq!(rows, Some(3));
    }

    #[test]
    fn bundled_examples_match_the_runtime_manifest() {
        for example in [SPRITE_EXAMPLE, SEQUENCE_EXAMPLE, GLB_EXAMPLE, DOM_SVG_EXAMPLE] {
            let manifest: CharacterModManifest = serde_json::from_str(example).unwrap();
            validate_manifest(&manifest).unwrap();
        }
    }

    #[test]
    fn rejects_truncated_glb() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"glTF");
        bytes.extend_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&20u32.to_le_bytes());
        bytes.extend_from_slice(&8u32.to_le_bytes());
        bytes.extend_from_slice(&0x4E4F534Au32.to_le_bytes());
        assert!(validate_glb(&bytes).is_err());
    }

    #[test]
    fn accepts_a_bounded_animated_glb() {
        let names = validate_glb(&minimal_animated_glb()).unwrap();
        assert!(names.contains("Idle"));
    }

    #[test]
    fn rejects_apng_and_animated_webp_containers() {
        let mut apng = b"\x89PNG\r\n\x1a\n".to_vec();
        apng.extend_from_slice(&0u32.to_be_bytes());
        apng.extend_from_slice(b"acTL");
        apng.extend_from_slice(&0u32.to_be_bytes());
        assert!(reject_animated_image(&apng, "test").is_err());

        let mut webp = b"RIFF".to_vec();
        webp.extend_from_slice(&12u32.to_le_bytes());
        webp.extend_from_slice(b"WEBP");
        webp.extend_from_slice(b"ANIM");
        webp.extend_from_slice(&0u32.to_le_bytes());
        assert!(reject_animated_image(&webp, "test").is_err());
    }

    #[test]
    fn rejects_shared_and_cyclic_scene_nodes() {
        let shared = serde_json::json!({
            "nodes": [{ "children": [1] }, {}],
            "scenes": [{ "nodes": [0, 1] }]
        });
        assert!(validate_scene_forest(&shared).is_err());

        let cyclic = serde_json::json!({
            "nodes": [{ "children": [1] }, { "children": [0] }],
            "scenes": [{ "nodes": [] }]
        });
        assert!(validate_scene_forest(&cyclic).is_err());

        let valid = serde_json::json!({
            "nodes": [{ "children": [1] }, {}],
            "scenes": [{ "nodes": [0] }]
        });
        let (_, reachable) = validate_scene_forest(&valid).unwrap();
        assert_eq!(reachable.len(), 2);
    }

    fn minimal_valid_scene() -> Value {
        serde_json::json!({
            "sceneVersion": 1,
            "viewBox": [340, 340],
            "animations": {
                "breath": {
                    "durationMs": 2000,
                    "easing": "ease-in-out",
                    "iteration": "infinite",
                    "keyframes": [
                        { "at": 0, "transform": { "scale": 1.0 } },
                        { "at": 50, "transform": { "scale": 1.03 } },
                        { "at": 100, "transform": { "scale": 1.0 } }
                    ]
                }
            },
            "root": [
                {
                    "kind": "box",
                    "id": "torso",
                    "left": 10, "top": 10, "width": 80, "height": 80,
                    "z": 10,
                    "animation": "breath",
                    "background": { "type": "solid", "color": "#ffcc00" },
                    "borderRadius": "50%"
                },
                {
                    "kind": "svg",
                    "id": "head",
                    "left": 0, "top": 0, "width": 100, "height": 100,
                    "viewBox": [340, 340],
                    "children": [
                        {
                            "kind": "path",
                            "id": "face",
                            "d": "M0 0 L10 10 Z",
                            "fill": { "type": "solid", "color": "#ffffff" }
                        }
                    ]
                }
            ]
        })
    }

    fn minimal_dom_svg_manifest(motions: HashMap<String, DomSvgMotion>) -> CharacterModManifest {
        CharacterModManifest {
            schema_version: 1,
            id: "firemio.mio-svg".into(),
            name: "ミオ（SVG）".into(),
            version: "1.0.0".into(),
            author: "firemio".into(),
            description: String::new(),
            license: None,
            behavior_profile: "mio".into(),
            renderer: CharacterModRenderer::DomSvg,
            thumbnail: None,
            source: CharacterSource::Scene {
                file: "scene.json".into(),
                motions,
            },
        }
    }

    fn idle_motion(animations: Vec<&str>) -> HashMap<String, DomSvgMotion> {
        let mut motions = HashMap::new();
        motions.insert(
            "idle".to_string(),
            DomSvgMotion {
                pose: None,
                pose_animation: None,
                pose_origin: None,
                animations: animations.into_iter().map(String::from).collect(),
                expression: None,
                r#loop: true,
            },
        );
        motions
    }

    #[test]
    fn accepts_a_minimal_dom_svg_scene() {
        let bytes = serde_json::to_vec(&minimal_valid_scene()).unwrap();
        let names = validate_scene(&bytes).unwrap();
        assert!(names.contains("breath"));
    }

    #[test]
    fn rejects_hostile_path_data() {
        let mut value = minimal_valid_scene();
        value["root"][1]["children"][0]["d"] = serde_json::json!("M0 0 url(javascript:alert(1))");
        let bytes = serde_json::to_vec(&value).unwrap();
        assert!(validate_scene(&bytes).is_err());
    }

    #[test]
    fn rejects_url_in_color() {
        let mut value = minimal_valid_scene();
        value["root"][0]["background"] = serde_json::json!({ "type": "solid", "color": "url(#evil)" });
        let bytes = serde_json::to_vec(&value).unwrap();
        assert!(validate_scene(&bytes).is_err());
    }

    #[test]
    fn rejects_too_many_nodes() {
        let mut root = Vec::new();
        for _ in 0..(MAX_SCENE_NODES + 1) {
            root.push(serde_json::json!({ "kind": "box", "left": 0, "top": 0, "width": 1, "height": 1 }));
        }
        let scene = serde_json::json!({ "sceneVersion": 1, "viewBox": [100, 100], "root": root });
        let bytes = serde_json::to_vec(&scene).unwrap();
        assert!(validate_scene(&bytes).is_err());
    }

    #[test]
    fn rejects_excessive_nesting() {
        let mut node = serde_json::json!({ "kind": "box", "left": 0, "top": 0, "width": 1, "height": 1 });
        for _ in 0..(MAX_SCENE_DEPTH + 2) {
            node = serde_json::json!({ "kind": "group", "children": [node] });
        }
        let scene = serde_json::json!({ "sceneVersion": 1, "viewBox": [100, 100], "root": [node] });
        let bytes = serde_json::to_vec(&scene).unwrap();
        assert!(validate_scene(&bytes).is_err());
    }

    #[test]
    fn rejects_unknown_node_kind() {
        let scene = serde_json::json!({
            "sceneVersion": 1,
            "viewBox": [100, 100],
            "root": [{ "kind": "image", "src": "https://evil.example/x.png" }]
        });
        let bytes = serde_json::to_vec(&scene).unwrap();
        assert!(validate_scene(&bytes).is_err());
    }

    #[test]
    fn rejects_unknown_keys() {
        let mut value = minimal_valid_scene();
        value["root"][0]["onClick"] = serde_json::json!("alert(1)");
        let bytes = serde_json::to_vec(&value).unwrap();
        assert!(validate_scene(&bytes).is_err());
    }

    #[test]
    fn rejects_undefined_animation_reference() {
        let mut value = minimal_valid_scene();
        value["root"][0]["animation"] = serde_json::json!("does-not-exist");
        let bytes = serde_json::to_vec(&value).unwrap();
        assert!(validate_scene(&bytes).is_err());
    }

    #[test]
    fn dom_svg_scene_requires_json_extension() {
        assert!(validate_asset_extension(Path::new("scene.json"), AssetRole::Scene).is_ok());
        assert!(validate_asset_extension(Path::new("scene.svg"), AssetRole::Scene).is_err());
    }

    #[test]
    fn validates_colors() {
        assert!(validate_color("#fff").is_ok());
        assert!(validate_color("#ffccdd").is_ok());
        assert!(validate_color("rgba(255, 0, 0, 0.5)").is_ok());
        assert!(validate_color("url(#evil)").is_err());
        assert!(validate_color("currentColor").is_err());
        assert!(validate_color("javascript:alert(1)").is_err());
    }

    #[test]
    fn validates_path_data_charset() {
        assert!(validate_path_data("M0 0 L10 10 Z").is_ok());
        assert!(validate_path_data("M0 0 url(evil)").is_err());
        assert!(validate_path_data("L0 0").is_err());
    }

    #[test]
    fn validates_border_radius_and_clip_path() {
        assert!(validate_border_radius("50%").is_ok());
        assert!(validate_border_radius("47% 47% 42% 42% / 36% 36% 62% 62%").is_ok());
        // CSSと同じくゼロだけは単位なしで書ける
        assert!(validate_border_radius("0 0 60% 60%").is_ok());
        assert!(validate_border_radius("50px").is_err());
        assert!(validate_border_radius("calc(50%)").is_err());
        assert!(validate_clip_path("polygon(0% 0%, 100% 0%, 50% 100%)").is_ok());
        assert!(validate_clip_path("polygon(0 0, 100% 0, 79% 45%)").is_ok());
        assert!(validate_clip_path("polygon(0px 0px)").is_err());
        assert!(validate_clip_path("inset(0 0 0 0)").is_err());
    }

    #[test]
    fn validates_extended_paint_and_shadow_vocabulary() {
        // transparentはグラデーションのフェードアウトに必須
        assert!(validate_color("transparent").is_ok());
        assert!(validate_color("rgba(255,253,250,.92)").is_ok());

        let layered = serde_json::json!([
            { "type": "radial", "shape": "ellipse", "cx": 50, "cy": -5,
              "stops": [{ "color": "#aeabad", "at": 0 }, { "color": "transparent", "at": 48 }] },
            { "type": "linear", "angle": 180,
              "stops": [{ "color": "#fffdfa", "at": 0 }, { "color": "#e7ded9", "at": 100 }] }
        ]);
        assert!(validate_background(&layered).is_ok());
        assert!(validate_background(&serde_json::json!({ "type": "solid", "color": "#fff" })).is_ok());

        let too_many: Vec<Value> = (0..(MAX_BACKGROUND_LAYERS + 1))
            .map(|_| serde_json::json!({ "type": "solid", "color": "#fff" }))
            .collect();
        assert!(validate_background(&Value::Array(too_many)).is_err());

        let outline = serde_json::json!([
            { "dx": 1, "dy": 0, "blur": 0, "color": "rgba(98,91,94,.34)" },
            { "dx": -1, "dy": 0, "blur": 0, "color": "rgba(98,91,94,.34)" }
        ]);
        assert!(validate_shadow_list(&outline, "filter", false).is_ok());
        // insetはbox-shadow専用。filterでは未知キーとして弾く
        let inset = serde_json::json!([{ "dx": 0, "dy": -5, "blur": 8, "color": "#fff", "inset": true }]);
        assert!(validate_shadow_list(&inset, "boxShadow", true).is_ok());
        assert!(validate_shadow_list(&inset, "filter", false).is_err());

        assert!(validate_border(&serde_json::json!({ "width": 2, "color": "#5b5355" }), "border").is_ok());
        assert!(validate_border(&serde_json::json!({ "width": 2 }), "border").is_err());
    }

    #[test]
    fn rejects_hostile_values_in_extended_vocabulary() {
        let mut value = minimal_valid_scene();
        value["root"][0]["filter"] =
            serde_json::json!([{ "dx": 0, "dy": 0, "color": "url(javascript:alert(1))" }]);
        assert!(validate_scene(&serde_json::to_vec(&value).unwrap()).is_err());

        let mut value = minimal_valid_scene();
        value["root"][0]["border"] = serde_json::json!({ "width": 2, "color": "expression(alert(1))" });
        assert!(validate_scene(&serde_json::to_vec(&value).unwrap()).is_err());

        // 背景レイヤー配列の中に混ざった不正paintも拒否する
        let mut value = minimal_valid_scene();
        value["root"][0]["background"] = serde_json::json!([
            { "type": "solid", "color": "#fff" },
            { "type": "solid", "color": "var(--leak)" }
        ]);
        assert!(validate_scene(&serde_json::to_vec(&value).unwrap()).is_err());

        // box childrenもノード数上限を共有する
        let mut value = minimal_valid_scene();
        value["root"][0]["children"] = serde_json::json!([{ "kind": "script", "src": "evil.js" }]);
        assert!(validate_scene(&serde_json::to_vec(&value).unwrap()).is_err());
    }

    #[test]
    fn accepts_nested_boxes_and_stroke_options() {
        let mut value = minimal_valid_scene();
        value["root"][0]["overflowHidden"] = serde_json::json!(true);
        value["root"][0]["children"] = serde_json::json!([
            { "kind": "box", "left": 10, "top": 10, "width": 30, "height": 30,
              "background": { "type": "solid", "color": "rgba(255,255,255,.66)" },
              "borderBottom": { "width": 1, "color": "rgba(175,137,139,.26)" } }
        ]);
        value["root"][1]["children"][0]["strokeLinecap"] = serde_json::json!("round");
        value["root"][1]["children"][0]["strokeLinejoin"] = serde_json::json!("round");
        value["root"][1]["children"][0]["nonScalingStroke"] = serde_json::json!(true);
        value["root"][1]["children"][0]["stroke"] =
            serde_json::json!({ "type": "solid", "color": "rgba(98,91,94,.5)" });
        assert!(validate_scene(&serde_json::to_vec(&value).unwrap()).is_ok());

        let mut bad = value.clone();
        bad["root"][1]["children"][0]["strokeLinecap"] = serde_json::json!("javascript:");
        assert!(validate_scene(&serde_json::to_vec(&bad).unwrap()).is_err());
    }

    #[test]
    fn validates_a_dom_svg_manifest() {
        let manifest = minimal_dom_svg_manifest(idle_motion(vec!["breath"]));
        assert!(validate_manifest(&manifest).is_ok());
    }

    #[test]
    fn rejects_dom_svg_manifest_without_idle_motion() {
        let manifest = minimal_dom_svg_manifest(HashMap::new());
        assert!(validate_manifest(&manifest).is_err());
    }

    #[test]
    fn rejects_mismatched_renderer_and_source() {
        let mut manifest = minimal_dom_svg_manifest(idle_motion(vec!["breath"]));
        manifest.source = CharacterSource::Model {
            file: "model.glb".into(),
            scale: None,
            ground_offset: None,
            rotation_y: None,
            motions: HashMap::new(),
        };
        assert!(validate_manifest(&manifest).is_err());
    }

    #[test]
    fn rejects_manifest_motion_referencing_missing_scene_animation() {
        let manifest = minimal_dom_svg_manifest(idle_motion(vec!["does-not-exist"]));
        let names: HashSet<String> = ["breath".to_string()].into_iter().collect();
        assert!(validate_scene_motion_refs(&manifest, Some(&names)).is_err());
    }

    const DOM_SVG_SAMPLE_CHARACTER: &str = r#"{
        "schemaVersion": 1,
        "id": "firemio.dom-svg-sample",
        "name": "DOM/SVGサンプル",
        "version": "1.0.0",
        "author": "firemio",
        "description": "dom-svgレンダラーの仕組み検証用の簡易キャラクター",
        "behaviorProfile": "mio",
        "renderer": "dom-svg",
        "source": {
            "type": "scene",
            "file": "scene.json",
            "motions": {
                "idle": { "animations": ["breath", "ear-left", "ear-right"], "loop": true },
                "rest": {
                    "pose": { "rotate": 3, "translateY": 3 },
                    "expression": "sleepy",
                    "animations": ["doze"],
                    "loop": true
                },
                "celebrate": { "pose": { "scale": 1.05 }, "animations": ["hop"], "loop": true }
            }
        }
    }"#;

    const DOM_SVG_SAMPLE_SCENE: &str = r##"{
        "sceneVersion": 1,
        "viewBox": [200, 200],
        "animations": {
            "breath": {
                "durationMs": 2200, "easing": "ease-in-out", "iteration": "infinite",
                "keyframes": [
                    { "at": 0, "transform": { "scale": 1 } },
                    { "at": 50, "transform": { "scale": 1.03 } },
                    { "at": 100, "transform": { "scale": 1 } }
                ]
            },
            "ear-left": {
                "durationMs": 2600, "easing": "ease-in-out", "iteration": "infinite",
                "keyframes": [
                    { "at": 0, "transform": { "rotate": -8 } },
                    { "at": 50, "transform": { "rotate": -14 } },
                    { "at": 100, "transform": { "rotate": -8 } }
                ]
            },
            "ear-right": {
                "durationMs": 2600, "easing": "ease-in-out", "iteration": "infinite", "delayMs": 300,
                "keyframes": [
                    { "at": 0, "transform": { "rotate": 8 } },
                    { "at": 50, "transform": { "rotate": 14 } },
                    { "at": 100, "transform": { "rotate": 8 } }
                ]
            },
            "doze": {
                "durationMs": 3200, "easing": "ease-in-out", "iteration": "infinite",
                "keyframes": [
                    { "at": 0, "transform": { "scale": 1 }, "opacity": 1 },
                    { "at": 50, "transform": { "scale": 0.98 }, "opacity": 0.92 },
                    { "at": 100, "transform": { "scale": 1 }, "opacity": 1 }
                ]
            },
            "hop": {
                "durationMs": 600, "easing": "ease-out", "iteration": 3,
                "keyframes": [
                    { "at": 0, "transform": { "translateY": 0 } },
                    { "at": 50, "transform": { "translateY": -10 } },
                    { "at": 100, "transform": { "translateY": 0 } }
                ]
            }
        },
        "root": [
            {
                "kind": "box", "id": "body",
                "left": 20, "top": 38, "width": 60, "height": 56, "z": 0,
                "animation": "breath", "transformOrigin": [50, 90],
                "background": {
                    "type": "radial", "shape": "ellipse", "cx": 50, "cy": 35,
                    "stops": [{ "color": "#fff1da", "at": 0 }, { "color": "#ffcf8e", "at": 100 }]
                },
                "borderRadius": "50%"
            },
            {
                "kind": "svg", "id": "head",
                "left": 14, "top": 2, "width": 72, "height": 58, "z": 20,
                "viewBox": [200, 160],
                "children": [
                    {
                        "kind": "path", "id": "face",
                        "d": "M100 8 C150 8 182 44 182 90 C182 132 144 156 100 156 C56 156 18 132 18 90 C18 44 50 8 100 8 Z",
                        "fill": { "type": "solid", "color": "#fff4e2" },
                        "stroke": { "type": "solid", "color": "#e3a15a" },
                        "strokeWidth": 3
                    },
                    {
                        "kind": "ellipse", "id": "eye-left-normal",
                        "cx": 72, "cy": 82, "rx": 9, "ry": 12,
                        "fill": { "type": "solid", "color": "#5b4636" },
                        "visibleIn": ["normal", "happy"]
                    },
                    {
                        "kind": "ellipse", "id": "eye-right-normal",
                        "cx": 128, "cy": 82, "rx": 9, "ry": 12,
                        "fill": { "type": "solid", "color": "#5b4636" },
                        "visibleIn": ["normal", "happy"]
                    },
                    {
                        "kind": "path", "id": "eye-left-sleepy",
                        "d": "M62 84 Q72 92 82 84",
                        "stroke": { "type": "solid", "color": "#5b4636" },
                        "strokeWidth": 4,
                        "visibleIn": ["sleepy"]
                    },
                    {
                        "kind": "path", "id": "eye-right-sleepy",
                        "d": "M118 84 Q128 92 138 84",
                        "stroke": { "type": "solid", "color": "#5b4636" },
                        "strokeWidth": 4,
                        "visibleIn": ["sleepy"]
                    },
                    {
                        "kind": "path", "id": "mouth",
                        "d": "M85 118 Q100 128 115 118",
                        "stroke": { "type": "solid", "color": "#c9784a" },
                        "strokeWidth": 4
                    },
                    {
                        "kind": "ellipse", "id": "cheek-left",
                        "cx": 52, "cy": 104, "rx": 10, "ry": 7,
                        "fill": { "type": "solid", "color": "#ffb7a6" },
                        "opacity": 0.55
                    },
                    {
                        "kind": "ellipse", "id": "cheek-right",
                        "cx": 148, "cy": 104, "rx": 10, "ry": 7,
                        "fill": { "type": "solid", "color": "#ffb7a6" },
                        "opacity": 0.55
                    }
                ]
            },
            {
                "kind": "svg", "id": "ear-left",
                "left": 6, "top": -4, "width": 26, "height": 26, "z": 10,
                "rotate": -8, "animation": "ear-left", "transformOrigin": [70, 90],
                "viewBox": [100, 100],
                "children": [
                    {
                        "kind": "ellipse", "cx": 50, "cy": 55, "rx": 38, "ry": 42,
                        "fill": { "type": "solid", "color": "#ffcf8e" },
                        "stroke": { "type": "solid", "color": "#e3a15a" },
                        "strokeWidth": 3
                    }
                ]
            },
            {
                "kind": "svg", "id": "ear-right",
                "right": 6, "top": -4, "width": 26, "height": 26, "z": 10,
                "rotate": 8, "animation": "ear-right", "transformOrigin": [30, 90],
                "viewBox": [100, 100],
                "children": [
                    {
                        "kind": "ellipse", "cx": 50, "cy": 55, "rx": 38, "ry": 42,
                        "fill": { "type": "solid", "color": "#ffcf8e" },
                        "stroke": { "type": "solid", "color": "#e3a15a" },
                        "strokeWidth": 3
                    }
                ]
            }
        ]
    }"##;

    // リポジトリ同梱のミオMODは、実際にインストールされるのと同じ経路で検証する
    const MIO_SVG_CHARACTER: &str = include_str!("../../../mods/mio-svg/character.json");
    const MIO_SVG_SCENE: &str = include_str!("../../../mods/mio-svg/scene.json");

    #[test]
    fn bundled_mio_svg_mod_loads_through_the_install_pipeline() {
        let dest = std::env::temp_dir().join(format!("miomail-mio-svg-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dest);
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join(MANIFEST_NAME), MIO_SVG_CHARACTER).unwrap();
        fs::write(dest.join("scene.json"), MIO_SVG_SCENE).unwrap();

        let loaded = match load_package(&dest) {
            Ok(loaded) => loaded,
            Err(error) => {
                let _ = fs::remove_dir_all(&dest);
                panic!("ミオMODが検証を通りませんでした: {error}");
            }
        };
        assert_eq!(loaded.descriptor.manifest.id, "firemio.mio-svg");
        assert_eq!(
            loaded.descriptor.manifest.renderer,
            CharacterModRenderer::DomSvg
        );
        // 全10モーションが定義され、参照するanimationがscene側に存在すること
        let CharacterSource::Scene { motions, .. } = &loaded.descriptor.manifest.source else {
            panic!("mio-svg must stay a dom-svg scene");
        };
        assert_eq!(motions.len(), ALLOWED_MOTIONS.len());
        assert!(motions["rest"].expression.as_deref() == Some("sleepy"));

        let _ = fs::remove_dir_all(&dest);
    }

    /// 実際にインストール済みのMODフォルダーを丸ごとスキャンする。
    /// 環境依存なので既定では走らせない: `cargo test -- --ignored scans_the_installed`
    #[test]
    #[ignore]
    fn scans_the_installed_character_mod_folder() {
        let root = dirs_next_local_data().join("com.firemio.miomail/character-mods");
        assert!(root.is_dir(), "MODフォルダーが見つかりません: {}", root.display());
        let (loaded, issues) = scan_packages(&root).unwrap();
        for issue in &issues {
            println!("ISSUE  {}: {}", issue.folder, issue.message);
        }
        for package in &loaded {
            let manifest = &package.descriptor.manifest;
            println!(
                "OK     {} ({:?}) v{} by {}",
                manifest.id, manifest.renderer, manifest.version, manifest.author
            );
        }
        assert!(issues.is_empty(), "読み込めないMODがあります");
        assert!(
            loaded
                .iter()
                .any(|package| package.descriptor.manifest.id == "firemio.mio-svg"),
            "ミオMODがスキャン結果にありません"
        );
    }

    fn dirs_next_local_data() -> PathBuf {
        PathBuf::from(std::env::var("LOCALAPPDATA").expect("LOCALAPPDATA"))
    }

    /// 単一のMODフォルダーだけを検証する（MOD作成時の確認用）。
    /// `MIOMAIL_MOD_DIR=<path> cargo test scan_one_mod_dir -- --ignored --exact --nocapture`
    #[test]
    #[ignore]
    fn scan_one_mod_dir() {
        let dir = PathBuf::from(std::env::var("MIOMAIL_MOD_DIR").expect("MIOMAIL_MOD_DIR"));
        assert!(dir.is_dir(), "MODフォルダーが見つかりません: {}", dir.display());
        match load_package(&dir) {
            Ok(loaded) => {
                let manifest = &loaded.descriptor.manifest;
                println!(
                    "OK     {} ({:?}) v{} by {}",
                    manifest.id, manifest.renderer, manifest.version, manifest.author
                );
            }
            Err(message) => panic!("MODを読み込めません: {message}"),
        }
    }

    /// リポジトリ同梱の既定MOD（mods/）が全てバリデーションを通ることを保証する。
    /// 同梱MODはこのスキャンと同じ経路でアプリに読み込まれる。
    #[test]
    fn bundled_default_mods_scan_cleanly() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../mods");
        assert!(root.is_dir(), "同梱MODフォルダーが見つかりません: {}", root.display());
        let (loaded, issues) = scan_packages(&root).unwrap();
        for issue in &issues {
            println!("ISSUE  {}: {}", issue.folder, issue.message);
        }
        assert!(issues.is_empty(), "読み込めない同梱MODがあります");
        for expected in [
            "firemio.makko-svg",
            "firemio.mio-svg",
            "firemio.posty-svg",
            "firemio.saeta-svg",
        ] {
            assert!(
                loaded
                    .iter()
                    .any(|package| package.descriptor.manifest.id == expected),
                "同梱MOD {expected} がスキャン結果にありません"
            );
        }
    }

    #[test]
    fn loads_a_real_dom_svg_package_end_to_end() {
        let dest = std::env::temp_dir().join(format!("miomail-dom-svg-e2e-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dest);
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join(MANIFEST_NAME), DOM_SVG_SAMPLE_CHARACTER).unwrap();
        fs::write(dest.join("scene.json"), DOM_SVG_SAMPLE_SCENE).unwrap();

        let loaded = load_package(&dest).unwrap();
        assert_eq!(loaded.descriptor.manifest.renderer, CharacterModRenderer::DomSvg);
        assert_eq!(loaded.descriptor.manifest.id, "firemio.dom-svg-sample");
        assert!(loaded.assets.contains_key("scene"));
        assert_eq!(loaded.descriptor.revision.len(), 64);

        let _ = fs::remove_dir_all(&dest);
    }
}
