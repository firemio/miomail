import { Check, Palette, Sparkles } from 'lucide-react'
import { mascotCatalog, type MascotId } from '../../data/mascots'
import { MascotRenderer } from '../characters/MascotRenderer'
import { themeCatalog, type ThemeId } from '../../data/themes'

interface WelcomeOnboardingProps {
  selectedMascotId: MascotId
  themeId: ThemeId
  onSelectMascot: (mascotId: MascotId) => void
  onSelectTheme: (themeId: ThemeId) => void
  onContinue: () => void
}

export function WelcomeOnboarding({
  selectedMascotId,
  themeId,
  onSelectMascot,
  onSelectTheme,
  onContinue,
}: WelcomeOnboardingProps) {
  return (
    <div
      data-testid="welcome-onboarding"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-[rgba(18,12,10,0.42)] backdrop-blur-md"
    >
      <div className="relative flex h-[92vh] w-[1180px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[36px] border border-white/75 bg-[linear-gradient(180deg,rgba(255,253,250,0.98)_0%,rgba(255,245,239,0.98)_100%)] shadow-[0_40px_100px_rgba(120,88,88,0.26)]">
        <div className="grid h-full min-h-0 gap-0 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="min-h-0 overflow-y-auto border-b border-white/70 bg-[radial-gradient(circle_at_top_left,rgba(255,182,198,0.26),transparent_34%),linear-gradient(180deg,rgba(255,252,248,0.98)_0%,rgba(255,242,235,0.98)_100%)] p-7 lg:border-b-0 lg:border-r">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold tracking-[0.18em] text-sumi-text-muted">
              <Sparkles size={12} className="text-sumi-accent" />
              FIRST SETUP
            </div>
            <h1 className="mt-4 font-display text-[34px] leading-[1.18] text-sumi-text">
              最初に
              <br />
              相棒とテーマを
              <br />
              決めよう
            </h1>
            <p className="mt-4 text-sm leading-7 text-sumi-text-muted">
              MioMail は、いつも相棒が見えるメーラーです。
              <br />
              まずは見た目と空気感を選んで、あなたの初期セットを作ります。
            </p>

            <div className="mt-6 rounded-[28px] border border-white/80 bg-white/82 p-5 shadow-[0_18px_45px_rgba(255,220,220,0.18)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.18em] text-sumi-text-muted">
                    PREVIEW
                  </p>
                  <h2 className="mt-1 font-display text-[28px] text-sumi-text">
                    {mascotCatalog.find((mascot) => mascot.id === selectedMascotId)?.name}
                  </h2>
                  <p className="mt-1 text-xs text-sumi-text-muted">
                    {mascotCatalog.find((mascot) => mascot.id === selectedMascotId)?.subtitle}
                  </p>
                </div>
                <div className="rounded-full bg-sumi-surface px-3 py-1 text-[10px] font-semibold text-sumi-text-muted">
                  {themeCatalog.find((theme) => theme.id === themeId)?.name}
                </div>
              </div>

              <div className="mt-4 flex justify-center">
                <div className="rounded-[30px] border border-white/75 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.92),rgba(255,242,236,0.95))] px-8 py-6">
                  <MascotRenderer mascotId={selectedMascotId} bond={38} size={180} pose={0} />
                </div>
              </div>

              <div className="mt-4 rounded-[20px] bg-sumi-surface/70 px-4 py-3">
                <p className="text-[11px] font-semibold text-sumi-text">
                  {mascotCatalog.find((mascot) => mascot.id === selectedMascotId)?.greeting}
                </p>
                <p className="mt-1 text-[11px] leading-5 text-sumi-text-muted">
                  {themeCatalog.find((theme) => theme.id === themeId)?.description}
                </p>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="border-b border-white/70 px-7 py-6">
              <p className="text-[11px] font-semibold tracking-[0.18em] text-sumi-text-muted">
                STEP 1 / STEP 2
              </p>
              <h2 className="mt-2 font-display text-[30px] text-sumi-text">
                初回セットアップ
              </h2>
              <p className="mt-2 text-sm leading-6 text-sumi-text-muted">
                キャラクタを選んでから、かわいい系〜ハッカー風まで好きなテーマを選択。
                この内容はあとで切り替えできます。
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <Sparkles size={14} className="text-sumi-accent" />
                  <h3 className="text-sm font-semibold text-sumi-text">相棒を選ぶ</h3>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {mascotCatalog.map((mascot) => {
                    const active = mascot.id === selectedMascotId
                    return (
                      <button
                        key={mascot.id}
                        data-testid={`onboarding-mascot-${mascot.id}`}
                        onClick={() => onSelectMascot(mascot.id)}
                        className={`rounded-[24px] border px-4 py-4 text-left transition ${
                          active
                            ? 'border-sumi-accent bg-sumi-accent/10 shadow-[0_18px_40px_rgba(255,138,160,0.18)]'
                            : 'border-white/80 bg-white/78 hover:-translate-y-0.5 hover:border-sumi-accent/30'
                        }`}
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div>
                            <div className="text-base font-semibold text-sumi-text">{mascot.name}</div>
                            <div className="mt-1 text-[11px] text-sumi-text-muted">{mascot.subtitle}</div>
                          </div>
                          {active && (
                            <span className="rounded-full bg-sumi-accent px-2.5 py-1 text-[10px] font-semibold text-white">
                              選択中
                            </span>
                          )}
                        </div>
                        <div className="mb-3 flex justify-center rounded-[20px] bg-sumi-surface/70 py-3">
                          <MascotRenderer mascotId={mascot.id} bond={26} size={96} pose={0} />
                        </div>
                        <p className="text-[11px] leading-5 text-sumi-text-muted">{mascot.blurb}</p>
                      </button>
                    )
                  })}
                </div>
              </section>

              <section className="mt-7">
                <div className="mb-3 flex items-center gap-2">
                  <Palette size={14} className="text-sumi-accent" />
                  <h3 className="text-sm font-semibold text-sumi-text">テーマを選ぶ</h3>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {themeCatalog.map((theme) => {
                    const active = theme.id === themeId
                    return (
                      <button
                        key={theme.id}
                        data-testid={`onboarding-theme-${theme.id}`}
                        onClick={() => onSelectTheme(theme.id)}
                        className={`rounded-[24px] border px-4 py-4 text-left transition ${
                          active
                            ? 'border-sumi-accent bg-sumi-accent/10 shadow-[0_18px_40px_rgba(255,138,160,0.18)]'
                            : 'border-white/80 bg-white/78 hover:-translate-y-0.5 hover:border-sumi-accent/30'
                        }`}
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div>
                            <div className="text-base font-semibold text-sumi-text">{theme.name}</div>
                            <div className="mt-1 text-[11px] text-sumi-text-muted">{theme.mood}</div>
                          </div>
                          {active && (
                            <span className="rounded-full bg-sumi-accent px-2 py-1 text-[10px] font-semibold text-white">
                              <Check size={11} className="inline-block" />
                            </span>
                          )}
                        </div>
                        <div className="mb-3 flex items-center gap-2">
                          {theme.swatches.map((swatch) => (
                            <span
                              key={swatch}
                              className="h-6 w-6 rounded-full border border-white/70 shadow-sm"
                              style={{ background: swatch }}
                            />
                          ))}
                        </div>
                        <p className="text-[11px] leading-5 text-sumi-text-muted">{theme.description}</p>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {theme.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full bg-sumi-surface px-2 py-1 text-[10px] font-semibold text-sumi-text-muted"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </section>
            </div>

            <div className="flex items-center justify-between border-t border-white/70 px-7 py-5">
              <p className="text-xs text-sumi-text-muted">
                選んだ相棒とテーマはあとで変更できます。
              </p>
              <button
                data-testid="onboarding-continue"
                onClick={onContinue}
                className="inline-flex h-12 items-center gap-2 rounded-full bg-sumi-accent px-6 text-sm font-semibold text-white shadow-[0_18px_30px_rgba(255,138,160,0.34)] transition hover:-translate-y-0.5 hover:bg-sumi-accent-strong"
              >
                この組み合わせで始める
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
