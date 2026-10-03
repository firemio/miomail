# 既定キャラクター 3D MOD ジェネレーター

既定4キャラの「ふわふわ3D」GLB MOD（`mods/{makko,mio,posty,saeta}-3d/`）を生成する。

```bash
node scripts/export-3d-mods/export.mjs
```

対象のMODだけを再生成する場合:

```bash
node scripts/export-3d-mods/export.mjs makko-3d saeta-3d
```

- `makko2d3d.mjs` / `saeta2d3d.mjs` — 2D版の比率・配色・顔・耳や羽を立体化したモデル。`soft2d3d.mjs` の曲面パッチで顔とお腹の模様を本体に沿わせる
- `mio2d3d.mjs` / `posty2d3d.mjs` — ミオとポスティの2D準拠モデル

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
