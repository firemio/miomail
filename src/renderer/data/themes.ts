export const THEME_IDS = [
  'petal-pop',
  'peach-soda',
  'mint-candy',
  'paper-latte',
  'sunset-drive',
  'moon-arcade',
  'ocean-letter',
  'lavender-fog',
  'forest-post',
  'lemon-station',
  'sakura-noir',
  'ink-monochrome',
  'terminal-hacker',
  'amber-command',
] as const

export type ThemeId = (typeof THEME_IDS)[number]

/** The full palette that actually drives a theme (mirrors the CSS variables). */
export interface ThemePalette {
  bg: string
  surface: string
  surface2: string
  text: string
  textMuted: string
  accent: string
  accentStrong: string
  unread: string
  border: string
}

export interface MailTheme {
  id: ThemeId
  name: string
  mood: string
  description: string
  tags: string[]
  dark: boolean
  palette: ThemePalette
}

const PALETTES: Record<ThemeId, ThemePalette> = {
  'petal-pop': { bg: '#fff8f4', surface: '#fff1ea', surface2: '#ffe5d8', text: '#52362f', textMuted: '#9b776d', accent: '#ff8aa0', accentStrong: '#f76f8e', unread: '#f5a64a', border: '#f0d7cb' },
  'peach-soda': { bg: '#fff7ee', surface: '#fff0e0', surface2: '#ffe3ce', text: '#5a3a2d', textMuted: '#9f7661', accent: '#ff926c', accentStrong: '#f5744d', unread: '#ffc04c', border: '#f1d4bf' },
  'mint-candy': { bg: '#f4fdfb', surface: '#e3f7f3', surface2: '#d0f0eb', text: '#304848', textMuted: '#6f908f', accent: '#59c5d8', accentStrong: '#29aabf', unread: '#68c7b3', border: '#cdeae6' },
  'paper-latte': { bg: '#f8f3eb', surface: '#f0e5d6', surface2: '#e6d6c3', text: '#553f36', textMuted: '#8e766b', accent: '#b5825c', accentStrong: '#9e6847', unread: '#d19e5c', border: '#dccab7' },
  'sunset-drive': { bg: '#fff5f3', surface: '#ffe8e6', surface2: '#ffd8d4', text: '#593237', textMuted: '#9a6d70', accent: '#ff6f91', accentStrong: '#ec4e74', unread: '#ffb457', border: '#f6ccc7' },
  'moon-arcade': { bg: '#eff1ff', surface: '#dfe4ff', surface2: '#ccd5ff', text: '#343a5c', textMuted: '#6d75a3', accent: '#7478ff', accentStrong: '#565cea', unread: '#49d6ff', border: '#c7cef7' },
  'ocean-letter': { bg: '#eef9fc', surface: '#daf1f7', surface2: '#bfe2ed', text: '#1b3a48', textMuted: '#527d8f', accent: '#277da1', accentStrong: '#186386', unread: '#e18748', border: '#b3d8e3' },
  'lavender-fog': { bg: '#f9f7fc', surface: '#ede7f7', surface2: '#dcd2ef', text: '#3e3452', textMuted: '#7e6d97', accent: '#8c73c9', accentStrong: '#6f56ad', unread: '#d66f9d', border: '#d8cfe8' },
  'forest-post': { bg: '#f6f7ee', surface: '#e6ecd7', surface2: '#d0ddbe', text: '#2b4434', textMuted: '#697e6a', accent: '#39735a', accentStrong: '#275b45', unread: '#c78442', border: '#c8d7bb' },
  'lemon-station': { bg: '#fffceb', surface: '#fff4be', surface2: '#f9e284', text: '#20304a', textMuted: '#656967', accent: '#e0a815', accentStrong: '#bd8600', unread: '#e05548', border: '#ebda9a' },
  'sakura-noir': { bg: '#181117', surface: '#2c1c28', surface2: '#402636', text: '#ffdbe7', textMuted: '#c48ba1', accent: '#ff7aa8', accentStrong: '#e95289', unread: '#ffc26f', border: '#63354c' },
  'ink-monochrome': { bg: '#f5f5f2', surface: '#e5e5e1', surface2: '#cfcfca', text: '#262626', textMuted: '#686865', accent: '#343434', accentStrong: '#141414', unread: '#9c3e3e', border: '#c7c7c2' },
  'terminal-hacker': { bg: '#0a110f', surface: '#111f1b', surface2: '#182b26', text: '#a5ffd6', textMuted: '#68af91', accent: '#2dee87', accentStrong: '#08c567', unread: '#54ffd9', border: '#245742' },
  'amber-command': { bg: '#140c08', surface: '#26160e', surface2: '#362015', text: '#ffd6a0', textMuted: '#ca9b6b', accent: '#ffb547', accentStrong: '#ef941b', unread: '#ffdf96', border: '#664020' },
}

