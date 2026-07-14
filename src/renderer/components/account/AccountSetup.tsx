import { useUIStore } from '../../stores/uiStore'
import { AccountManager } from './AccountManager'

/**
 * Standalone account setup modal. Used during onboarding / when no account
 * exists yet. In-app account management lives inside the settings modal
 * (see SettingsModal's "mail" section), which renders <AccountManager /> directly.
 */
export function AccountSetup() {
  const { closeAccountSetup } = useUIStore()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={closeAccountSetup} />

      <div className="relative flex max-h-[85vh] w-[560px] flex-col overflow-hidden rounded-[32px] border border-white/75 bg-[linear-gradient(180deg,#fffdfb_0%,#fff6f1_100%)] shadow-[0_30px_80px_rgba(181,132,112,0.24)]">
        <AccountManager onClose={closeAccountSetup} />
      </div>
    </div>
  )
}
