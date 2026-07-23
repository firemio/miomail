import { useEffect, useState } from 'react'
import { Box, Code2, Cpu, Database, Download, FolderOpen, Image as ImageIcon, Mail, Palette, Puzzle, RefreshCw, Settings2, ShieldCheck, Sparkles, Star, TriangleAlert, X } from 'lucide-react'
import { mascotCatalog, type MascotId } from '../../data/mascots'
import { MASCOT_IDLE_MOTION_DURATIONS, MASCOT_IDLE_MOTION_LABELS } from '../../data/mascotIdleMotions'
import { themeCatalog } from '../../data/themes'
import { api, isTauriRuntime } from '../../lib/ipc'
import { getMascotPhaseLabel, MASCOT_GROWTH_STAGES, type MascotPhase, useMascotStore } from '../../stores/mascotStore'
import { useUIStore } from '../../stores/uiStore'
import { useCharacterStore } from '../../stores/characterStore'
import { MascotRenderer } from '../characters/MascotRenderer'
import { ModThumbnail } from '../characters/ModThumbnail'
import { AccountManager } from '../account/AccountManager'
import { SystemSection } from './SystemSection'
import { ThemePreview } from './ThemePreview'

type SettingsSection = 'appearance' | 'mail' | 'data' | 'system' | 'developer'

const sections = [
  { id: 'appearance' as const, label: '見た目と相棒', icon: Palette, note: 'テーマ・マスコット' },
  { id: 'mail' as const, label: 'メール設定', icon: Mail, note: 'アカウント・接続' },
  { id: 'data' as const, label: 'データ管理', icon: Database, note: 'インポート・エクスポート' },
  { id: 'system' as const, label: 'システム', icon: Cpu, note: '動作環境・アクセラレータ' },
  { id: 'developer' as const, label: '開発者メニュー', icon: Code2, note: '成長一覧・動作デモ' },
]

const growthPreviews = MASCOT_GROWTH_STAGES.map(({ phase, minBond }) => ({ phase, bond: minBond }))
const idlePreviewBond = MASCOT_GROWTH_STAGES.find(({ phase }) => phase === 'courier')?.minBond ?? 20

