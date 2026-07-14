import { useEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  Bot,
  Check,
  Download,
  Heart,
  Menu,
  MessageCircleHeart,
  Palette,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import { CourierMascot } from '../../src/renderer/components/layout/CourierMascot'
import { CourierMascot3D } from '../../src/renderer/components/layout/CourierMascot3D'
import { MASCOT_IDLE_MOTION_DURATIONS } from '../../src/renderer/data/mascotIdleMotions'
import logoImage from '../../src/renderer/assets/miomail-logo.png'

const RELEASE_PAGE_URL = 'https://github.com/firemio/miomail/releases/latest'
// 常に最新リリースの固定名アセットを指すGitHubのエイリアスURL。
// リリース時は必ず MioMail-x64-setup.exe (固定名コピー) をアセットに含めること。
const DOWNLOAD_URL = 'https://github.com/firemio/miomail/releases/latest/download/MioMail-x64-setup.exe'

const features = [
  {
    icon: MessageCircleHeart,
    number: '01',
    title: '相棒がそばにいる',
    body: '新着も送信も、かわいい相棒が一緒。使うほど成長して、毎日のメールに小さな物語が生まれます。',
    color: 'pink',
  },
  {
    icon: Send,
    number: '02',
    title: '迷わず、すぐ送れる',
    body: '大事な操作だけを、心地よい場所に。複数アカウントも下書きも、すっきり整理できます。',
    color: 'blue',
  },
  {
    icon: Palette,
    number: '03',
    title: '気分に合わせて着替える',
    body: '色も相棒も、あなた好みに。やさしいテーマから個性的なキャラクターMODまで楽しめます。',
    color: 'yellow',
  },
]

// アプリのCompanionOverlayと同じアイドルポーズ切り替え。
// サイトはショーケースなのでアプリ(6-10秒間隔・45%)より高頻度に振る。
function useIdlePose() {
  const [pose, setPose] = useState(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let checkTimer: number
    let returnTimer: number | null = null
    let poseActive = false
    const posePool = [1, 1, 2, 3, 4, 5, 6, 7, 7]

    const scheduleCheck = (delayMs: number) => {
      checkTimer = window.setTimeout(() => {
        if (!poseActive && Math.random() < 0.7) {
          const nextPose = posePool[Math.floor(Math.random() * posePool.length)]
          poseActive = true
          setPose(nextPose)
          returnTimer = window.setTimeout(() => {
            setPose(0)
            poseActive = false
            returnTimer = null
          }, MASCOT_IDLE_MOTION_DURATIONS[nextPose])
        }
        scheduleCheck(3500 + Math.random() * 3500)
      }, delayMs)
    }
    // 最初のポーズは早めに見せる
    scheduleCheck(1800 + Math.random() * 1500)

    return () => {
      window.clearTimeout(checkTimer)
      if (returnTimer !== null) window.clearTimeout(returnTimer)
    }
  }, [])

  return pose
}

function SiteMio({ bond, size }: { bond: number; size: number }) {
  const pose = useIdlePose()

  return (
    <div>
      <div
        className={`companion-pose companion-pose-mio companion-pose-${pose}`}
        style={{ position: 'relative' }}
      >
        <CourierMascot mascotId="mio" bond={bond} size={size} spinOnClick />
      </div>
    </div>
  )
}

function SitePosty3D({ bond, size }: { bond: number; size: number }) {
  const pose = useIdlePose()
  const [spinSignal, setSpinSignal] = useState(0)

  return (
    <div>
      <div
        style={{ position: 'relative', cursor: 'pointer' }}
        onClick={() => setSpinSignal((signal) => signal + 1)}
        title="クリックでくるっと回る"
      >
        <CourierMascot3D mascotId="posty" bond={bond} size={size} pose={pose} spinSignal={spinSignal} />
      </div>
    </div>
  )
}

function EnvelopeMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`site-envelope-mark ${small ? 'site-envelope-mark--small' : ''}`} aria-hidden="true">
      <span className="site-envelope-mark__flap" />
      <Heart className="site-envelope-mark__heart" fill="currentColor" />
    </span>
  )
}

