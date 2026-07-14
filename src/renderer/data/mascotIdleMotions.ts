import type { MascotId } from './mascots'

type IdleMotionSet = readonly [string, string, string, string, string, string, string, string]

export const MASCOT_IDLE_MOTION_LABELS = {
  makko: ['ゆらゆら', '見回し', '身構え', 'ふわっと弾む', '伸び', '居眠り', 'きょろきょろ', '喜びジャンプ'],
  mio: ['ゆらゆら', '見回し', 'しっぽ待機', 'ふわっと弾む', '毛づくろい', '居眠り', 'きょろきょろ', '飛びつく構え'],
  posty: ['待機運転', '左右確認', 'システム確認', 'ふわっと弾む', 'スキャン', '充電', '再起動', '敬礼'],
  saeta: ['止まり木', '見回し', '飛行準備', '羽ばたき準備', '羽づくろい', 'ひと休み', 'ホバリング', '首かしげ'],
} satisfies Record<MascotId, IdleMotionSet>

export const MASCOT_IDLE_MOTION_DURATIONS = [5200, 9000, 4800, 4200, 5200, 6200, 4300, 4600] as const
export const MASCOT_IDLE_MOTION_COUNT = MASCOT_IDLE_MOTION_DURATIONS.length
