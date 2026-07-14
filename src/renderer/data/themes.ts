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

export interface MailTheme {
  id: ThemeId
  name: string
  mood: string
  description: string
  tags: string[]
  swatches: [string, string, string]
}

export const themeCatalog: MailTheme[] = [
  {
    id: 'petal-pop',
    name: 'Petal Pop',
    mood: 'かわいい定番',
    description: 'やわらかいピンクで、相棒の愛らしさを主役にする標準テーマ。',
    tags: ['cute', 'soft', 'default'],
    swatches: ['#ff8aa0', '#ffd6df', '#fff6f8'],
  },
  {
    id: 'peach-soda',
    name: 'Peach Soda',
    mood: 'ポップで元気',
    description: 'もも色とソーダの抜け感で、通知や送信演出を明るく見せるテーマ。',
    tags: ['pop', 'fresh', 'bright'],
    swatches: ['#ff9f7a', '#ffd86b', '#fff4df'],
  },
  {
    id: 'mint-candy',
    name: 'Mint Candy',
    mood: '軽やかクール',
    description: 'ミントとアイスブルーで、爽やかに整理された印象をつくるテーマ。',
    tags: ['mint', 'clean', 'airy'],
    swatches: ['#55c5d8', '#8ee7d0', '#eefcfa'],
  },
  {
    id: 'paper-latte',
    name: 'Paper Latte',
    mood: '手帳っぽい',
    description: '紙とミルクティーの雰囲気で、毎日使う道具感を高めるテーマ。',
    tags: ['notebook', 'warm', 'calm'],
    swatches: ['#b88a6a', '#e6c4a8', '#f8f1e7'],
  },
  {
    id: 'sunset-drive',
    name: 'Sunset Drive',
    mood: '夕焼けネオン',
    description: '夕暮れグラデーションで、送受信の演出を少し派手に見せるテーマ。',
    tags: ['sunset', 'vivid', 'neon'],
    swatches: ['#ff6f91', '#ff9671', '#ffc75f'],
  },
  {
    id: 'moon-arcade',
    name: 'Moon Arcade',
    mood: 'サイバーかわいい',
    description: '紫とシアンを混ぜた、ゲームっぽい夜景トーンのテーマ。',
    tags: ['arcade', 'cyber', 'night'],
    swatches: ['#8d7dff', '#49d6ff', '#1d2342'],
  },
  {
    id: 'ocean-letter',
    name: 'Ocean Letter',
    mood: '深海ブルー',
    description: '澄んだ青と白波のコントラストで、長文メールを落ち着いて読めるテーマ。',
    tags: ['ocean', 'blue', 'focused'],
    swatches: ['#277da1', '#72c7df', '#edfaff'],
  },
  {
    id: 'lavender-fog',
    name: 'Lavender Fog',
    mood: '静かな紫',
    description: 'ラベンダーと薄霧のグレーで、やわらかさと知的な静けさを両立。',
    tags: ['lavender', 'quiet', 'elegant'],
    swatches: ['#8c73c9', '#c9bce8', '#f7f4fc'],
  },
  {
    id: 'forest-post',
    name: 'Forest Post',
    mood: '森の郵便局',
    description: '深い常緑色と苔色、生成りの紙を組み合わせた自然派テーマ。',
    tags: ['forest', 'organic', 'calm'],
    swatches: ['#39735a', '#91b879', '#f3f3e7'],
  },
  {
    id: 'lemon-station',
    name: 'Lemon Station',
    mood: '明るい黄色',
    description: 'レモンイエローと濃紺で、軽快さを保ちながら文字をくっきり見せるテーマ。',
    tags: ['lemon', 'cheerful', 'clear'],
    swatches: ['#f4c430', '#20304a', '#fffbea'],
  },
  {
    id: 'sakura-noir',
    name: 'Sakura Noir',
    mood: '夜桜モード',
    description: '墨色の背景に桜色を差した、華やかさのあるダークテーマ。',
    tags: ['sakura', 'dark', 'dramatic'],
    swatches: ['#ff7aa8', '#241923', '#ffd1df'],
  },
  {
    id: 'ink-monochrome',
    name: 'Ink Monochrome',
    mood: '白黒ミニマル',
    description: 'インク、紙、グレーだけで情報の階層を際立たせる無彩色テーマ。',
    tags: ['mono', 'minimal', 'editorial'],
    swatches: ['#262626', '#a8a8a8', '#f7f7f4'],
  },
  {
    id: 'terminal-hacker',
    name: 'Terminal Hacker',
    mood: 'ハッカーっぽい',
    description: '緑のグローを効かせた、ターミナル感のあるテーマ。',
    tags: ['hacker', 'terminal', 'matrix'],
    swatches: ['#2dee87', '#0f1f19', '#89ffd0'],
  },
  {
    id: 'amber-command',
    name: 'Amber Command',
    mood: 'レトロ端末',
    description: 'アンバーCRTを思わせる、渋くて強いコマンドライン風テーマ。',
    tags: ['retro', 'amber', 'command'],
    swatches: ['#ffb347', '#2a1806', '#ffe4b3'],
  },
]

export function getThemeMeta(id: ThemeId) {
  return themeCatalog.find((theme) => theme.id === id) ?? themeCatalog[0]
}