export function MioMailSite() {
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const reveal = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add('is-visible')),
      { threshold: 0.14 }
    )
    document.querySelectorAll<HTMLElement>('[data-reveal]').forEach((element) => reveal.observe(element))
    return () => reveal.disconnect()
  }, [])

  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="site-brand" href="#top" aria-label="MioMail ホーム">
          <img className="site-brand__logo" src={logoImage} alt="MioMail" draggable={false} />
        </a>

        <nav className={`site-nav ${menuOpen ? 'is-open' : ''}`} aria-label="メインナビゲーション">
          <a href="#features" onClick={() => setMenuOpen(false)}>できること</a>
          <a href="#companion" onClick={() => setMenuOpen(false)}>相棒について</a>
          <a href="#security" onClick={() => setMenuOpen(false)}>安心設計</a>
          <a className="site-nav__download" href={DOWNLOAD_URL}>
            ダウンロード <ArrowRight size={14} />
          </a>
        </nav>

        <button
          className="site-menu-button"
          type="button"
          aria-label={menuOpen ? 'メニューを閉じる' : 'メニューを開く'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((current) => !current)}
        >
          {menuOpen ? <X /> : <Menu />}
        </button>
      </header>

      <main>
        <section className="site-hero" id="top">
          <div className="site-hero__texture" aria-hidden="true" />
          <div className="site-hero__copy">
            <div className="site-eyebrow site-intro-1">
              <Sparkles size={15} /> Windowsのための、やさしいメールアプリ
            </div>
            <h1 className="site-intro-2">
              メールに、<br />
              <span>かわいい相棒</span><br />
              を。
            </h1>
            <p className="site-hero__lead site-intro-3">
              MioMailは、毎日の「届いた」と「送れた」を
              <br />小さなよろこびに変えるメールアプリです。
            </p>
            <div className="site-hero__actions site-intro-4">
              <a className="site-button site-button--primary" href={DOWNLOAD_URL}>
                <Download size={18} /> Windows版をダウンロード
              </a>
              <a className="site-text-link" href="#features">
                もっと見る <ArrowDown size={16} />
              </a>
            </div>
            <p className="site-hero__note site-intro-4">無料・広告なし ／ Windows 10・11対応</p>
          </div>

          <div className="site-hero__visual site-intro-character" aria-label="MioMailの相棒、白い子猫のミオ">
            <div className="site-stamp site-stamp--one">NEW MAIL!</div>
            <div className="site-stamp site-stamp--two">FOR YOU ♡</div>
            <div className="site-spark site-spark--one">✦</div>
            <div className="site-spark site-spark--two">✦</div>
            <div className="site-character-halo" />
            <div className="site-character-wrap">
              <SiteMio bond={88} size={420} />
            </div>
            <div className="site-speech">
              <span>おかえりなさい！</span>
              今日のメールも、いっしょに整えよう。
            </div>
          </div>

          <div className="site-hero__ticker" aria-hidden="true">
            <span>MAIL WITH A LITTLE MAGIC</span>
            <Heart size={13} fill="currentColor" />
            <span>YOUR FRIENDLY INBOX</span>
            <Heart size={13} fill="currentColor" />
            <span>MAIL WITH A LITTLE MAGIC</span>
          </div>
        </section>

        <section className="site-features" id="features">
          <div className="site-section-heading" data-reveal>
            <p>WHY MIOMAIL?</p>
            <h2>開くたび、ちょっと好きになる。</h2>
            <span>メールは道具。でも、毎日使うなら心地よいほうがいい。</span>
          </div>

          <div className="site-feature-grid">
            {features.map(({ icon: Icon, number, title, body, color }) => (
              <article className={`site-feature-card site-feature-card--${color}`} key={number} data-reveal>
                <span className="site-feature-card__number">{number}</span>
                <span className="site-feature-card__icon"><Icon /></span>
                <h3>{title}</h3>
                <p>{body}</p>
                <span className="site-feature-card__scribble" aria-hidden="true">〜〜〜</span>
              </article>
            ))}

            <article className="site-feature-card site-feature-card--violet site-feature-card--wide" data-reveal>
              <span className="site-feature-card__number">04</span>
              <span className="site-feature-card__icon"><Bot /></span>
              <div className="site-feature-card__wide-body">
                <h3>AIエージェントとつながる</h3>
                <p>
                  MCPサーバーを同梱。ClaudeなどのAIエージェントが受信箱の確認・検索から送信までを代行できます。
                  「今日の未読をまとめて」「この返事を送っておいて」——そんな頼み方が、もう現実です。
                </p>
                <div className="site-mcp-tools" aria-label="MCPで使える操作の例">
                  <span>list_messages</span>
                  <span>search_messages</span>
                  <span>send_mail</span>
                  <span>mark_read</span>
                  <span>sync</span>
                </div>
              </div>
              <span className="site-feature-card__scribble" aria-hidden="true">〜〜〜</span>
            </article>
          </div>
        </section>

        <section className="site-companion" id="companion">
          <div className="site-companion__art" data-reveal>
            <span className="site-companion__label">MEET POSTY</span>
            <div className="site-companion__circle">
              <SitePosty3D bond={45} size={330} />
            </div>
            <span className="site-companion__orbit site-companion__orbit--one">ピピッ！</span>
            <span className="site-companion__orbit site-companion__orbit--two">メール トドケマス</span>
            <span className="site-companion__orbit site-companion__orbit--three">いってらっしゃい ♡</span>
          </div>

          <div className="site-companion__copy" data-reveal>
            <div className="site-kicker"><Heart size={15} fill="currentColor" /> YOUR MAIL COMPANION</div>
            <h2>ただのマスコット、<br /><em>じゃありません。</em></h2>
            <p>
              ポスティはちょっとレトロなブリキのロボット。新着を知らせたり、送信を応援したり。
              毎日の積み重ねで少しずつ成長していく、はたらきものの配達係です。
              相棒はミオのほかにも個性いろいろ、3D表示にも対応しています。
            </p>
            <ul>
              <li><Check /> メールを使うほど絆が深まる</li>
              <li><Check /> 気分や状態で表情が変わる</li>
              <li><Check /> 好きな相棒へいつでも交代</li>
            </ul>
            <div className="site-signature">Posty <span>♡</span></div>
          </div>
        </section>

        <section className="site-security" id="security">
          <div className="site-security__copy" data-reveal>
            <div className="site-kicker site-kicker--blue"><ShieldCheck size={16} /> PRIVATE BY DESIGN</div>
            <h2>大切なメールは、<br />あなたの手元に。</h2>
            <p>
              メールの内容と設定はローカル中心で管理。パスワードはWindows資格情報マネージャーに安全に保存します。
            </p>
          </div>
          <div className="site-security__card" data-reveal>
            <div className="site-security__shield"><ShieldCheck /></div>
            <div>
              <strong>LOCAL FIRST</strong>
              <span>広告トラッキングなし</span>
            </div>
            <div>
              <strong>OPEN & HONEST</strong>
              <span>透明性のあるオープンソース</span>
            </div>
            <div>
              <strong>YOUR ACCOUNT</strong>
              <span>標準のIMAP / SMTPに対応</span>
            </div>
          </div>
        </section>

        <section className="site-cta" data-reveal>
          <div className="site-cta__mail" aria-hidden="true"><EnvelopeMark /></div>
          <p>READY TO SAY HELLO?</p>
          <h2>今日から、受信箱に<br /><span>小さな相棒</span>を。</h2>
          <a className="site-button site-button--dark" href={DOWNLOAD_URL}>
            MioMailをはじめる <ArrowRight size={18} />
          </a>
          <span className="site-cta__aside">See you in your inbox!</span>
        </section>
      </main>

      <footer className="site-footer">
        <a className="site-brand site-brand--footer" href="#top">
          <img className="site-brand__logo site-brand__logo--footer" src={logoImage} alt="MioMail" draggable={false} />
        </a>
        <p>メールを、もっとやさしく。もっとあなたらしく。</p>
        <div>
          <a href="https://github.com/firemio/miomail">GitHub</a>
          <a href={RELEASE_PAGE_URL}>Releases</a>
          <span>© 2026 MioMail</span>
        </div>
      </footer>
    </div>
  )
}
