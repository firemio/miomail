import { useEffect, useState } from 'react'
import { Code2, Cpu, Database, Download, FlaskConical, FolderOpen, Mail, Palette, Plus, RefreshCw, Settings2, Sparkles, Star, TriangleAlert, X } from 'lucide-react'
import { DEFAULT_MOD_ID_BY_MASCOT, type CharacterModPackage } from '../../characters/types'
import { mascotCatalog, type MascotId } from '../../data/mascots'
import { themeCatalog } from '../../data/themes'
import { api, isTauriRuntime } from '../../lib/ipc'
import { getMascotPhaseLabel, MASCOT_GROWTH_STAGES, type MascotPhase, useMascotStore } from '../../stores/mascotStore'
import { useUIStore } from '../../stores/uiStore'
import { useCharacterStore } from '../../stores/characterStore'
import { CharacterTestModal } from '../characters/CharacterTestModal'
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

export function SettingsModal() {
  const [section, setSection] = useState<SettingsSection>('appearance')
  const [demoBusy, setDemoBusy] = useState<'receive' | 'send' | null>(null)
  const [debugMascotId, setDebugMascotId] = useState<MascotId>('makko')
  const [debugStartPhase, setDebugStartPhase] = useState<MascotPhase>('egg')
  const [testPackage, setTestPackage] = useState<CharacterModPackage | null>(null)
  const { closeSettings, openImport, themeId, setTheme } = useUIStore()
  const { selectedMascotId, selectMascot, bondByMascot, careByMascot, debugSetPhase, debugEvolveFrom } = useMascotStore()
  const {
    selectedModId,
    packages: characterPackages,
    issues: characterModIssues,
    loading: characterModsLoading,
    installing: characterModsInstalling,
    error: characterModsError,
    selectMod,
    refreshMods,
    installArchive,
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

  const openImporter = () => {
    closeSettings()
    openImport()
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

  const handleInstallMod = async () => {
    const result = await installArchive()
    if (!result) return
    const installed = result.scan.packages.find((item) => item.manifest.id === result.installedId)
    if (installed) selectMascot(installed.manifest.behaviorProfile)
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
                  <div className="mb-4 flex items-end justify-between gap-4">
                    <div><p className="text-[10px] font-semibold tracking-[0.18em] text-sumi-text-muted">COMPANION</p><h3 className="mt-1 text-lg font-semibold text-sumi-text">相棒を選ぶ</h3></div>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" disabled={!isTauriRuntime || characterModsInstalling} onClick={() => void handleInstallMod()} className="inline-flex h-10 items-center gap-2 rounded-2xl bg-sumi-accent px-3 text-[11px] font-semibold text-white shadow-[0_10px_22px_rgba(255,138,160,0.24)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"><Plus size={14} />{characterModsInstalling ? '追加中…' : 'MODを追加'}</button>
                      <button type="button" disabled={!isTauriRuntime} onClick={() => void openModsFolder()} className="inline-flex h-10 items-center gap-2 rounded-2xl border border-white/90 bg-white/82 px-3 text-[11px] font-semibold text-sumi-text-muted transition hover:text-sumi-text disabled:cursor-not-allowed disabled:opacity-45"><FolderOpen size={14} />MODフォルダー</button>
                      <button type="button" disabled={characterModsLoading} onClick={() => void refreshMods()} className="inline-flex h-10 items-center gap-2 rounded-2xl border border-white/90 bg-white/82 px-3 text-[11px] font-semibold text-sumi-text-muted transition hover:text-sumi-text disabled:opacity-45"><RefreshCw size={14} className={characterModsLoading ? 'animate-spin' : ''} />再読み込み</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-3">
                    {mascotCatalog.map((mascot) => {
                      const active = mascot.id === selectedMascotId
                        && (!selectedModId || selectedModId === DEFAULT_MOD_ID_BY_MASCOT[mascot.id])
                      const defaultPackage = characterPackages.find((item) => item.manifest.id === DEFAULT_MOD_ID_BY_MASCOT[mascot.id])
                        ?? characterPackages.find((item) => item.origin === 'builtin' && item.manifest.behaviorProfile === mascot.id)
                        ?? null
                      return <button key={mascot.id} type="button" aria-pressed={active} onClick={() => { selectMascot(mascot.id); if (selectedModId) selectMod(null) }} className={`rounded-[24px] border p-4 text-left transition hover:-translate-y-0.5 ${active ? 'border-sumi-accent bg-sumi-accent/10 shadow-[0_16px_34px_rgba(255,138,160,0.16)]' : 'border-white/80 bg-white/72'}`}>
                        <div className="flex items-start justify-between"><MascotRenderer mascotId={mascot.id} bond={bondByMascot[mascot.id] ?? 0} care={careByMascot[mascot.id]} size={72} pose={0} forceDefaultMod /><span className="rounded-full bg-sumi-surface px-2 py-1 text-[10px] text-sumi-text-muted">{bondByMascot[mascot.id] ?? 0}pt</span></div>
                        <div className="mt-3 flex items-center justify-between"><span className="font-semibold text-sumi-text">{mascot.name}</span>{active && <span className="rounded-full bg-sumi-accent px-2 py-1 text-[10px] font-semibold text-white">選択中</span>}</div>
                        <div className="mt-1 flex items-end justify-between gap-2">
                          <p className="text-[11px] leading-5 text-sumi-text-muted">{mascot.subtitle}</p>
                          {defaultPackage && (
                            <span role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); setTestPackage(defaultPackage) }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.stopPropagation(); event.preventDefault(); setTestPackage(defaultPackage) } }} className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-white/90 bg-white/85 px-2.5 py-1 text-[10px] font-semibold text-sumi-text-muted transition hover:text-sumi-text" title="モーションと成長段階をテスト"><FlaskConical size={11} />テスト</span>
                          )}
                        </div>
                      </button>
                    })}
                    {characterPackages.filter((characterPackage) => !Object.values(DEFAULT_MOD_ID_BY_MASCOT).includes(characterPackage.manifest.id)).map((characterPackage) => {
                      const { manifest } = characterPackage
                      const active = selectedModId === manifest.id
                      return (
                        <button key={`${manifest.id}:${characterPackage.revision}`} type="button" aria-pressed={active} onClick={() => { selectMascot(manifest.behaviorProfile); selectMod(manifest.id) }} className={`rounded-[24px] border p-4 text-left transition hover:-translate-y-0.5 ${active ? 'border-sumi-accent bg-sumi-accent/10 shadow-[0_16px_34px_rgba(255,138,160,0.16)]' : 'border-white/80 bg-white/72'}`}>
                          <div className="flex items-start justify-between">
                            <span className="flex h-[72px] w-[72px] overflow-hidden rounded-[18px] bg-sumi-surface/70"><ModThumbnail characterPackage={characterPackage} /></span>
                            <span className="rounded-full bg-sumi-surface px-2 py-1 text-[10px] text-sumi-text-muted">{bondByMascot[manifest.behaviorProfile] ?? 0}pt</span>
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-2"><span className="truncate font-semibold text-sumi-text">{manifest.name}</span>{active && <span className="shrink-0 rounded-full bg-sumi-accent px-2 py-1 text-[10px] font-semibold text-white">選択中</span>}</div>
                          <div className="mt-1 flex items-end justify-between gap-2">
                            <p className="truncate text-[11px] leading-5 text-sumi-text-muted">MOD・{manifest.renderer === 'gltf-3d' ? '3D' : manifest.renderer === 'dom-svg' ? 'SVG' : '2D'}・{manifest.author} v{manifest.version}</p>
                            <span role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); setTestPackage(characterPackage) }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.stopPropagation(); event.preventDefault(); setTestPackage(characterPackage) } }} className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-white/90 bg-white/85 px-2.5 py-1 text-[10px] font-semibold text-sumi-text-muted transition hover:text-sumi-text" title="モーションと成長段階をテスト"><FlaskConical size={11} />テスト</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                  <p className="mt-3 text-[11px] leading-5 text-sumi-text-muted">選んだ1体が画面内を自由に移動します。MODは「MODを追加」からzipまたはtar.xz（XZ / LZMA2）を選ぶだけでここに並び、検証に通ったものだけが使われます。MOD内のコードは実行しません。</p>

                  {!isTauriRuntime && <div className="mt-3 rounded-[18px] border border-white/85 bg-sumi-surface/65 px-4 py-3 text-[11px] leading-5 text-sumi-text-muted">ブラウザープレビューでは同梱の既定キャラクターだけを表示します。ローカルMODの検出はデスクトップ版で有効になります。</div>}

                  {selectedModId && !characterPackages.some((item) => item.manifest.id === selectedModId) && !characterModsLoading && (
                    <div className="mt-3 flex items-start gap-3 rounded-[18px] border border-[#e7b674]/45 bg-[#fff2dc]/70 px-4 py-3 text-[11px] leading-5 text-[#98632d]"><TriangleAlert size={15} className="mt-0.5 shrink-0" /><span>選択中だったMODが見つからないか、検証に通りませんでした。現在は既定のキャラクター（同梱MOD）へ安全にフォールバックしています。</span></div>
                  )}

                  {(characterModsError || characterModIssues.length > 0) && (
                    <div className="mt-3 rounded-[18px] border border-[#efb1a7]/55 bg-[#fff0ed]/75 px-4 py-3">
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

            </div>}
          </div>
        </div>
      </section>

      {testPackage && <CharacterTestModal characterPackage={testPackage} onClose={() => setTestPackage(null)} />}
    </div>
  )
}
