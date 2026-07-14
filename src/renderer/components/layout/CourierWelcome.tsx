import { Mail } from 'lucide-react'

/**
 * Empty reading pane shown when no message is open. Deliberately minimal —
 * the toolbar already has compose/settings, and counts live in the sidebar.
 */
export function CourierWelcome() {
  return (
    <div className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,181,198,0.12),transparent_60%)]" />
      <div className="relative flex flex-col items-center gap-4 px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-[24px] border border-white/70 bg-white/70 text-sumi-accent shadow-[0_16px_34px_rgba(255,191,160,0.18)]">
          <Mail size={26} strokeWidth={1.6} />
        </div>
        <div>
          <p className="font-display text-lg text-sumi-text">おたよりを選んでください</p>
          <p className="mt-1 text-xs leading-6 text-sumi-text-muted">
            左の一覧からメールを選ぶと、ここに開きます。
          </p>
        </div>
      </div>
    </div>
  )
}
