MioMail Character MOD v1
========================

1キャラクター = 1フォルダーです。
各フォルダー直下へ character.json を置いてください。

対応形式
- 2D: PNG/WebPのスプライトシート、またはPNG/WebP画像連番
- 3D: Blenderなどから書き出した、テクスチャ埋め込み済みの単一GLB
- DOM/SVG: scene.json（固定語彙の構造化JSON。生のSVG/CSSファイルではありません）

非対応
- HTML / JavaScript / CSS / shader / 生のSVGファイル
- GIF / APNG / アニメWebP
- リモートURL、絶対パス、フォルダー外参照
- 外部.binや外部画像、GLB extension

共通動作名
idle, look-around, alert, bounce, self-care, rest, inspect,
celebrate, walk, deliver

同じフォルダーに自動生成される character.schema.json と
*.example.json をコピーして作り始められます。

既定の4キャラクター(マクコ・ミオ・ポスティ・サエタ)もDOM/SVG MODとして
アプリに同梱されています。同じidのMODをこのフォルダーへ入れると
同梱版より優先されるため、既定キャラクターの差し替えもできます。