const META: Array<Omit<MailTheme, 'palette'>> = [
  { id: 'petal-pop', name: 'Petal Pop', mood: 'かわいい定番', description: 'やわらかいピンクで、相棒の愛らしさを主役にする標準テーマ。', tags: ['cute', 'soft', 'default'], dark: false },
  { id: 'peach-soda', name: 'Peach Soda', mood: 'ポップで元気', description: 'もも色とソーダの抜け感で、通知や送信演出を明るく見せるテーマ。', tags: ['pop', 'fresh', 'bright'], dark: false },
  { id: 'mint-candy', name: 'Mint Candy', mood: '軽やかクール', description: 'ミントとアイスブルーで、爽やかに整理された印象をつくるテーマ。', tags: ['mint', 'clean', 'airy'], dark: false },
  { id: 'paper-latte', name: 'Paper Latte', mood: '手帳っぽい', description: '紙とミルクティーの雰囲気で、毎日使う道具感を高めるテーマ。', tags: ['notebook', 'warm', 'calm'], dark: false },
  { id: 'sunset-drive', name: 'Sunset Drive', mood: '夕焼けネオン', description: '夕暮れグラデーションで、送受信の演出を少し派手に見せるテーマ。', tags: ['sunset', 'vivid', 'neon'], dark: false },
  { id: 'moon-arcade', name: 'Moon Arcade', mood: 'サイバーかわいい', description: '紫とシアンを混ぜた、ゲームっぽい夜景トーンのテーマ。', tags: ['arcade', 'cyber', 'night'], dark: false },
  { id: 'ocean-letter', name: 'Ocean Letter', mood: '深海ブルー', description: '澄んだ青と白波のコントラストで、長文メールを落ち着いて読めるテーマ。', tags: ['ocean', 'blue', 'focused'], dark: false },
  { id: 'lavender-fog', name: 'Lavender Fog', mood: '静かな紫', description: 'ラベンダーと薄霧のグレーで、やわらかさと知的な静けさを両立。', tags: ['lavender', 'quiet', 'elegant'], dark: false },
  { id: 'forest-post', name: 'Forest Post', mood: '森の郵便局', description: '深い常緑色と苔色、生成りの紙を組み合わせた自然派テーマ。', tags: ['forest', 'organic', 'calm'], dark: false },
  { id: 'lemon-station', name: 'Lemon Station', mood: '明るい黄色', description: 'レモンイエローと濃紺で、軽快さを保ちながら文字をくっきり見せるテーマ。', tags: ['lemon', 'cheerful', 'clear'], dark: false },
  { id: 'sakura-noir', name: 'Sakura Noir', mood: '夜桜モード', description: '墨色の背景に桜色を差した、華やかさのあるダークテーマ。', tags: ['sakura', 'dark', 'dramatic'], dark: true },
  { id: 'ink-monochrome', name: 'Ink Monochrome', mood: '白黒ミニマル', description: 'インク、紙、グレーだけで情報の階層を際立たせる無彩色テーマ。', tags: ['mono', 'minimal', 'editorial'], dark: false },
  { id: 'terminal-hacker', name: 'Terminal Hacker', mood: 'ハッカーっぽい', description: '緑のグローを効かせた、ターミナル感のあるダークテーマ。', tags: ['hacker', 'terminal', 'matrix'], dark: true },
  { id: 'amber-command', name: 'Amber Command', mood: 'レトロ端末', description: 'アンバーCRTを思わせる、渋くて強いダークコマンドライン風テーマ。', tags: ['retro', 'amber', 'command'], dark: true },
]

export const themeCatalog: MailTheme[] = META.map((meta) => ({
  ...meta,
  palette: PALETTES[meta.id],
}))

export function getThemeMeta(id: ThemeId) {
  return themeCatalog.find((theme) => theme.id === id) ?? themeCatalog[0]
}
