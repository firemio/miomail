import { ArrowLeft, Download, FolderOpen, RefreshCw, ShieldCheck } from 'lucide-react'
import { DOWNLOAD_URL } from './links'
import logoImage from '../../src/renderer/assets/miomail-logo.png'

const FOLDER_TREE = `character-mods/
└─ my-cat/                 ← 1キャラクター = 1フォルダー
   ├─ character.json       ← 設定ファイル(これだけ必須)
   ├─ thumbnail.webp       ← 一覧用サムネイル(任意)
   └─ assets/
      ├─ sprites.webp      ← 2Dの場合
      └─ character.glb     ← 3Dの場合`

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
    "idle": { "files": ["assets/idle_0.png", "assets/idle_1.png"], "fps": 4, "loop": true }
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

const MANIFEST_FIELDS = [
  ['schemaVersion', '固定で 1'],
  ['id', '全MODで一意なID。半角小文字・数字・「. _ -」のみ、3〜64文字(例: creator.fluffy-bear-2d)'],
  ['name', '一覧に表示される名前(80文字まで)'],
  ['version', 'あなたが決めるバージョン表記(例: 1.0.0)'],
  ['author', '作者名'],
  ['description', 'キャラクターの説明'],
  ['license', '任意。CC-BY-4.0 など配布条件を書いておくと親切'],
  ['behaviorProfile', 'makko / mio / posty / saeta のどれか。仕草のタイミングや性格をどの組み込みキャラから引き継ぐか'],
  ['renderer', 'sprite-2d(2D) または gltf-3d(3D)'],
  ['thumbnail', '任意。一覧用サムネイル(512px・512KBまで)'],
  ['source', '素材とモーションの定義(下のセクションを参照)'],
] as const

const MOTIONS = [
  ['idle', '待機。2D MODでは必須(3Dもモーションを書く場合は必須)'],
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

export function ModsGuide() {
  return (
    <div className="site-docs">
      <header className="site-docs-header">
        <a href="/" aria-label="MioMail ホーム">
          <img className="site-brand__logo" src={logoImage} alt="MioMail" draggable={false} />
        </a>
        <nav>
          <a href="/">トップ</a>
          <a href={DOWNLOAD_URL}><Download size={13} /> ダウンロード</a>
        </nav>
      </header>

      <main>
        <h1>キャラクターMODの作り方</h1>
        <p className="site-docs-lead">
          MioMailの相棒は、じぶんで描いた2Dキャラや、Blenderで作った3Dモデルに着せ替えられます。
          必要なのは <strong>1キャラクター = 1フォルダー</strong> と、設定ファイル <code>character.json</code> が1枚だけ。
          MOD内のコードは一切実行されない安全設計です。
        </p>

        <h2>対応している形式</h2>
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
          </tbody>
        </table>
        <div className="site-docs-note">
          <ShieldCheck size={18} />
          <span>
            <strong>非対応:</strong> HTML / JavaScript / CSS / シェーダー、GIF・APNG・アニメWebP・SVG、
            リモートURL・絶対パス・フォルダー外参照・外部.bin。
            読み込み時にすべて検証され、通らないMODは組み込みキャラクターへ安全にフォールバックします。
          </span>
        </div>

        <h2>作成手順</h2>
        <ol className="site-docs-steps">
          <li>
            MioMailの <strong>設定 → 外観 → CHARACTER MODS</strong> にある
            「<FolderOpen size={13} /> MODフォルダー」ボタンでフォルダーを開く。
            READMEと <code>character.schema.json</code>、サンプルJSONが自動生成されています。
          </li>
          <li>1キャラクターにつき1フォルダーを作る(例: <code>my-cat/</code>)。</li>
          <li>素材を置く。2Dなら <code>assets/sprites.webp</code> など、3Dなら <code>assets/character.glb</code>。</li>
          <li>サンプルJSONをコピーして <code>character.json</code> を書く。</li>
          <li>アプリに戻って「<RefreshCw size={13} /> 再読み込み」。一覧に表示されたら選んで完了！</li>
        </ol>
        <pre className="site-docs-code">{FOLDER_TREE}</pre>

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

        <h2>2D MOD(スプライトシート)</h2>
        <p>
          1枚の画像にコマを並べて、コマ番号でアニメーションを定義します。
          コマ番号は<strong>左上から右へ0, 1, 2…</strong>と数えます。
        </p>
        <pre className="site-docs-code">{SPRITE_EXAMPLE}</pre>
        <ul>
          <li><code>frameWidth</code> / <code>frameHeight</code> — 1コマのピクセルサイズ</li>
          <li><code>columns</code> / <code>rows</code> — シートの列数・行数</li>
          <li><code>frames</code> — 再生するコマ番号の並び(同じ番号を繰り返してもOK)</li>
          <li><code>fps</code> は1〜60、1モーションのコマ数は240まで</li>
          <li><code>imageRendering: "pixelated"</code> にするとドット絵がくっきり表示されます</li>
          <li><strong>idleは必須</strong>。定義していないモーションは自動的にidleで代用されます</li>
        </ul>
        <h3>画像連番でも作れます</h3>
        <p>シートにまとめず、1コマ1ファイルの連番画像でもOK(全モーション合計480枚まで)。</p>
        <pre className="site-docs-code">{SEQUENCE_EXAMPLE}</pre>

        <h2>3D MOD(GLB)</h2>
        <p>
          Blenderなどで作ったモデルを、<strong>テクスチャ埋め込みの単一GLB</strong>(glTF Binary)で書き出します。
          <code>clip</code> にはBlenderのアクション名をそのまま書きます。
        </p>
        <pre className="site-docs-code">{GLB_EXAMPLE}</pre>
        <ul>
          <li><code>scale</code> / <code>groundOffset</code> / <code>rotationY</code> で大きさ・接地位置・向きを微調整</li>
          <li>モーションを省略して静止モデルだけでもOK(書く場合はidleが必須)</li>
          <li>外部テクスチャや外部.bin、glTF拡張は使えません。書き出し時に「埋め込み」を選んでください</li>
        </ul>

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

        <h2>サイズの上限</h2>
        <ul>
          <li>画像: 1ファイル16MBまで、最大4096×4096px</li>
          <li>GLB: 32MBまで</li>
          <li>サムネイル: 512KB・512pxまで</li>
          <li>1つのMODフォルダー合計: 48MBまで</li>
          <li>MODの数: 最大64個</li>
        </ul>

        <h2>配布する・もらう</h2>
        <p>
          フォルダーごとzipにして共有するだけ。もらった人はMODフォルダーに展開して「再読み込み」すれば使えます。
          MODは画像とJSONだけで構成され、コードは実行されないので、安心して配布できます。
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
        <a href="https://github.com/firemio/miomail">GitHub</a>
      </footer>
    </div>
  )
}
