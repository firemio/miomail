# MioMail Character MOD v1

MioMailのキャラクターMODは、コードを実行しないデータ専用パッケージです。1キャラクターにつき1フォルダーを作り、その直下へ`character.json`を置きます。

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

## 安全性と上限

- MOD内のHTML、JavaScript、CSS、shaderは実行しません。
- リモートURL、絶対パス、`..`、UNC、symlink/junctionによるフォルダー外参照を拒否します。
- 3Dはテクスチャを埋め込んだ単一GLBだけです。外部`.bin`や外部画像は読みません。
- manifestは64 KiB、thumbnailは512 KiBかつ512×512px、パッケージは48 MiB、各画像は4096×4096 / 16MP、GLBは32 MiBまでです。
- 2D画像はパッケージ合計32MP、GLB内の埋め込みtextureは合計8MPまでです。APNGとアニメWebPは読みません。
- GLBのJSON chunkは2 MiBまでです。単一sceneのforest構造、表示時triangle 100,000以下、node 256、material 32、texture/sampler 16、bone 128、morph target 8、animation 32などを検証します。
- GLB extensionとextrasはv1では使用しません。BlenderではDraco圧縮、追加マテリアル拡張、カスタムプロパティの書き出しを無効にしてください。
- 検出時のSHA-256と読み込み時のrevisionが一致したデータだけを描画します。

完全な機械可読仕様は[character.schema.json](./character.schema.json)、コピー用の例は[`examples`](./examples)にあります。
