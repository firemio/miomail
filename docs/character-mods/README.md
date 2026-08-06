# MioMail Character MOD v1

MioMailのキャラクターMODは、コードを実行しないデータ専用パッケージです。1キャラクターにつき1フォルダーを作り、その直下へ`character.json`を置きます。

既定の4キャラクター（マクコ・ミオ・ポスティ・サエタ）自体も、この仕組みで動くMODとしてアプリに同梱されています（リポジトリの`mods/`フォルダー）。DOM/SVG版（`*-svg`）とGLB 3D版（`*-3d`、旧「ふわふわ3D」を移植したもの）の2形式があり、どちらも完成形の見本としてそのまま参照できます。同じ`id`のMODをユーザーフォルダーへ入れると同梱版より優先されるため、既定キャラクターの差し替えも可能です。3D版のGLBは`node scripts/export-3d-mods/export.mjs`で再生成できます。

```text
character-mods/
└─ creator.fluffy-bear/
   ├─ character.json
   ├─ thumbnail.webp
   └─ assets/
      ├─ sprites.webp       # 2Dスプライトシートの場合
      ├─ idle/0001.webp     # 2D画像連番の場合
      └─ character.glb      # 3Dの場合
```

## 共通の考え方

描画方式は別々ですが、アプリから渡される動作名は共通です。

| 動作名 | 用途 |
| --- | --- |
| `idle` | 通常待機。2Dでは必須 |
| `look-around` | 左右を見回す |
| `alert` | 新着・注意 |
| `bounce` | 軽く弾む |
| `self-care` | 毛づくろい・点検など |
| `rest` | 居眠り・充電 |
| `inspect` | 周囲を確認する |
| `celebrate` | 喜ぶ |
| `walk` | 画面内移動・配達 |
| `deliver` | 投函などの専用動作 |

未定義の動作を要求された場合は`idle`へフォールバックします。歩く座標・配達・クリック1回転・軽い浮遊はアプリ側でも合成されるため、最初は`idle`だけから作り始められます。

`behaviorProfile`は既存の育成・ケア・移動規則を借りるための指定です。`makko`、`mio`、`posty`、`saeta`のいずれかを選びます。MODのIDを既存の育成データへ直接混ぜないため、MODを削除してもメールや育成状態は壊れません。

## 2D：スプライトシート

1枚の画像に複数コマを格子状に並べます。1枚の静止画を動かす方式ではありません。

```json
{
  "schemaVersion": 1,
  "id": "creator.fluffy-bear-2d",
  "name": "Fluffy Bear 2D",
  "version": "1.0.0",
  "author": "Creator",
  "description": "手描きの配達くま",
  "license": "CC-BY-4.0",
  "behaviorProfile": "makko",
  "renderer": "sprite-2d",
  "thumbnail": "thumbnail.webp",
  "source": {
    "type": "sheet",
    "file": "assets/sprites.webp",
    "frameWidth": 256,
    "frameHeight": 256,
    "columns": 4,
    "rows": 3,
    "imageRendering": "auto",
    "motions": {
      "idle": { "frames": [0, 1, 2, 1], "fps": 6, "loop": true },
      "walk": { "frames": [4, 5, 6, 7], "fps": 10, "loop": true },
      "celebrate": { "frames": [8, 9, 10, 11], "fps": 12, "loop": false }
    }
  }
}
```

コマは左上から右へ`0, 1, 2...`と数えます。透明背景のPNGまたはWebPを使用してください。ドット絵の場合は`imageRendering: "pixelated"`を指定できます。
`rows`は省略できます。その場合は画像の実寸と`frameHeight`から確定します。画像の横幅は必ず`frameWidth × columns`、縦幅は`frameHeight`の倍数にしてください。

## 2D：画像連番

Blenderなどから書き出した連番画像をそのまま使えます。

```json
"source": {
  "type": "sequence",
  "motions": {
    "idle": {
      "files": ["assets/idle/0001.webp", "assets/idle/0002.webp", "assets/idle/0003.webp"],
      "fps": 8,
      "loop": true
    },
    "walk": {
      "files": ["assets/walk/0001.webp", "assets/walk/0002.webp", "assets/walk/0003.webp"],
      "fps": 12,
      "loop": true
    }
  }
}
```

GIF/APNGは動作の途中切替や停止位置を制御しにくいため、v1では使用しません。
連番のPNG/WebPも各ファイルは静止画にしてください。再生時は現在コマと次コマだけを先読みします。同じ画像ファイルを複数のコマから参照せず、必要なら別ファイルとして書き出します。

## 3D：BlenderからGLB

GLBにはメッシュ、マテリアル、埋め込みテクスチャ、ボーン、スキニング、シェイプキー、複数のAnimation Clipを格納できます。

```json
{
  "schemaVersion": 1,
  "id": "creator.fluffy-bear-3d",
  "name": "Fluffy Bear 3D",
  "version": "1.0.0",
  "author": "Creator",
  "description": "Blenderで作った配達くま",
  "behaviorProfile": "makko",
  "renderer": "gltf-3d",
  "thumbnail": "thumbnail.webp",
  "source": {
    "type": "model",
    "file": "assets/character.glb",
    "scale": 1,
    "groundOffset": 0,
    "rotationY": 0,
    "motions": {
      "idle": { "clip": "Idle", "loop": true },
      "walk": { "clip": "Walk", "loop": true },
      "celebrate": { "clip": "Celebrate", "loop": false }
    }
  }
}
```

