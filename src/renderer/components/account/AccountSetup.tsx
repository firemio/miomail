import { useState } from 'react'
import { CheckCircle, ChevronLeft, Loader2, Plus, Trash2, X, XCircle } from 'lucide-react'
import { api } from '../../lib/ipc'
import { useMailStore } from '../../stores/mailStore'
import { useUIStore } from '../../stores/uiStore'
import type { Account, AccountInput } from '../../types'

const PRESETS: Record<string, Partial<AccountInput>> = {
  gmail: {
    imap_host: 'imap.gmail.com',
    imap_port: 993,
    imap_tls: true,
    smtp_host: 'smtp.gmail.com',
    smtp_port: 587,
    smtp_tls: false,
  },
  outlook: {
    imap_host: 'imap-mail.outlook.com',
    imap_port: 993,
    imap_tls: true,
    smtp_host: 'smtp-mail.outlook.com',
    smtp_port: 587,
    smtp_tls: false,
  },
  yahoo: {
    imap_host: 'imap.mail.yahoo.co.jp',
    imap_port: 993,
    imap_tls: true,
    smtp_host: 'smtp.mail.yahoo.co.jp',
    smtp_port: 465,
    smtp_tls: true,
  },
  lolipop: {
    imap_host: 'imap.lolipop.jp',
    imap_port: 993,
    imap_tls: true,
    smtp_host: 'smtp.lolipop.jp',
    smtp_port: 465,
    smtp_tls: true,
  },
}

const emptyForm: AccountInput = {
  name: '',
  email: '',
  imap_host: '',
  imap_port: 993,
  imap_tls: true,
  smtp_host: '',
  smtp_port: 587,
  smtp_tls: false,
  imap_password: '',
  smtp_password: '',
}

