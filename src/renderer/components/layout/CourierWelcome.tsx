import { MailPlus, Settings2 } from 'lucide-react'
import { useMailStore } from '../../stores/mailStore'
import { useMascotStore } from '../../stores/mascotStore'
import { useUIStore } from '../../stores/uiStore'

export function CourierWelcome() {
  const { accounts, allFolders, currentFolder } = useMailStore()
  const { openCompose, openSettings } = useUIStore()
  const { gainBond, streakDays } = useMascotStore()
  const senderAccount = currentFolder
    ? accounts.find((account) => account.id === currentFolder.account_id)
    : accounts[0]

  const folderGroups = Array.from(allFolders.values())
  const folderCount = folderGroups.reduce((sum, folders) => sum + folders.length, 0)
  const unreadCount = folderGroups.reduce(
    (sum, folders) =>
      sum + folders.reduce((folderSum, folder) => folderSum + (folder.unread_count || 0), 0),
    0
  )

  const handleCompose = () => {
    openCompose({ mode: 'new', fromAddress: senderAccount?.email })
    gainBond(1)
  }

  return (
    <div className="relative flex min-w-0 flex-1 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,181,198,0.22),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(255,234,179,0.25),transparent_24%)]" />

      <div className="relative flex h-full min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        <section className="glass-panel rounded-[30px] p-4">
          <div className="rounded-[28px] border border-white/80 bg-white/76 p-4">
            <p className="text-[11px] font-semibold tracking-[0.2em] text-sumi-text-muted">
              まずは普通に使えることを最優先
            </p>
            <h1 className="mt-2 max-w-[760px] font-display text-[30px] leading-[1.2] text-sumi-text">
              読みながら返す。複数下書きも迷わない。
              <br />
              新着も送信も、通信なしで確認できる。
            </h1>

            <p className="mt-3 max-w-[760px] text-[13px] leading-6 text-sumi-text-muted">
              相棒は画面の好きな場所で待機し、ドラッグで自由に移動できます。
              クリックすると成長やコンディションを確認できます。
            </p>

            <div className="mt-4 flex flex-wrap gap-2.5">
              <button
                onClick={handleCompose}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-sumi-accent px-4.5 text-sm font-semibold text-white shadow-[0_18px_35px_rgba(255,138,160,0.34)] transition hover:-translate-y-0.5 hover:bg-sumi-accent-strong"
              >
                <MailPlus size={16} />
                新しいおたよりを書く
              </button>
              <button
                onClick={openSettings}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-transparent bg-sumi-surface px-4.5 text-sm font-semibold text-sumi-text transition hover:-translate-y-0.5 hover:bg-sumi-surface-2"
              >
                <Settings2 size={16} />
                設定を開く
              </button>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-3">
              {[
                '歯車の「データとテスト」でデモ受信',
                '本文を開いたまま返信・転送を開始',
                '相棒とテーマの変更は設定へ集約',
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-[20px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.94)_0%,rgba(255,246,241,0.94)_100%)] px-3 py-2.5 text-[10px] leading-5 text-sumi-text-muted"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="glass-panel rounded-[24px] p-4">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-sumi-text-muted">
              ACTIVE ACCOUNTS
            </p>
            <div className="mt-3 flex items-end justify-between">
              <span className="font-display text-4xl text-sumi-text">{accounts.length}</span>
              <span className="rounded-full bg-white/75 px-3 py-1 text-[11px] text-sumi-text-muted">
                アカウント
              </span>
            </div>
          </div>
          <div className="glass-panel rounded-[24px] p-4">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-sumi-text-muted">
              DELIVERY ROUTES
            </p>
            <div className="mt-3 flex items-end justify-between">
              <span className="font-display text-4xl text-sumi-text">{folderCount}</span>
              <span className="rounded-full bg-white/75 px-3 py-1 text-[11px] text-sumi-text-muted">
                フォルダ
              </span>
            </div>
          </div>
          <div className="glass-panel rounded-[24px] p-4">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-sumi-text-muted">
              UNREAD ON ROUTE
            </p>
            <div className="mt-3 flex items-end justify-between">
              <span className="font-display text-4xl text-sumi-text">{unreadCount}</span>
              <span className="rounded-full bg-white/75 px-3 py-1 text-[11px] text-sumi-text-muted">
                未読
              </span>
            </div>
          </div>
          <div className="glass-panel rounded-[24px] p-4">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-sumi-text-muted">
              CARE STREAK
            </p>
            <div className="mt-3 flex items-end justify-between">
              <span className="font-display text-4xl text-sumi-text">{streakDays}</span>
              <span className="rounded-full bg-white/75 px-3 py-1 text-[11px] text-sumi-text-muted">
                日連続
              </span>
            </div>
            <p className="mt-2 text-[10px] leading-5 text-sumi-text-muted">
              1日1回の行動で継続ボーナス。
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