Blenderでは各動作をAction/NLA Trackとして作成し、glTF 2.0の`GLB`形式へ書き出します。テクスチャはGLBへ埋め込み、カメラとライトは書き出さないでください。物理、ドライバー、制約のうちglTFへ直接移らない動きは、ボーンまたはシェイプキーのActionへベイクします。
動かすモデルでは`idle`を必須とし、`clip`にはGLB内のAnimation Clip名を大文字小文字まで正確に指定します。読み込み時に全ての対応名を検証するため、名前の打ち間違いは設定画面へエラーとして表示されます。

## DOM/SVG：手描きパーツ + CSSアニメーション

生のHTML/CSS/SVGファイルは受け付けません。代わりに`scene.json`という**構造化JSON**でパーツと動きを記述し、アプリ側がその数値・enumだけからDOM/CSSを組み立てます。MODが書いた文字列がそのままマークアップやスタイルシートへ渡ることはありません。組み込みキャラクター（ミオなど）と同じ「体はdivの重なり、頭はSVG path」という描き方で、耳の揺れやまばたきまで再現できます。

```json
{
  "schemaVersion": 1,
  "id": "creator.fluffy-bear-svg",
  "name": "Fluffy Bear SVG",
  "version": "1.0.0",
  "author": "Creator",
  "description": "手描きSVGパーツで組んだ配達くま",
  "behaviorProfile": "makko",
  "renderer": "dom-svg",
  "thumbnail": "thumbnail.webp",
  "source": {
    "type": "scene",
    "file": "assets/scene.json",
    "motions": {
      "idle": { "animations": ["breath", "ear-left", "ear-right"], "loop": true },
      "rest": { "pose": { "rotate": 3, "translateY": 3 }, "expression": "sleepy", "animations": ["doze"], "loop": true }
    }
  }
}
```

`assets/scene.json`は以下の固定語彙だけで木構造を作ります。

- **node**（`root`直下、`group`と`box`の子）: `group`（入れ子コンテナ）、`box`（背景・角丸・枠線・クリップパスを持つdiv。子ノードを入れられます）、`svg`（内部に`shape`を持つSVGルート）
- **shape**（`svg`ノードの中だけ）: `path`（`d`属性）、`ellipse`、`rect`、`shapeGroup`（`<g>`相当）
- 位置は`left/right/top/bottom/width/height`（%）、変形は`rotate` / `rotateX` / `rotateY` / `translateX` / `translateY` / `scale` / `scaleX` / `scaleY`
- 奥行きは`z`（0〜200）。値が大きいほど手前に出ます。`viewBox`の幅を基準にサイズ比例で伸縮するので、どの表示サイズでも同じ立体感になります。`scale`は子の`z`にも掛かります
- 色は`{"type":"solid","color":"#rrggbb"}`のような構造化paint（`linear` / `radial`グラデーション、`transparent`も可）。`background`に配列を渡すとCSSと同じく先頭が最前面のレイヤーになります
- 質感は`filter`（drop-shadowの並び。同じ色を上下左右1pxずつ重ねると輪郭線になります）、`boxShadow`、`border` / `borderBottom`で付けます
- 表情差分は各パーツに`visibleIn: ["normal"]`のように出したい`expression`を列挙し、`character.json`側の`motions.*.expression`で切り替えます
- ループ・単発アニメーションは`scene.json`の`animations`にキーフレームとして定義し、node/shapeから`animation: "名前"`で参照して、`character.json`側の`motions.*.animations`で動作ごとに有効・無効を切り替えます
- キャラクター全体を動かす動作（うたた寝、跳ねる、見回すなど）は`motions.*.poseAnimation`に同じくanimation名を指定します。2Dの`frames`、3Dの`clip`にあたるものです

制限: node/shape合計400個、ネスト12階層、animation定義32個、1animationあたりkeyframe24個、背景レイヤー4枚、影6個、グラデーションの色停止8個、path dataは12,000文字までかつSVGパスコマンドと数値のみ（`url()`・`#`参照・`javascript:`などはこの時点で構文として成立しません）。色は`#rgb`系・`rgb()/rgba()`・`transparent`のみで、`url()`・`var()`・named colorは使えません。scene.jsonは512 KiBまでです。
完全な語彙は[scene.schema.json](./scene.schema.json)、コピー用の例は[examples/dom-svg.example.json](./examples/dom-svg.example.json)にあります。組み込みキャラクターの「ミオ」をこの形式で書き起こした実物が[mods/mio-svg](../../mods/mio-svg)にあるので、実際の組み立て方の見本にしてください。

## 安全性と上限

- MOD内のHTML、JavaScript、CSS、shaderは実行しません。dom-svgの`scene.json`も生マークアップではなく構造化JSONで、色・寸法・path dataなどの値だけを検証したうえでアプリが自前でDOM/CSSを組み立てます。
- リモートURL、絶対パス、`..`、UNC、symlink/junctionによるフォルダー外参照を拒否します。
- 3Dはテクスチャを埋め込んだ単一GLBだけです。外部`.bin`や外部画像は読みません。
- manifestは64 KiB、thumbnailは512 KiBかつ512×512px、パッケージは48 MiB、各画像は4096×4096 / 16MP、GLBは32 MiBまでです。
- 2D画像はパッケージ合計32MP、GLB内の埋め込みtextureは合計8MPまでです。APNGとアニメWebPは読みません。
- GLBのJSON chunkは2 MiBまでです。単一sceneのforest構造、表示時triangle 100,000以下、node 256、material 32、texture/sampler 16、bone 128、morph target 8、animation 32などを検証します。
- GLB extensionとextrasはv1では使用しません。BlenderではDraco圧縮、追加マテリアル拡張、カスタムプロパティの書き出しを無効にしてください。
- 検出時のSHA-256と読み込み時のrevisionが一致したデータだけを描画します。

完全な機械可読仕様は[character.schema.json](./character.schema.json)、コピー用の例は[`examples`](./examples)にあります。
