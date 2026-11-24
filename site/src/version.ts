import { useEffect, useState } from 'react'

const LATEST_RELEASE_API = 'https://api.github.com/repos/firemio/miomail/releases/latest'

/**
 * サイトに表示する最新版のバージョン。
 *
 * サイトはアプリのリリースとは別にデプロイするため、ビルド時に埋め込んだ値は
 * 古くなりうる。まず埋め込み値を表示し、GitHub の最新リリースを取得できたら
 * そちらへ差し替える(取得できなければ埋め込み値のまま)。
 */
export function useLatestVersion(): string {
  const [version, setVersion] = useState(__MIOMAIL_VERSION__)

  useEffect(() => {
    const controller = new AbortController()

    fetch(LATEST_RELEASE_API, {
      signal: controller.signal,
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((release: { tag_name?: unknown } | null) => {
        const tag =
          typeof release?.tag_name === 'string' ? release.tag_name.replace(/^v/, '') : ''
        if (/^\d+\.\d+\.\d+/.test(tag)) setVersion(tag)
      })
      .catch(() => {
        // 取得できないときは埋め込み値のまま表示する
      })

    return () => controller.abort()
  }, [])

  return version
}