export function AccountSetup() {
  const { closeAccountSetup } = useUIStore()
  const { loadAccounts, accounts } = useMailStore()

  const [view, setView] = useState<'list' | 'add' | 'edit'>(accounts.length === 0 ? 'add' : 'list')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<AccountInput>({ ...emptyForm })
  const [samePassword, setSamePassword] = useState(true)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ imap: boolean; smtp: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const update = (field: keyof AccountInput, value: string | number | boolean) => {
    setForm((prev) => {
      const updated = { ...prev, [field]: value }
      if (field === 'smtp_port' && value === 465) {
        updated.smtp_tls = true
      }
      return updated
    })
    setTestResult(null)
    setError(null)
  }

  const applyPreset = (key: string) => {
    const preset = PRESETS[key]
    if (preset) {
      setForm((prev) => ({ ...prev, ...preset }))
    }
  }

  const resetForm = () => {
    setForm({ ...emptyForm })
    setEditingId(null)
    setSamePassword(true)
    setTestResult(null)
    setError(null)
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    setError(null)
    try {
      const data = { ...form }
      if (samePassword) data.smtp_password = data.imap_password
      const result = await api.account.test(data)
      setTestResult(result)
    } catch (err: any) {
      setError(`接続テストに失敗しました: ${err.message || err}`)
      setTestResult({ imap: false, smtp: false })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const data = { ...form }
      if (samePassword) data.smtp_password = data.imap_password
      if (editingId) {
        await api.account.update(editingId, data)
      } else {
        await api.account.create(data)
      }
      await loadAccounts()
      resetForm()
      setView('list')
    } catch (err: any) {
      setError(`保存に失敗しました: ${err.message || err}`)
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (account: Account) => {
    setForm({
      name: account.name,
      email: account.email,
      imap_host: account.imap_host,
      imap_port: account.imap_port,
      imap_tls: account.imap_tls === 1,
      smtp_host: account.smtp_host,
      smtp_port: account.smtp_port,
      smtp_tls: account.smtp_tls === 1,
      imap_password: '',
      smtp_password: '',
    })
    setEditingId(account.id)
    setSamePassword(true)
    setTestResult(null)
    setError(null)
    setView('edit')
  }

  const handleDelete = async (id: number) => {
    if (!window.confirm('このアカウントを削除しますか？')) return
    setDeleting(id)
    try {
      await api.account.delete(id)
      await loadAccounts()
    } catch (err: any) {
      setError(`削除に失敗しました: ${err.message || err}`)
    } finally {
      setDeleting(null)
    }
  }

  const canTest = Boolean(form.email && form.imap_host && form.smtp_host && form.imap_password)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={closeAccountSetup} />

      <div className="relative flex max-h-[85vh] w-[560px] flex-col overflow-hidden rounded-[32px] border border-white/75 bg-[linear-gradient(180deg,#fffdfb_0%,#fff6f1_100%)] shadow-[0_30px_80px_rgba(181,132,112,0.24)]">
        <div className="flex h-[76px] shrink-0 items-center justify-between border-b border-white/70 px-5">
          <div className="flex items-center gap-2">
            {(view === 'add' || view === 'edit') && accounts.length > 0 && (
              <button
                onClick={() => {
                  setView('list')
                  resetForm()
                }}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/70 bg-white/80 text-sumi-text-muted transition hover:text-sumi-text"
              >
                <ChevronLeft size={14} />
              </button>
            )}
            <div>
              <p className="text-[11px] font-semibold tracking-[0.18em] text-sumi-text-muted">
                ACCOUNT ROUTER
              </p>
              <span className="mt-1 block font-display text-2xl text-sumi-text">
                {view === 'list' ? 'アカウント管理' : view === 'edit' ? 'アカウント編集' : '新規アカウント'}
              </span>
            </div>
          </div>
          <button
            onClick={closeAccountSetup}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-white/80 text-sumi-text-muted transition hover:text-sumi-text"
          >
            <X size={14} />
          </button>
        </div>

        {error && (
          <div className="border-b border-red-100 bg-red-50/80 px-4 py-3">
            <p className="text-[11px] text-red-400">{error}</p>
          </div>
        )}

        {view === 'list' && (
          <>
            <div className="flex-1 overflow-y-auto">
              {accounts.length === 0 ? (
                <div className="flex h-32 items-center justify-center text-xs text-sumi-text-muted">
                  まだアカウントがありません
                </div>
              ) : (
                accounts.map((account) => (
                  <div
                    key={account.id}
                    className="mx-4 my-3 flex cursor-pointer items-center justify-between rounded-[24px] border border-white/70 bg-white/72 px-4 py-4 shadow-[0_14px_30px_rgba(255,255,255,0.62)]"
                    onClick={() => startEdit(account)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs text-sumi-text">{account.name || account.email}</div>
                      <div className="truncate text-[11px] text-sumi-text-muted">{account.email}</div>
                      <div className="mt-0.5 text-[10px] text-sumi-text-muted/60">
                        IMAP: {account.imap_host}:{account.imap_port} / SMTP: {account.smtp_host}:{account.smtp_port}
                      </div>
                    </div>
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        void handleDelete(account.id)
                      }}
                      disabled={deleting === account.id}
                      className="ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-red-100 bg-red-50/75 text-sumi-text-muted transition hover:text-red-400"
                    >
                      {deleting === account.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Trash2 size={13} />
                      )}
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="flex h-16 shrink-0 items-center justify-center border-t border-white/70 px-4">
              <button
                onClick={() => {
                  setView('add')
                  resetForm()
                }}
                className="flex h-11 items-center gap-1.5 rounded-full bg-sumi-accent px-5 text-sm font-semibold text-white shadow-[0_18px_30px_rgba(255,138,160,0.34)] transition hover:bg-sumi-accent-strong"
              >
                <Plus size={12} />
                アカウントを追加
              </button>
            </div>
          </>
        )}

        {(view === 'add' || view === 'edit') && (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <div>
                <label className="mb-1.5 block text-[11px] text-sumi-text-muted">プリセット</label>
                <div className="flex flex-wrap gap-2">
                  {Object.keys(PRESETS).map((key) => (
                    <button
                      key={key}
                      onClick={() => applyPreset(key)}
                      className="h-9 rounded-full border border-white/80 bg-white/75 px-4 text-[11px] font-semibold capitalize text-sumi-text-muted transition hover:border-sumi-accent/40 hover:text-sumi-text"
                    >
                      {key}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-[11px] text-sumi-text-muted">表示名</label>
                  <input
                    value={form.name}
                    onChange={(event) => update('name', event.target.value)}
                    placeholder="会社 / 自分の名前"
                    className="h-11 w-full rounded-2xl border border-white/80 bg-white/80 px-3 text-xs text-sumi-text placeholder-sumi-text-muted/50 focus:border-sumi-accent/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-sumi-text-muted">メールアドレス</label>
                  <input
                    value={form.email}
                    onChange={(event) => update('email', event.target.value)}
                    placeholder="user@example.com"
                    className="h-11 w-full rounded-2xl border border-white/80 bg-white/80 px-3 text-xs text-sumi-text placeholder-sumi-text-muted/50 focus:border-sumi-accent/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-sumi-text-muted">パスワード</label>
                  <input
                    type="password"
                    value={form.imap_password}
                    onChange={(event) => update('imap_password', event.target.value)}
                    placeholder={editingId ? '変更しない場合は空欄のまま' : ''}
                    className="h-11 w-full rounded-2xl border border-white/80 bg-white/80 px-3 text-xs text-sumi-text placeholder-sumi-text-muted/50 focus:border-sumi-accent/50 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] text-sumi-text-muted">IMAP 設定</label>
                <div className="flex gap-2">
                  <input
                    value={form.imap_host}
                    onChange={(event) => update('imap_host', event.target.value)}
                    placeholder="imap.example.com"
                    className="h-11 flex-1 rounded-2xl border border-white/80 bg-white/80 px-3 text-xs text-sumi-text placeholder-sumi-text-muted/50 focus:border-sumi-accent/50 focus:outline-none"
                  />
                  <input
                    type="number"
                    value={form.imap_port}
                    onChange={(event) => update('imap_port', Number(event.target.value))}
                    className="h-11 w-20 rounded-2xl border border-white/80 bg-white/80 px-3 text-xs text-sumi-text focus:border-sumi-accent/50 focus:outline-none"
                  />
                  <label className="flex items-center gap-1 text-[11px] text-sumi-text-muted">
                    <input
                      type="checkbox"
                      checked={form.imap_tls}
                      onChange={(event) => update('imap_tls', event.target.checked)}
                      className="accent-sumi-accent"
                    />
                    SSL
                  </label>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] text-sumi-text-muted">SMTP 設定</label>
                <div className="flex gap-2">
                  <input
                    value={form.smtp_host}
                    onChange={(event) => update('smtp_host', event.target.value)}
                    placeholder="smtp.example.com"
                    className="h-11 flex-1 rounded-2xl border border-white/80 bg-white/80 px-3 text-xs text-sumi-text placeholder-sumi-text-muted/50 focus:border-sumi-accent/50 focus:outline-none"
                  />
                  <input
                    type="number"
                    value={form.smtp_port}
                    onChange={(event) => update('smtp_port', Number(event.target.value))}
                    className="h-11 w-20 rounded-2xl border border-white/80 bg-white/80 px-3 text-xs text-sumi-text focus:border-sumi-accent/50 focus:outline-none"
                  />
                  <label className="flex items-center gap-1 text-[11px] text-sumi-text-muted">
                    <input
                      type="checkbox"
                      checked={form.smtp_tls}
                      onChange={(event) => update('smtp_tls', event.target.checked)}
                      className="accent-sumi-accent"
                    />
                    SSL
                  </label>
                </div>
              </div>

              <label className="flex items-center gap-2 text-[11px] text-sumi-text-muted">
                <input
                  type="checkbox"
                  checked={samePassword}
                  onChange={(event) => setSamePassword(event.target.checked)}
                  className="accent-sumi-accent"
                />
                IMAP と SMTP で同じパスワードを使う
              </label>

              {!samePassword && (
                <div>
                  <label className="mb-1 block text-[11px] text-sumi-text-muted">SMTP パスワード</label>
                  <input
                    type="password"
                    value={form.smtp_password}
                    onChange={(event) => update('smtp_password', event.target.value)}
                    className="h-11 w-full rounded-2xl border border-white/80 bg-white/80 px-3 text-xs text-sumi-text focus:border-sumi-accent/50 focus:outline-none"
                  />
                </div>
              )}

              {testResult && (
                <div className="flex gap-3 rounded-[22px] border border-white/75 bg-white/75 p-4">
                  <div className="flex items-center gap-1.5">
                    {testResult.imap ? (
                      <CheckCircle size={14} className="text-green-500" />
                    ) : (
                      <XCircle size={14} className="text-red-400" />
                    )}
                    <span className="text-[11px] text-sumi-text">IMAP</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {testResult.smtp ? (
                      <CheckCircle size={14} className="text-green-500" />
                    ) : (
                      <XCircle size={14} className="text-red-400" />
                    )}
                    <span className="text-[11px] text-sumi-text">SMTP</span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex h-16 shrink-0 items-center justify-end gap-2 border-t border-white/70 px-5">
              <button
                onClick={() => void handleTest()}
                disabled={!canTest || testing}
                className="flex h-11 items-center gap-1.5 rounded-full border border-white/80 bg-white/80 px-4 text-xs font-semibold text-sumi-text transition hover:border-sumi-accent/50 disabled:opacity-50"
              >
                {testing && <Loader2 size={12} className="animate-spin" />}
                接続テスト
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saving || (!editingId && !canTest)}
                className="flex h-11 items-center gap-1.5 rounded-full bg-sumi-accent px-5 text-sm font-semibold text-white shadow-[0_18px_30px_rgba(255,138,160,0.34)] transition hover:bg-sumi-accent-strong disabled:opacity-50"
              >
                {saving && <Loader2 size={12} className="animate-spin" />}
                {editingId ? '更新' : '保存'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}