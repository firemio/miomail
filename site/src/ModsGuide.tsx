import { ArrowLeft, Download, FolderOpen, Plus, RefreshCw, ShieldCheck } from 'lucide-react'
import { DOWNLOAD_URL } from './links'
import logoImage from '../../src/renderer/assets/miomail-logo.png'

const FOLDER_TREE = `character-mods/
└─ my-cat/                 ← 1キャラクター = 1フォルダー
   ├─ character.json       ← 設定ファイル(これだけ必須)
   ├─ thumbnail.webp       ← 一覧用サムネイル(任意)
   └─ assets/
      ├─ sprites.webp      ← 2D(sprite-2d)の場合
      ├─ scene.json        ← 手描きSVG(dom-svg)の場合
      └─ character.glb     ← 3D(gltf-3d)の場合`

const SPRITE_EXAMPLE = `{
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
      "idle":      { "frames": [0, 1, 2, 1],   "fps": 6,  "loop": true },
      "walk":      { "frames": [4, 5, 6, 7],   "fps": 10, "loop": true },
      "celebrate": { "frames": [8, 9, 10, 11], "fps": 12, "loop": false }
    }
  }
}`

const SEQUENCE_EXAMPLE = `"source": {
  "type": "sequence",
  "motions": {
    "idle": {
      "files": ["assets/idle/0001.webp", "assets/idle/0002.webp"],
      "fps": 8,
      "loop": true
    }
  }
}`

const GLB_EXAMPLE = `{
  "schemaVersion": 1,
  "id": "creator.fluffy-bear-3d",
  "name": "Fluffy Bear 3D",
  "version": "1.0.0",
  "author": "Creator",
  "description": "Blenderで作った配達くま",
  "license": "CC-BY-4.0",
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
      "idle":        { "clip": "Idle",       "loop": true },
      "look-around": { "clip": "LookAround", "loop": true },
      "walk":        { "clip": "Walk",       "loop": true },
      "celebrate":   { "clip": "Celebrate",  "loop": false }
    }
  }
}`

const DOM_SVG_EXAMPLE = `{
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
      "look-around": {
        "pose": { "rotate": -2 },
        "animations": ["breath", "look-around"],
        "loop": true
      },
      "rest": {
        "pose": { "rotate": 3, "translateY": 3 },
        "expression": "sleepy",
        "animations": ["doze"],
        "loop": true
      },
      "celebrate": {
        "pose": { "scale": 1.03 },
        "animations": ["hop", "ear-left", "ear-right"],
        "loop": true
      }
    }
  }
}`

const SCENE_EXAMPLE = `{
  "sceneVersion": 1,
  "viewBox": [200, 200],
  "animations": {
    "breath": {
      "durationMs": 3200,
      "easing": "ease-in-out",
      "iteration": "infinite",
      "keyframes": [
        { "at": 0,   "transform": {} },
        { "at": 50,  "transform": { "scaleY": 1.03 } },
        { "at": 100, "transform": {} }
      ]
    }
  },
  "root": [
    {
      "kind": "box",
      "id": "body",
      "left": 25, "top": 34, "width": 50, "height": 58, "z": 10,
      "borderRadius": "50% 50% 46% 46% / 58% 58% 42% 42%",
      "background": { "type": "solid", "color": "#f2b98c" },
      "animation": "breath"
    },
    {
      "kind": "svg",
      "id": "face",
      "left": 22, "top": 10, "width": 56, "height": 34, "z": 40,
      "viewBox": [120, 80],
      "children": [
        { "kind": "path", "d": "M10 72 Q60 -4 110 72 Z",
          "fill": { "type": "solid", "color": "#f2b98c" } },
        { "kind": "ellipse", "cx": 42, "cy": 52, "rx": 5, "ry": 7,
          "fill": { "type": "solid", "color": "#3a2b26" },
          "visibleIn": ["normal", "happy"] }
      ]
    }
  ]
}`

