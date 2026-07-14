export const MASCOT_IDS = ['makko', 'mio', 'posty', 'saeta'] as const

export type MascotId = (typeof MASCOT_IDS)[number]

export interface MascotMeta {
  id: MascotId
  name: string
  subtitle: string
  accent: string
  accentSoft: string
  accentStrong: string
  bodyTop: string
  bodyBottom: string
  eyeColor: string
  accessoryColor: string
  model: 'bear' | 'cat' | 'robot' | 'bird'
  greeting: string
  blurb: string
}

export const mascotCatalog: MascotMeta[] = [
  {
    id: 'makko',
    name: 'マクコ',
    subtitle: 'もこっと先回り配達係',
    accent: '#ff8fb3',
    accentSoft: '#ffe0eb',
    accentStrong: '#f76a99',
    bodyTop: '#ffd9e6',
    bodyBottom: '#ffb3cd',
    eyeColor: '#6b4249',
    accessoryColor: '#ff8fb3',
    model: 'bear',
    greeting: '先に気づいて、先に届けるのが得意です。',
    blurb: 'ふわふわのピンクのクマのぬいぐるみ。看板ポジションの配達係。',
  },
  {
    id: 'mio',
    name: 'ミオ',
    subtitle: '整えて案内する配達係',
    accent: '#f4a7b9',
    accentSoft: '#ffe9ef',
    accentStrong: '#e98aa4',
    bodyTop: '#ffffff',
    bodyBottom: '#efeae7',
    eyeColor: '#5b8fd4',
    accessoryColor: '#f4a7b9',
    model: 'cat',
    greeting: '迷わない導線づくりは、わたしに任せてください。',
    blurb: 'まっしろでふわふわな子猫。落ち着いた案内が得意な使いやすさ担当。',
  },
  {
    id: 'posty',
    name: 'ポスティ',
    subtitle: 'レトロなポンコツ配達ロボ',
    accent: '#5b8bef',
    accentSoft: '#dbe7ff',
    accentStrong: '#3a63d8',
    bodyTop: '#b9d2f9',
    bodyBottom: '#7ca4ee',
    eyeColor: '#ffd166',
    accessoryColor: '#5b8bef',
    model: 'robot',
    greeting: 'ガガッ…複数下書きや切り替えは、並列処理で支えます。',
    blurb: 'ブリキボディのレトロな配達ロボ。ときどき軋むけど働き者の理詰めの相棒。',
  },
  {
    id: 'saeta',
    name: 'サエタ',
    subtitle: '風切る滑空配達係',
    accent: '#5ec97a',
    accentSoft: '#dff5e2',
    accentStrong: '#3aa85c',
    bodyTop: '#c9efc9',
    bodyBottom: '#8fd894',
    eyeColor: '#33503a',
    accessoryColor: '#ffb347',
    model: 'bird',
    greeting: '空気を切るみたいに、すばやく届けるのが得意です。',
    blurb: 'グリーンの羽が目印の小鳥。軽快な旋回で新着を知らせるスピード担当。',
  },
]

export function getMascotMeta(id: MascotId) {
  return mascotCatalog.find((mascot) => mascot.id === id) ?? mascotCatalog[0]
}