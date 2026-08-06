# 既定キャラクター 3D MOD ジェネレーター

既定4キャラの「ふわふわ3D」GLB MOD（`mods/{makko,mio,posty,saeta}-3d/`）を生成する。

```bash
node scripts/export-3d-mods/export.mjs
```

- `legacy3d.mjs` — 旧`CourierMascot3D.tsx`（gitのdad9ca2^に原本）から移植したキャラクター生成コードとポーズサンプラー。マテリアルはglTF拡張を出さないよう標準PBRへ変換済み
- `export.mjs` — ポーズ8種の手続きアニメーションを20fps×6秒でサンプリングし、ループ境界をクロスフェードしてglTFアニメーションクリップへ焼き込み、GLBと`character.json`を出力する

制約（Rustバリデーター準拠）: GLB拡張・extras・camera禁止 / accessor≤512 / animation channel≤512。
モーフ（もこもこ呼吸）はaccessor節約のためidleとrestのクリップにだけ焼き込んでいる。

`thumbnail.webp`はアプリの実レンダリングをキャプチャして作成したもの（再生成しても上書きされない）。

検証:

```bash
cd src-tauri
cargo test --lib bundled_default_mods_scan_cleanly -- --nocapture
```
