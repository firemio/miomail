import { useEffect, useState } from 'react'

/**
 * フォルダ・メール一覧・本文の3ペインを横に並べるのに必要な最小幅。
 * これを下回る画面(スマホなど)では、ペインを1つずつ出して行き来する。
 */
export const NARROW_LAYOUT_QUERY = '(max-width: 899px)'

/** いま1カラム表示かどうか(React の外からも使える)。 */
export function isNarrowViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(NARROW_LAYOUT_QUERY).matches
}

/** 画面が狭く、1カラム表示にすべきか。 */
export function useIsNarrowLayout(): boolean {
  const [narrow, setNarrow] = useState(isNarrowViewport)

  useEffect(() => {
    const query = window.matchMedia(NARROW_LAYOUT_QUERY)
    const update = (event: MediaQueryListEvent | MediaQueryList) => setNarrow(event.matches)

    update(query)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return narrow
}