const BUNDLED_MODS = [
  ['mods/makko-svg ・ mio-svg ・ posty-svg ・ saeta-svg', 'dom-svg', '既定4キャラそのもの。輪郭線・まばたき・寝顔・ひげのぴくつきまで入った完成形'],
  ['mods/makko-3d ・ mio-3d ・ posty-3d ・ saeta-3d', 'gltf-3d', '同じ4キャラの3D GLB版。ミオとポスティは2D版の絵をそのまま立体化したもの'],
  ['mods/posty-simple-robo', 'gltf-3d', '旧「ふわふわ3D」のポスティ。まるっとしたシンプルなブリキロボ'],
] as const

const MANIFEST_FIELDS = [
  ['schemaVersion', '固定で 1'],
  ['id', '全MODで一意なID。半角小文字・数字・「. _ -」のみ、3〜64文字(例: creator.fluffy-bear-2d)'],
  ['name', '一覧に表示される名前(80文字まで)'],
  ['version', 'あなたが決めるバージョン表記(32文字まで。例: 1.0.0)'],
  ['author', '作者名(80文字まで)'],
  ['description', '任意。キャラクターの説明(300文字まで)'],
  ['license', '任意。CC-BY-4.0 など配布条件を書いておくと親切'],
  ['behaviorProfile', 'makko / mio / posty / saeta のどれか。仕草のタイミングや育成をどの組み込みキャラから引き継ぐか'],
  ['renderer', 'sprite-2d(2D) / gltf-3d(3D) / dom-svg(手描きSVGパーツ)'],
  ['thumbnail', '任意。一覧用サムネイル(png / webp、512px・512KBまで)。2Dは未指定でもidleの1コマ目、dom-svgは本体の縮小表示が出ますが、3Dは未指定だとアイコン表示になるので用意がおすすめ'],
  ['source', '素材とモーションの定義(形式ごとのセクションを参照)'],
] as const

const MOTIONS = [
  ['idle', '待機。sprite-2dとdom-svgでは必須(gltf-3dもモーションを書く場合は必須)'],
  ['look-around', 'あたりをきょろきょろ見回す'],
  ['alert', '新着メールなどのお知らせに反応する'],
  ['bounce', 'うれしいときに弾む'],
  ['self-care', '毛づくろい・お手入れ'],
  ['rest', 'ひとやすみ・うたた寝'],
  ['inspect', '興味しんしんで何かを調べる'],
  ['celebrate', 'お祝い・大よろこび'],
  ['walk', 'デスクトップをおさんぽ中の移動'],
  ['deliver', 'メール配達の演出中'],
] as const

interface FormatFactsProps {
  rows: ReadonlyArray<readonly [string, string]>
}

