const ONBOARDING_STORAGE_KEY = 'miomail-onboarding-complete'

export function loadOnboardingComplete() {
  if (typeof window === 'undefined') {
    return true
  }

  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1'
  } catch {
    return true
  }
}

export function persistOnboardingComplete() {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(ONBOARDING_STORAGE_KEY, '1')
}