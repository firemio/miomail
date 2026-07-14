import type { ThemePalette } from '../../data/themes'

/**
 * A miniature of the actual app rendered with a theme's real palette, so the
 * theme picker shows the full color system at a glance (not just a few dots).
 */
export function ThemePreview({ palette }: { palette: ThemePalette }) {
  const row = (accent: boolean, unread: boolean) => (
    <div
      className="flex items-center gap-1.5 rounded-[6px] px-1.5 py-1"
      style={{ background: palette.surface }}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: unread ? palette.unread : palette.border }}
      />
      <div className="min-w-0 flex-1">
        <div className="h-1 w-3/4 rounded-full" style={{ background: accent ? palette.accent : palette.text, opacity: accent ? 0.9 : 0.55 }} />
        <div className="mt-1 h-1 w-1/2 rounded-full" style={{ background: palette.textMuted, opacity: 0.5 }} />
      </div>
    </div>
  )

  return (
    <div
      className="overflow-hidden rounded-[14px] border"
      style={{ background: palette.bg, borderColor: palette.border }}
    >
      {/* title bar */}
      <div className="flex items-center gap-1.5 px-2 py-1.5" style={{ borderBottom: `1px solid ${palette.border}` }}>
        <span className="rounded-full px-2 py-0.5 text-[7px] font-bold" style={{ background: palette.accent, color: palette.bg }}>
          作成
        </span>
        <div className="h-1.5 flex-1 rounded-full" style={{ background: palette.surface2 }} />
        <span className="h-2 w-2 rounded-full" style={{ background: palette.surface2 }} />
      </div>

      <div className="flex gap-1.5 p-1.5">
        {/* mini sidebar */}
        <div className="flex w-9 shrink-0 flex-col gap-1 rounded-[8px] p-1" style={{ background: palette.surface }}>
          <div className="h-1.5 rounded-full" style={{ background: palette.accent, opacity: 0.85 }} />
          <div className="h-1.5 rounded-full" style={{ background: palette.surface2 }} />
          <div className="h-1.5 rounded-full" style={{ background: palette.surface2 }} />
        </div>
        {/* message rows */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {row(false, true)}
          {row(true, false)}
          {row(false, false)}
        </div>
      </div>
    </div>
  )
}