function FormatFacts({ rows }: FormatFactsProps) {
  return (
    <table className="site-docs-table">
      <tbody>
        {rows.map(([label, text]) => (
          <tr key={label}>
            <td style={{ whiteSpace: 'nowrap' }}><strong>{label}</strong></td>
            <td>{text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function ModsGuide() {
  return (
    <div className="site-docs">
      <header className="site-docs-header">
        <a href="/" aria-label="MioMail ホーム">
          <img className="site-brand__logo" src={logoImage} alt="MioMail" draggable={false} />
        </a>
        <nav>
          <a href="/">トップ</a>
          <a href="./mcp.html">MCPガイド</a>
          <a href={DOWNLOAD_URL}><Download size={13} /> ダウンロード</a>
        </nav>
      </header>

      <main>
        <h1>キャラクターMODの作り方</h1>
        <p className="site-docs-lead">
          MioMailの相棒は、じぶんで描いた2Dキャラ、手描きSVGパーツ、Blenderで作った3Dモデルに着せ替えられます。
          既定の4キャラクター(マクコ・ミオ・ポスティ・サエタ)自体も、この仕組みで動くMODとしてアプリに同梱されているので、
          <strong>同梱MODをコピーして書き換えるのが作り始めの最短ルート</strong>です。
          必要なのは <strong>1キャラクター = 1フォルダー</strong> と、設定ファイル <code>character.json</code> が1枚だけ。
          MOD内のコードは一切実行されない安全設計です。
        </p>

        <h2>まずは同梱MODのコピーから(最短ルート)</h2>
        <p>
          完成形の見本が、SVG版4体 + 3D GLB版4体 + シンプルロボの計9体、
          リポジトリの<code>mods/</code>フォルダーに入っています。気に入った1体をフォルダーごとコピーして、
          <code>character.json</code>の<code>id</code>と<code>name</code>を自分のものに書き換えるところから始めるのがいちばん早い方法です。
        </p>
        <table className="site-docs-table">
          <thead>
            <tr><th>フォルダー</th><th>形式</th><th>内容</th></tr>
          </thead>
          <tbody>
            {BUNDLED_MODS.map(([folder, renderer, desc]) => (
              <tr key={folder}><td><code>{folder}</code></td><td><code>{renderer}</code></td><td>{desc}</td></tr>
            ))}
          </tbody>
        </table>
        <p>
          同じ<code>id</code>のMODをユーザーのMODフォルダーへ入れると<strong>同梱版より優先</strong>されるため、
          既定キャラクターをまるごと差し替えることもできます。逆に、自作MODとして配るときは<code>id</code>を必ず自分のものへ変えてください。
        </p>

        <h2>対応している3つの形式</h2>
        <table className="site-docs-table">
          <thead>
            <tr><th>renderer</th><th>素材</th><th>向いている人</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><code>sprite-2d</code></td>
              <td>PNG / WebP のスプライトシート、または画像連番</td>
              <td>イラストやドット絵を描く人</td>
            </tr>
            <tr>
              <td><code>gltf-3d</code></td>
              <td>テクスチャ埋め込み済みの単一GLB(Blenderなどから書き出し)</td>
              <td>3Dモデリングをする人</td>
            </tr>
            <tr>
              <td><code>dom-svg</code></td>
              <td>固定語彙の構造化JSON(<code>scene.json</code>)で組んだSVGパーツ + CSSアニメーション</td>
              <td>組み込みキャラのような手描きイラストを、コードなしで動かしたい人</td>
            </tr>
          </tbody>
        </table>
        <div className="site-docs-note">
          <ShieldCheck size={18} />
          <span>
            <strong>非対応:</strong> HTML / JavaScript / CSS / シェーダー / 生のSVGファイル、GIF・APNG・アニメWebP、
            リモートURL・絶対パス・フォルダー外参照・外部.bin。
            <code>dom-svg</code>も生マークアップは受け取らず、色や座標などの値だけを検証してアプリ側がDOM/CSSを組み立てます。
            読み込み時にすべて検証され、通らないMODは既定キャラクター(または卵)へ安全にフォールバックします。
          </span>
        </div>

        <h2>作成から反映までの流れ</h2>
        <ol className="site-docs-steps">
          <li>
            MioMailの <strong>設定 → 見た目と相棒</strong> を開く。
            「<Plus size={13} /> MODを追加」でzip / tar.xzのMODをそのまま読み込めるほか、
            「<FolderOpen size={13} /> MODフォルダー」でフォルダーを直接開けます。
          </li>
          <li>
            フォルダー直置きの場合、MODフォルダーにはREADMEと <code>character.schema.json</code>・<code>scene.schema.json</code>、
            4種類のexample.jsonが自動生成されています。1キャラクターにつき1フォルダーを作り、素材と <code>character.json</code> を置きます。
          </li>
          <li>「<RefreshCw size={13} /> 再読み込み」で一覧に反映。検証に通ったMODだけが相棒として選べます。</li>
          <li>各キャラクターカードのテストボタンでテストモーダルを開くと、全モーションと成長段階をその場で確認できます。</li>
        </ol>
        <pre className="site-docs-code">{FOLDER_TREE}</pre>
        <p>
          検証に通らなかったMODは、設定画面に「読み込めなかったMOD」として理由つきで表示されます。
          選択中だったMODが読めなくなったときも、既定キャラクター(同梱MOD)へ安全にフォールバックするので、アプリが困ることはありません。
        </p>

        <h2>character.json の基本フィールド</h2>
        <table className="site-docs-table">
          <thead>
            <tr><th>フィールド</th><th>内容</th></tr>
          </thead>
          <tbody>
            {MANIFEST_FIELDS.map(([field, desc]) => (
              <tr key={field}><td><code>{field}</code></td><td>{desc}</td></tr>
            ))}
          </tbody>
        </table>

        <h2>モーション一覧</h2>
        <p>使える動作名は次の10種類。ぜんぶ作らなくても大丈夫、足りない分はidleで動きます。</p>
        <table className="site-docs-table">
          <thead>
            <tr><th>動作名</th><th>いつ再生される？</th></tr>
          </thead>
          <tbody>
            {MOTIONS.map(([motion, desc]) => (
              <tr key={motion}><td><code>{motion}</code></td><td>{desc}</td></tr>
            ))}
          </tbody>
        </table>
        <p>
          歩く座標・配達・クリックでの1回転・軽い浮遊はアプリ側でも合成されるため、最初はidleだけから作り始められます。
          <code>behaviorProfile</code>で指定した組み込みキャラから仕草のタイミングや育成規則を引き継ぐので、
          MODを削除しても育成状態は壊れません。
        </p>

        <h2>2D MOD(sprite-2d)</h2>
        <FormatFacts
          rows={[
            ['向いている人', 'イラストやドット絵を描く人。手持ちのペイントツールだけで完結します'],
            ['必要ファイル', 'character.json + 透明背景PNG / WebPのスプライトシート1枚(または連番画像)'],
            ['つまずきやすい点', '画像の実寸は「frameWidth × columns」の横幅と、frameHeightの倍数の縦幅に合わせます。GIF・APNG・アニメWebPは使えません。idleモーションは必須です'],
          ]}
        />
        <p>
          1枚の画像にコマを並べて、コマ番号でアニメーションを定義します。
          コマ番号は<strong>左上から右へ0, 1, 2…</strong>と数えます。
          MODフォルダーに自動生成される<code>sprite-sheet.example.json</code>をコピーして書き換えるのが手早いです。
        </p>
        <pre className="site-docs-code">{SPRITE_EXAMPLE}</pre>
        <ul>
          <li><code>frameWidth</code> / <code>frameHeight</code> — 1コマのピクセルサイズ(16〜2048px)</li>
          <li><code>columns</code> — シートの列数。<code>rows</code>は省略でき、その場合は画像の実寸から確定します</li>
          <li><code>frames</code> — 再生するコマ番号の並び(同じ番号を繰り返してもOK、1モーション240コマまで)</li>
          <li><code>fps</code> は1〜60</li>
          <li><code>imageRendering: "pixelated"</code> にするとドット絵がくっきり表示されます</li>
          <li>定義していないモーションは自動的にidleで代用されます</li>
        </ul>
        <h3>画像連番でも作れます</h3>
        <p>
          シートにまとめず、1コマ1ファイルの連番画像でもOK(全モーション合計480枚まで)。
          各ファイルは静止画にして、同じ画像を複数のコマから参照しないでください。
        </p>
        <pre className="site-docs-code">{SEQUENCE_EXAMPLE}</pre>

        <h2>3D MOD(gltf-3d)</h2>
        <FormatFacts
          rows={[
            ['向いている人', 'Blenderなどで3Dモデリングをする人'],
            ['必要ファイル', 'character.json + テクスチャ埋め込みの単一GLB(assets/character.glb)。一覧用にthumbnail.webpも用意するのがおすすめ'],
            ['つまずきやすい点', 'Animation Clip名の打ち間違い(大文字小文字も区別)、Draco圧縮やマテリアル拡張の混入、テクスチャの外部参照、カメラの消し忘れ。いずれも検証で弾かれます'],
          ]}
        />
        <p>
          Blenderなどで作ったモデルを、<strong>テクスチャ埋め込みの単一GLB</strong>(glTF Binary)で書き出します。
          <code>clip</code>にはGLB内のAnimation Clip名(Blenderのアクション名)を<strong>大文字小文字まで正確に</strong>書きます。
          クリップ名は読み込み時にすべて検証され、間違いは設定画面へエラーとして表示されます。
          同梱の<code>mods/makko-3d</code>などが完成形の見本です。
        </p>
        <pre className="site-docs-code">{GLB_EXAMPLE}</pre>
        <ul>
          <li><code>scale</code>(0.1〜10) / <code>groundOffset</code>(-5〜5) / <code>rotationY</code>(-360〜360)で大きさ・接地位置・向きを微調整</li>
          <li>モーションを省略して静止モデルだけでもOK(書く場合はidleが必須)</li>
        </ul>
        <h3>Blenderからの書き出しのコツ</h3>
        <ul>
          <li>各動作を1つのAction / NLA Trackとして作り、名前を<code>character.json</code>の<code>clip</code>とそろえる</li>
          <li>File → Export → glTF 2.0で「glTF Binary (.glb)」を選ぶ。テクスチャは自動的にGLBへ埋め込まれます(外部.bin・外部画像は不可)</li>
          <li>カメラとライトは書き出さない(cameraは検証で拒否、ライトはglTF拡張になるためこれも拒否)</li>
          <li>Draco圧縮・追加マテリアル拡張・カスタムプロパティの書き出しはOFFにする(GLB拡張と<code>extras</code>はv1では使用不可)</li>
          <li>物理・ドライバー・制約のうちglTFへ直接移らない動きは、ボーンまたはシェイプキーのActionへベイクする</li>
        </ul>
        <h3>GLBの制約(検証で弾かれるもの)</h3>
        <ul>
          <li>GLB本体32MBまで、JSON部は2MBまで。埋め込みテクスチャは合計8メガピクセルまで</li>
          <li>glTF拡張・<code>extras</code>・カメラは禁止。sceneは1つだけ</li>
          <li>node 256・mesh 128・material 32・texture / sampler / image 各16・animation 32・skin 16まで</li>
          <li>ボーンは1スキンあたり128本、モーフターゲットはprimitiveごとに8個まで</li>
          <li>accessor 512・animation channel 512・表示トライアングル100,000まで</li>
        </ul>

        <h2>手描きSVG MOD(dom-svg)</h2>
        <FormatFacts
          rows={[
            ['向いている人', '組み込みキャラのような手描きイラストを、コードを書かずに動かしたい人'],
            ['必要ファイル', 'character.json + scene.json(固定語彙の構造化JSON)'],
            ['つまずきやすい点', '生のSVGファイルは読み込めません(path dのコマンドと数値だけ持ち込めます)。色は#hex / rgb() / transparentのみで、名前付き色・url()・var()は使えません'],
          ]}
        />
        <p>
          組み込みキャラクター(ミオなど)と同じ、「体はパーツの重なり、頭はSVG」という描き方をMODでも使えます。
          ただし生のSVG/CSSファイルはそのまま読み込みません。<code>scene.json</code>という<strong>固定語彙の構造化JSON</strong>でパーツと動きを記述し、
          アプリ側がその数値だけからDOM/CSSを組み立てます。呼吸・耳揺れのようなループも、まばたきのような単発演出も、寝顔への表情差し替えも作れます。
        </p>
        <pre className="site-docs-code">{DOM_SVG_EXAMPLE}</pre>
        <p><code>scene.json</code>のいちばん小さな形はこんな雰囲気です。</p>
        <pre className="site-docs-code">{SCENE_EXAMPLE}</pre>
        <ul>
          <li><code>root</code>には<code>group</code>(入れ子コンテナ)/ <code>box</code>(角丸・グラデーション・枠線付きのdiv)/ <code>svg</code>(中に<code>path</code> / <code>ellipse</code> / <code>rect</code> / <code>shapeGroup</code>を持つ)だけで木構造を組みます</li>
          <li>
            <code>z</code>(0〜200)でパーツの前後(奥行き)を決めます。大きいほど手前、書かなければ0扱い、
            同じ値なら後に書いたほうが手前。入れ子の子の<code>z</code>は親の<code>z</code>に足されます。
            <code>svg</code>の中の図形(<code>path</code>など)に<code>z</code>はなく、書いた順だけで重なります。
            表示サイズに比例して伸縮するので、どの大きさでも同じ立体感になります
          </li>
          <li><code>animations</code>にキーフレームを定義し、パーツから<code>animation: "名前"</code>で参照(ループ・単発どちらも可)</li>
          <li>キャラクター全体の動き(うたた寝・跳ねる・見回すなど)は<code>motions.*.poseAnimation</code>に指定します。2Dの<code>frames</code>、3Dの<code>clip</code>にあたるものです</li>
          <li>各パーツに<code>visibleIn: ["sleepy"]</code>のように表情タグ(normal / sleepy / happy / sad)を付け、<code>motions.rest.expression</code>などで切り替え</li>
          <li>色は<code>{'{ "type": "solid", "color": "#rrggbb" }'}</code>のような構造化指定のみ(linear / radialグラデーションも可)。<code>url()</code>や外部画像参照は使えません</li>
          <li>質感は<code>filter</code>(drop-shadowの並び。同じ色を上下左右1pxずつ重ねると輪郭線になります)・<code>boxShadow</code>・<code>border</code>で付けます</li>
          <li>上限: scene.json 512KB、node / shape合計400個、ネスト12階層、animation 32個(1つにつきキーフレーム24個)、背景レイヤー4枚、影6個、グラデーションの色停止8個、path dataは12,000文字まで</li>
        </ul>
        <p>
          完全な語彙はMODフォルダーに自動生成される<code>scene.schema.json</code>にあります。
          同梱の<code>mods/mio-svg</code>など<code>*-svg</code>の4体が、この形式で既定キャラクターを丸ごと書き起こした実物なので、
          組み立て方の見本にどうぞ。
        </p>

        <h2>サイズと個数の上限</h2>
        <ul>
          <li>character.json: 64KBまで</li>
          <li>画像: 1ファイル16MBまで、最大4096×4096px。2D画像はパッケージ合計32メガピクセルまで</li>
          <li>GLB: 32MBまで</li>
          <li>scene.json: 512KBまで</li>
          <li>サムネイル: 512KB・512pxまで</li>
          <li>1つのMODフォルダー合計: 48MBまで</li>
          <li>「MODを追加」で読み込むアーカイブ(zip / tar.xz): 64MBまで</li>
          <li>MODの数: 最大64個</li>
        </ul>

        <h2>配布する・もらう</h2>
        <p>
          フォルダーごとzipまたはtar.xz(XZ / LZMA2)に固めて共有するだけ。
          もらった人は「MODを追加」でそのファイルを選ぶだけで使えます(MODフォルダーへ展開して「再読み込み」でもOK)。
          MODは画像とJSONだけで構成され、検証に通ったものだけが使われ、コードは実行されないので、安心して配布できます。
        </p>

        <div className="site-docs-cta">
          <a className="site-button site-button--primary" href={DOWNLOAD_URL}>
            <Download size={18} /> MioMailをダウンロード
          </a>
          <a className="site-text-link" href="/"><ArrowLeft size={15} /> トップへ戻る</a>
        </div>
      </main>

      <footer className="site-docs-footer">
        <span>© 2026 MioMail</span>
        <span style={{ display: 'inline-flex', gap: 18 }}>
          <a href="./mcp.html">MCPガイド</a>
          <a href="https://github.com/firemio/miomail">GitHub</a>
        </span>
      </footer>
    </div>
  )
}