export function SettingsModal() {
  const [section, setSection] = useState<SettingsSection>('appearance')
  const [demoBusy, setDemoBusy] = useState<'receive' | 'send' | null>(null)
  const [debugMascotId, setDebugMascotId] = useState<MascotId>('makko')
  const [debugStartPhase, setDebugStartPhase] = useState<MascotPhase>('egg')
  const [debugPoseIndex, setDebugPoseIndex] = useState(0)
  const [idleAutoPlay, setIdleAutoPlay] = useState(false)
  const [updateState, setUpdateState] = useState<
    | { phase: 'idle' }
    | { phase: 'checking' }
    | { phase: 'latest'; version: string }
    | { phase: 'available'; version: string }
    | { phase: 'installing' }
    | { phase: 'error'; message: string }
  >({ phase: 'idle' })
  const { closeSettings, openImport, themeId, setTheme } = useUIStore()
  const { selectedMascotId, selectMascot, bondByMascot, careByMascot, debugSetPhase, debugEvolveFrom } = useMascotStore()
  const {
    builtinRenderer,
    selectedModId,
    packages: characterPackages,
    issues: characterModIssues,
    loading: characterModsLoading,
    error: characterModsError,
    selectBuiltinRenderer,
    selectMod,
    refreshMods,
    openModsFolder,
  } = useCharacterStore()
  const debugStartIndex = MASCOT_GROWTH_STAGES.findIndex(({ phase }) => phase === debugStartPhase)
  const debugNextStage = MASCOT_GROWTH_STAGES[debugStartIndex + 1]

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSettings()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeSettings])

  useEffect(() => {
    setDebugPoseIndex(0)
    setIdleAutoPlay(false)
  }, [debugMascotId])

  useEffect(() => {
    if (section !== 'developer' || !idleAutoPlay) return
    const timer = window.setTimeout(() => {
      setDebugPoseIndex((current) => (current + 1) % MASCOT_IDLE_MOTION_DURATIONS.length)
    }, MASCOT_IDLE_MOTION_DURATIONS[debugPoseIndex])
    return () => window.clearTimeout(timer)
  }, [debugPoseIndex, idleAutoPlay, section])

  const openImporter = () => {
    closeSettings()
    openImport()
  }

  const checkForUpdates = async () => {
    setUpdateState({ phase: 'checking' })
    try {
      const status = await api.app.updateCheck()
      if (status.available && status.latest_version) {
        setUpdateState({ phase: 'available', version: status.latest_version })
      } else {
        setUpdateState({ phase: 'latest', version: status.current_version })
      }
    } catch (error) {
      setUpdateState({
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const installUpdate = async () => {
    setUpdateState({ phase: 'installing' })
    try {
      await api.app.updateInstall()
    } catch (error) {
      setUpdateState({
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const exportData = () => {
    const entries = Object.fromEntries(
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith('miomail-'))
        .map((key) => [key, window.localStorage.getItem(key)])
    )
    const payload = JSON.stringify({
      format: 'miomail-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      entries,
    }, null, 2)
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `miomail-export-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const runDemo = async (type: 'receive' | 'send') => {
    setDemoBusy(type)
    try {
      closeSettings()
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      if (type === 'receive') await api.mail.demoReceive()
      else await api.mail.demoSend()
    } finally {
      setDemoBusy(null)
    }
  }

  const applyDebugStartPhase = () => {
    selectMascot(debugMascotId)
    debugSetPhase(debugStartPhase)
  }

  const runGrowthDemo = () => {
    selectMascot(debugMascotId)
    window.requestAnimationFrame(() => {
      debugEvolveFrom(debugStartPhase)
      closeSettings()
    })
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[rgba(34,24,24,0.34)] p-6 backdrop-blur-md" onMouseDown={closeSettings}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        data-testid="settings-modal"
        className="glass-panel flex h-[min(760px,88vh)] w-[min(1120px,92vw)] overflow-hidden rounded-[36px] border border-white/80 bg-white/92 shadow-[0_36px_100px_rgba(83,56,56,0.28)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <nav className="flex w-[260px] shrink-0 flex-col border-r border-sumi-border/70 bg-sumi-surface/55 p-5">
          <div className="px-2 pb-6 pt-2">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sumi-accent text-white shadow-[0_12px_28px_rgba(255,138,160,0.28)]">
              <Settings2 size={20} />
            </div>
            <p className="mt-5 text-[10px] font-semibold tracking-[0.22em] text-sumi-text-muted">MIO CONTROL ROOM</p>
            <h1 id="settings-title" className="mt-1 font-display text-3xl text-sumi-text">設定</h1>
          </div>

          <div className="space-y-2">
            {sections.map((item) => {
              const Icon = item.icon
              const active = section === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => setSection(item.id)}
                  className={`flex w-full items-center gap-3 rounded-[20px] px-4 py-3 text-left transition ${active ? 'bg-sumi-accent text-white shadow-[0_14px_28px_rgba(255,138,160,0.2)]' : 'text-sumi-text-muted hover:bg-white/70 hover:text-sumi-text'}`}
                >
                  <Icon size={17} />
                  <span>
                    <span className="block text-sm font-semibold">{item.label}</span>
                    <span className={`mt-0.5 block text-[10px] ${active ? 'text-white/75' : 'text-sumi-text-muted'}`}>{item.note}</span>
                  </span>
                </button>
              )
            })}
          </div>

          <p className="mt-auto px-2 text-[10px] leading-5 text-sumi-text-muted">変更内容は選択と同時に保存されます。</p>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[78px] shrink-0 items-center justify-between border-b border-sumi-border/70 px-7">
            <div>
              <p className="text-[10px] font-semibold tracking-[0.2em] text-sumi-text-muted">SETTINGS</p>
              <h2 className="mt-1 font-display text-2xl text-sumi-text">{sections.find((item) => item.id === section)?.label}</h2>
            </div>
            <button onClick={closeSettings} aria-label="設定を閉じる" className="flex h-11 w-11 items-center justify-center rounded-full border border-white/80 bg-white/80 text-sumi-text-muted transition hover:text-sumi-text">
              <X size={17} />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-7">
            {section === 'appearance' && (
              <div className="space-y-8">
                <section>
                  <div className="mb-4 flex items-end justify-between">
                    <div><p className="text-[10px] font-semibold tracking-[0.18em] text-sumi-text-muted">COMPANION</p><h3 className="mt-1 text-lg font-semibold text-sumi-text">相棒を選ぶ</h3></div>
                    <p className="text-xs text-sumi-text-muted">選んだ1体が画面内を自由に移動します。</p>
                  </div>
                  <div className="grid grid-cols-4 gap-3">
                    {mascotCatalog.map((mascot) => {
                      const active = mascot.id === selectedMascotId
                      return <button key={mascot.id} onClick={() => { selectMascot(mascot.id); if (selectedModId) selectBuiltinRenderer(builtinRenderer) }} className={`rounded-[24px] border p-4 text-left transition hover:-translate-y-0.5 ${active && !selectedModId ? 'border-sumi-accent bg-sumi-accent/10 shadow-[0_16px_34px_rgba(255,138,160,0.16)]' : 'border-white/80 bg-white/72'}`}>
                        <div className="flex items-start justify-between"><MascotRenderer mascotId={mascot.id} bond={bondByMascot[mascot.id] ?? 0} care={careByMascot[mascot.id]} size={72} pose={0} /><span className="rounded-full bg-sumi-surface px-2 py-1 text-[10px] text-sumi-text-muted">{bondByMascot[mascot.id] ?? 0}pt</span></div>
                        <div className="mt-3 flex items-center justify-between"><span className="font-semibold text-sumi-text">{mascot.name}</span>{active && <span className="rounded-full bg-sumi-accent px-2 py-1 text-[10px] font-semibold text-white">選択中</span>}</div>
                        <p className="mt-1 text-[11px] leading-5 text-sumi-text-muted">{mascot.subtitle}</p>
                      </button>
                    })}
                  </div>
                </section>

                <section>
                  <div className="mb-4 flex items-end justify-between gap-4">
                    <div><p className="text-[10px] font-semibold tracking-[0.18em] text-sumi-text-muted">RENDERER</p><h3 className="mt-1 text-lg font-semibold text-sumi-text">描画スタイル</h3></div>
                    <p className="text-xs text-sumi-text-muted">旧版の動く2Dと、ふわふわ3Dをいつでも切り替えられます。</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      { id: 'classic-2d' as const, label: 'クラシック2D', note: '以前のDOMイラスト版。8種類の待機モーションも再利用します。', icon: ImageIcon },
                      { id: 'soft-3d' as const, label: 'ふわふわ3D', note: '立体・モーフ・光と影を使う現在のWebGL版です。', icon: Box },
                    ]).map((renderer) => {
                      const active = !selectedModId && builtinRenderer === renderer.id
                      const Icon = renderer.icon
                      return (
                        <button key={renderer.id} type="button" aria-pressed={active} onClick={() => selectBuiltinRenderer(renderer.id)} className={`group grid grid-cols-[96px_1fr] items-center gap-4 rounded-[24px] border p-4 text-left transition hover:-translate-y-0.5 ${active ? 'border-sumi-accent bg-sumi-accent/10 shadow-[0_16px_34px_rgba(255,138,160,0.14)]' : 'border-white/80 bg-white/72'}`}>
                          <div className="flex h-[96px] items-center justify-center overflow-hidden rounded-[20px] bg-sumi-surface/65">
                            <MascotRenderer mascotId={selectedMascotId} bond={Math.max(20, bondByMascot[selectedMascotId] ?? 0)} care={careByMascot[selectedMascotId]} size={88} pose={0} forceBuiltinRenderer={renderer.id} />
                          </div>
                          <span>
                            <span className="flex items-center gap-2 text-sm font-semibold text-sumi-text"><Icon size={15} className="text-sumi-accent" />{renderer.label}{active && <span className="rounded-full bg-sumi-accent px-2 py-1 text-[9px] text-white">使用中</span>}</span>
                            <span className="mt-2 block text-[11px] leading-5 text-sumi-text-muted">{renderer.note}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </section>

                <section className="rounded-[28px] border border-white/80 bg-white/58 p-5">
                  <div className="flex items-start justify-between gap-5">
                    <div>
                      <div className="flex items-center gap-2"><Puzzle size={16} className="text-sumi-accent" /><p className="text-[10px] font-semibold tracking-[0.18em] text-sumi-text-muted">CHARACTER MODS</p></div>
                      <h3 className="mt-2 text-lg font-semibold text-sumi-text">第三者キャラクター</h3>
                      <p className="mt-1 text-xs leading-5 text-sumi-text-muted">2Dはスプライトシート／画像連番、3DはBlenderから書き出したGLBを読み込みます。MOD内のコードは実行しません。</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" disabled={!isTauriRuntime} onClick={() => void openModsFolder()} className="inline-flex h-10 items-center gap-2 rounded-2xl border border-white/90 bg-white/82 px-3 text-[11px] font-semibold text-sumi-text-muted transition hover:text-sumi-text disabled:cursor-not-allowed disabled:opacity-45"><FolderOpen size={14} />MODフォルダー</button>
                      <button type="button" disabled={characterModsLoading} onClick={() => void refreshMods()} className="inline-flex h-10 items-center gap-2 rounded-2xl border border-white/90 bg-white/82 px-3 text-[11px] font-semibold text-sumi-text-muted transition hover:text-sumi-text disabled:opacity-45"><RefreshCw size={14} className={characterModsLoading ? 'animate-spin' : ''} />再読み込み</button>
                    </div>
                  </div>

                  {!isTauriRuntime && <div className="mt-4 rounded-[18px] border border-white/85 bg-sumi-surface/65 px-4 py-3 text-[11px] leading-5 text-sumi-text-muted">ブラウザープレビューでは組み込み2D/3Dだけを表示します。ローカルMODの検出はデスクトップ版で有効になります。</div>}

                  {selectedModId && !characterPackages.some((item) => item.manifest.id === selectedModId) && !characterModsLoading && (
                    <div className="mt-4 flex items-start gap-3 rounded-[18px] border border-[#e7b674]/45 bg-[#fff2dc]/70 px-4 py-3 text-[11px] leading-5 text-[#98632d]"><TriangleAlert size={15} className="mt-0.5 shrink-0" /><span>選択中だったMODが見つからないか、検証に通りませんでした。現在は組み込みキャラクターへ安全にフォールバックしています。</span></div>
                  )}

                  {characterPackages.length > 0 ? (
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      {characterPackages.map((characterPackage) => {
                        const { manifest } = characterPackage
                        const active = selectedModId === manifest.id
                        return (
                          <button key={`${manifest.id}:${characterPackage.revision}`} type="button" aria-pressed={active} onClick={() => { selectMascot(manifest.behaviorProfile); selectMod(manifest.id) }} className={`grid grid-cols-[74px_1fr] gap-3 rounded-[22px] border p-3 text-left transition hover:-translate-y-0.5 ${active ? 'border-sumi-accent bg-sumi-accent/10 shadow-[0_14px_30px_rgba(255,138,160,0.12)]' : 'border-white/85 bg-white/72'}`}>
                            <span className="flex h-[74px] w-[74px] overflow-hidden rounded-[18px] bg-sumi-surface/70"><ModThumbnail characterPackage={characterPackage} /></span>
                            <span className="min-w-0">
                              <span className="flex items-start justify-between gap-2"><span className="truncate text-sm font-semibold text-sumi-text">{manifest.name}</span><span className="shrink-0 rounded-full bg-sumi-surface px-2 py-1 text-[9px] font-semibold text-sumi-text-muted">{manifest.renderer === 'gltf-3d' ? '3D · GLB' : '2D · SPRITE'}</span></span>
                              <span className="mt-1 block text-[10px] text-sumi-text-muted">{manifest.author} · v{manifest.version}</span>
                              <span className="mt-2 line-clamp-2 block text-[10px] leading-4 text-sumi-text-muted">{manifest.description || '説明なし'}</span>
                              {active && <span className="mt-2 inline-flex rounded-full bg-sumi-accent px-2 py-1 text-[9px] font-semibold text-white">使用中</span>}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="mt-4 flex min-h-[110px] items-center justify-center rounded-[22px] border border-dashed border-sumi-border/80 bg-sumi-surface/40 px-5 text-center">
                      <div><ShieldCheck size={20} className="mx-auto text-sumi-accent" /><p className="mt-2 text-xs font-semibold text-sumi-text">検証済みMODはまだありません</p><p className="mt-1 text-[10px] leading-5 text-sumi-text-muted">1キャラクターにつき1フォルダーを作り、character.jsonと画像またはGLBを配置します。</p></div>
                    </div>
                  )}

                  {(characterModsError || characterModIssues.length > 0) && (
                    <div className="mt-4 rounded-[18px] border border-[#efb1a7]/55 bg-[#fff0ed]/75 px-4 py-3">
                      <p className="flex items-center gap-2 text-[11px] font-semibold text-[#a9554a]"><TriangleAlert size={14} />読み込めなかったMOD</p>
                      {characterModsError && <p className="mt-2 text-[10px] leading-5 text-[#a9554a]">{characterModsError}</p>}
                      {characterModIssues.map((issue) => <p key={`${issue.folder}:${issue.message}`} className="mt-1 text-[10px] leading-5 text-[#a9554a]"><span className="font-semibold">{issue.folder}</span> — {issue.message}</p>)}
                    </div>
                  )}
                </section>

                <section>
                  <div className="mb-4 flex items-end justify-between gap-4">
                    <div><p className="text-[10px] font-semibold tracking-[0.18em] text-sumi-text-muted">THEME</p><h3 className="mt-1 text-lg font-semibold text-sumi-text">テーマを選ぶ</h3></div>
                    <p className="text-xs text-sumi-text-muted">各テーマの実際の配色をプレビューで確認できます。</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                    {themeCatalog.map((theme) => {
                      const active = theme.id === themeId
                      const p = theme.palette
                      return (
                        <button
                          key={theme.id}
                          onClick={() => setTheme(theme.id)}
                          aria-pressed={active}
                          className={`overflow-hidden rounded-[22px] border p-3 text-left transition hover:-translate-y-0.5 ${
                            active
                              ? 'border-sumi-accent bg-sumi-accent/10 shadow-[0_16px_34px_rgba(255,138,160,0.16)]'
                              : 'border-white/80 bg-white/72'
                          }`}
                        >
                          <ThemePreview palette={p} />
                          <div className="mt-3 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="flex items-center gap-1.5 truncate font-semibold text-sumi-text">
                                {theme.name}
                                {theme.dark && (
                                  <span className="rounded-full bg-sumi-surface px-1.5 py-0.5 text-[8px] font-semibold text-sumi-text-muted">
                                    DARK
                                  </span>
                                )}
                                {active && (
                                  <span className="rounded-full bg-sumi-accent px-1.5 py-0.5 text-[8px] font-semibold text-white">
                                    使用中
                                  </span>
                                )}
                              </p>
                              <p className="mt-0.5 truncate text-[11px] text-sumi-text-muted">{theme.mood}</p>
                            </div>
                            <div className="flex shrink-0 gap-1">
                              {[p.bg, p.surface, p.accent, p.accentStrong, p.unread, p.text].map((color, index) => (
                                <span
                                  key={index}
                                  className="h-4 w-4 rounded-full border border-black/5"
                                  style={{ background: color }}
                                />
                              ))}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </section>
              </div>
            )}

            {section === 'mail' && (
              <div className="h-full overflow-hidden rounded-[28px] border border-white/80 bg-white/60">
                <AccountManager />
              </div>
            )}

            {section === 'data' && <div className="grid grid-cols-2 gap-4">
              <div className="rounded-[28px] border border-white/80 bg-white/72 p-6"><Database size={24} className="text-sumi-accent" /><h3 className="mt-4 text-lg font-semibold text-sumi-text">メールを取り込む</h3><p className="mt-2 text-xs leading-6 text-sumi-text-muted">OutlookのデータをMioMailへ移します。</p><button onClick={openImporter} className="mt-5 rounded-full bg-sumi-accent px-5 py-2.5 text-xs font-semibold text-white">インポートを開く</button></div>
              <div className="rounded-[28px] border border-white/80 bg-white/72 p-6"><Download size={24} className="text-sumi-accent" /><h3 className="mt-4 text-lg font-semibold text-sumi-text">設定を書き出す</h3><p className="mt-2 text-xs leading-6 text-sumi-text-muted">テーマや相棒の成長状態などのアプリ設定をJSONファイルとして保存します（メール本文はサーバーとローカルDBに保存されており、ここには含まれません）。</p><button onClick={exportData} className="mt-5 rounded-full bg-sumi-accent px-5 py-2.5 text-xs font-semibold text-white">JSONをエクスポート</button></div>
              <div className="rounded-[28px] border border-white/80 bg-white/72 p-6">
                <RefreshCw size={24} className="text-sumi-accent" />
                <h3 className="mt-4 text-lg font-semibold text-sumi-text">アップデート</h3>
                <p className="mt-2 text-xs leading-6 text-sumi-text-muted">
                  {updateState.phase === 'checking' && '更新を確認しています…'}
                  {updateState.phase === 'latest' && `お使いのバージョン（v${updateState.version}）は最新です。`}
                  {updateState.phase === 'available' && `新しいバージョン v${updateState.version} が利用できます。更新するとダウンロード後に自動で再起動します。`}
                  {updateState.phase === 'installing' && 'ダウンロード中… 完了すると自動で再起動します。'}
                  {updateState.phase === 'error' && `更新の確認に失敗しました: ${updateState.message}`}
                  {updateState.phase === 'idle' && '新しいバージョンが公開されているか確認します。起動時にも自動で確認されます。'}
                </p>
                {updateState.phase === 'available' ? (
                  <button onClick={installUpdate} className="mt-5 rounded-full bg-sumi-accent px-5 py-2.5 text-xs font-semibold text-white">今すぐ更新</button>
                ) : (
                  <button onClick={checkForUpdates} disabled={updateState.phase === 'checking' || updateState.phase === 'installing' || !isTauriRuntime} className="mt-5 rounded-full bg-sumi-accent px-5 py-2.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">更新を確認</button>
                )}
              </div>
            </div>}

            {section === 'system' && <SystemSection />}

            {section === 'developer' && <div className="space-y-7">
              <section className="rounded-[28px] border border-[#ffd8a8] bg-[linear-gradient(135deg,rgba(255,252,245,0.96),rgba(255,239,222,0.88))] p-5 shadow-[0_16px_36px_rgba(229,157,91,0.1)]">
                <div className="flex items-start justify-between gap-5"><div><p className="text-[10px] font-semibold tracking-[0.18em] text-[#bd7a38]">GROWTH DEBUGGER</p><h3 className="mt-1 text-lg font-semibold text-sumi-text">成長演出を再現</h3><p className="mt-1 text-xs text-sumi-text-muted">開始段階をセットし、次の姿への成長とクラッカーを確認します。</p></div><Star size={22} className="text-[#dc913f]" /></div>

                <div className="mt-5 grid grid-cols-[180px_1fr] gap-5">
                  <div>
                    <label className="text-[10px] font-semibold tracking-[0.12em] text-sumi-text-muted">対象キャラクター</label>
                    <select value={debugMascotId} onChange={(event) => setDebugMascotId(event.target.value as MascotId)} className="mt-2 h-11 w-full rounded-2xl border border-white/90 bg-white/85 px-3 text-xs font-semibold text-sumi-text outline-none focus:border-sumi-accent/40">
                      {mascotCatalog.map((mascot) => <option key={mascot.id} value={mascot.id}>{mascot.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold tracking-[0.12em] text-sumi-text-muted">開始段階</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {MASCOT_GROWTH_STAGES.map((stage, index) => <button key={stage.phase} onClick={() => setDebugStartPhase(stage.phase)} title={index === MASCOT_GROWTH_STAGES.length - 1 ? '最終段階' : `${getMascotPhaseLabel(MASCOT_GROWTH_STAGES[index + 1].phase)}へ成長`} className={`rounded-full px-3 py-2 text-[11px] font-semibold transition ${debugStartPhase === stage.phase ? 'bg-[#dc913f] text-white shadow-[0_8px_18px_rgba(220,145,63,0.22)]' : 'border border-white/90 bg-white/80 text-sumi-text-muted hover:text-sumi-text'}`}>{getMascotPhaseLabel(stage.phase)}</button>)}
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between gap-4 border-t border-white/75 pt-4">
                  <p className="text-[11px] text-sumi-text-muted">{debugNextStage ? `${getMascotPhaseLabel(debugStartPhase)} → ${getMascotPhaseLabel(debugNextStage.phase)}` : '最終段階のため、次の成長はありません。'}</p>
                  <div className="flex gap-2"><button onClick={applyDebugStartPhase} className="rounded-full border border-white bg-white/90 px-4 py-2.5 text-xs font-semibold text-sumi-text-muted transition hover:text-sumi-text">開始状態を適用</button><button disabled={!debugNextStage} onClick={runGrowthDemo} className="rounded-full bg-[#dc913f] px-4 py-2.5 text-xs font-semibold text-white shadow-[0_10px_22px_rgba(220,145,63,0.2)] transition hover:bg-[#ca8032] disabled:cursor-not-allowed disabled:opacity-40">成長演出を再生</button></div>
                </div>
              </section>

              <section className="rounded-[28px] border border-white/80 bg-white/65 p-5">
                <div className="flex items-start justify-between gap-5"><div><p className="text-[10px] font-semibold tracking-[0.18em] text-sumi-text-muted">ANIMATION LAB</p><h3 className="mt-1 text-lg font-semibold text-sumi-text">動作デモ</h3><p className="mt-1 text-xs text-sumi-text-muted">設定を閉じて、送受信と配達演出を再生します。</p></div><Sparkles size={22} className="text-sumi-accent" /></div>
                <div className="mt-4 flex gap-2"><button disabled={demoBusy !== null} onClick={() => void runDemo('receive')} className="rounded-full border border-sumi-border bg-white/80 px-4 py-2.5 text-xs font-semibold text-sumi-text disabled:opacity-50">{demoBusy === 'receive' ? '受信中…' : 'デモ受信'}</button><button disabled={demoBusy !== null} onClick={() => void runDemo('send')} className="rounded-full border border-sumi-border bg-white/80 px-4 py-2.5 text-xs font-semibold text-sumi-text disabled:opacity-50">{demoBusy === 'send' ? '送信中…' : 'デモ送信'}</button></div>
              </section>

              <section>
                <div className="mb-4 flex items-end justify-between gap-4">
                  <div><p className="text-[10px] font-semibold tracking-[0.18em] text-sumi-text-muted">IDLE MOTION CATALOG</p><h3 className="mt-1 text-lg font-semibold text-sumi-text">待機モーション一覧</h3><p className="mt-1 text-xs text-sumi-text-muted">配達デビュー期の3Dを大きく表示し、8種類を1つずつ確実に確認します。</p></div>
                  <div className="flex items-center gap-2">
                    <button type="button" aria-pressed={idleAutoPlay} onClick={() => setIdleAutoPlay((current) => !current)} className={`h-10 rounded-2xl px-4 text-[11px] font-semibold transition ${idleAutoPlay ? 'bg-sumi-accent text-white shadow-[0_8px_18px_rgba(255,111,145,0.2)]' : 'border border-white/90 bg-white/80 text-sumi-text-muted hover:text-sumi-text'}`}>{idleAutoPlay ? '連続再生を停止' : '全て順番に再生'}</button>
                    <select value={debugMascotId} onChange={(event) => setDebugMascotId(event.target.value as MascotId)} className="h-10 min-w-[150px] rounded-2xl border border-white/90 bg-white/85 px-3 text-xs font-semibold text-sumi-text outline-none focus:border-sumi-accent/40">
                      {mascotCatalog.map((mascot) => <option key={mascot.id} value={mascot.id}>{mascot.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-[minmax(250px,0.85fr)_minmax(0,1.15fr)] gap-4">
                  <div className="relative flex min-h-[300px] flex-col items-center justify-center overflow-hidden rounded-[28px] border border-white/85 bg-[radial-gradient(circle_at_50%_40%,rgba(255,255,255,0.98),rgba(255,241,244,0.76)_48%,rgba(255,255,255,0.62)_76%)] p-5 shadow-[0_18px_46px_rgba(121,85,96,0.08)]">
                    <div className="absolute left-4 top-4 rounded-full border border-white/90 bg-white/82 px-3 py-1.5 text-[9px] font-semibold tracking-[0.16em] text-sumi-text-muted">POSE {debugPoseIndex + 1} / 8</div>
                    <MascotRenderer mascotId={debugMascotId} bond={Math.max(bondByMascot[debugMascotId] ?? 0, idlePreviewBond)} care={careByMascot[debugMascotId]} size={190} pose={debugPoseIndex} forceBuiltinRenderer="soft-3d" />
                    <p className="mt-1 text-base font-semibold text-sumi-text">{MASCOT_IDLE_MOTION_LABELS[debugMascotId][debugPoseIndex]}</p>
                    <p className="mt-1 text-[10px] text-sumi-text-muted">{mascotCatalog.find((mascot) => mascot.id === debugMascotId)?.name}・3Dモーション</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    {MASCOT_IDLE_MOTION_LABELS[debugMascotId].map((label, poseIndex) => {
                      const active = debugPoseIndex === poseIndex
                      return (
                        <button key={`${debugMascotId}-idle-${poseIndex}`} type="button" aria-pressed={active} onClick={() => { setDebugPoseIndex(poseIndex); setIdleAutoPlay(false) }} className={`group flex min-h-[68px] items-center gap-3 rounded-[20px] border px-3.5 py-3 text-left transition ${active ? 'border-sumi-accent/45 bg-white shadow-[0_12px_26px_rgba(255,111,145,0.12)]' : 'border-white/80 bg-white/62 hover:border-white hover:bg-white/82'}`}>
                          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold transition ${active ? 'bg-sumi-accent text-white' : 'bg-sumi-surface text-sumi-text-muted group-hover:text-sumi-text'}`}>{poseIndex + 1}</span>
                          <span><span className="block text-xs font-semibold text-sumi-text">{label}</span><span className="mt-1 block text-[9px] tracking-[0.12em] text-sumi-text-muted">POSE {poseIndex + 1}</span></span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </section>

              <section>
                <div className="mb-4"><p className="text-[10px] font-semibold tracking-[0.18em] text-sumi-text-muted">GROWTH CATALOG</p><h3 className="mt-1 text-lg font-semibold text-sumi-text">{mascotCatalog.find((mascot) => mascot.id === debugMascotId)?.name}・全成長段階</h3><p className="mt-1 text-xs text-sumi-text-muted">上のキャラクター選択と連動し、実際の成長境界値で5段階を3D表示します。</p></div>
                <div className="grid grid-cols-5 gap-3">
                  {growthPreviews.map(({ phase, bond }) => (
                    <div key={`${debugMascotId}-${phase}`} className="rounded-[22px] border border-white/80 bg-white/70 p-3 text-center">
                      <div className="flex h-[105px] items-center justify-center"><MascotRenderer mascotId={debugMascotId} bond={bond} care={careByMascot[debugMascotId]} size={96} pose={0} forceBuiltinRenderer="soft-3d" /></div>
                      <p className="mt-2 text-xs font-semibold text-sumi-text">{mascotCatalog.find((mascot) => mascot.id === debugMascotId)?.name}</p>
                      <p className="mt-1 text-[10px] text-sumi-text-muted">{getMascotPhaseLabel(phase)}</p>
                      <span className="mt-2 inline-block rounded-full bg-sumi-surface px-2 py-1 text-[9px] text-sumi-text-muted">{bond}pt</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>}
          </div>
        </div>
      </section>
    </div>
  )
}
