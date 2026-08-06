import { getMascotMeta, type MascotId } from '../../data/mascots'

interface EggMascotProps {
  mascotId: MascotId
  size?: number
  spinSignal?: number
  className?: string
}

/**
 * 孵化前（bondがegg段階）のたまご。旧CourierMascotのeggModel/eggFaceを
 * そのまま引き継いだ軽量コンポーネントで、キャラ本体は同梱MODが描画する。
 * MODが読み込めないときのフォールバック表示も兼ねる。
 */
export function EggMascot({ mascotId, size = 96, spinSignal = 0, className = '' }: EggMascotProps) {
  const mascot = getMascotMeta(mascotId)
  // 中央寄せ + 奥行き。インラインtransformはクラスの-translate-x-1/2を上書きするためtranslateX(-50%)を必ず含める
  const centerZ = (z: number) => `translateX(-50%) translateZ(${z}px)`

  return (
    <div
      className={`mascot-stage relative shrink-0 ${className}`}
      style={{ width: size, height: size, perspective: size * 4, transformStyle: 'preserve-3d' }}
      data-character-renderer="egg"
    >
      <div
        key={spinSignal}
        className={`absolute inset-0 ${spinSignal > 0 ? 'mascot-spin-once' : ''}`}
        style={{ transformStyle: 'preserve-3d' }}
      >
        <div className="absolute inset-0 mascot-phase-egg" style={{ transformStyle: 'preserve-3d' }}>
          {/* Z層は組み込み時代と同じくサイズ比例で伸縮させる(96px時の見え方が基準) */}
          <div
            className="absolute inset-0"
            style={{ transformStyle: 'preserve-3d', transform: `scale3d(1, 1, ${size / 96})` }}
          >
            <div
              className="absolute left-1/2 top-[18%] h-[56%] w-[50%] rounded-[48%] mascot-egg-wobble"
              style={{
                transform: centerZ(28),
                background: `linear-gradient(180deg, ${mascot.bodyTop} 0%, ${mascot.bodyBottom} 100%)`,
                boxShadow: `0 22px 38px ${mascot.accentSoft}`,
              }}
            />
            <div
              className="absolute left-1/2 top-[52%] h-[26%] w-[56%] rounded-[46%]"
              style={{
                transform: centerZ(46),
                background: 'linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(255,245,238,0.98) 100%)',
                border: `2px solid ${mascot.accentSoft}`,
                clipPath: 'polygon(0 28%, 12% 20%, 24% 30%, 38% 18%, 50% 30%, 62% 18%, 74% 30%, 88% 20%, 100% 28%, 100% 100%, 0 100%)',
              }}
            />
            <div
              className="absolute left-[31%] top-[24%] h-[8%] w-[10%] rounded-full"
              style={{ transform: 'translateZ(44px)', backgroundColor: mascot.accentSoft, opacity: 0.88 }}
            />
            <div
              className="absolute right-[28%] top-[28%] h-[6%] w-[8%] rounded-full"
              style={{ transform: 'translateZ(44px)', backgroundColor: mascot.accent, opacity: 0.8 }}
            />
            <div
              className="absolute left-[44%] top-[17%] h-[8%] w-[12%] rounded-[40%_40%_80%_80%]"
              style={{
                transform: 'translateZ(38px)',
                backgroundColor: mascot.accent,
                clipPath:
                  mascot.model === 'bird'
                    ? 'polygon(50% 0, 100% 100%, 0 100%)'
                    : mascot.model === 'robot'
                      ? 'polygon(48% 0, 62% 0, 62% 70%, 100% 70%, 100% 100%, 0 100%, 0 70%, 48% 70%)'
                      : mascot.model === 'cat'
                        ? 'polygon(0 100%, 20% 20%, 44% 100%, 56% 100%, 80% 20%, 100% 100%)'
                        : 'polygon(0 100%, 0 45%, 14% 8%, 32% 26%, 50% 34%, 68% 26%, 86% 8%, 100% 45%, 100% 100%)',
              }}
            />
            {/* 顔 */}
            <div
              className="absolute left-[34%] top-[37%] h-[7%] w-[7%] rounded-full"
              style={{ transform: 'translateZ(54px)', backgroundColor: mascot.eyeColor }}
            />
            <div
              className="absolute right-[34%] top-[37%] h-[7%] w-[7%] rounded-full"
              style={{ transform: 'translateZ(54px)', backgroundColor: mascot.eyeColor }}
            />
            <div
              className="absolute left-1/2 top-[48%] h-[3%] w-[14%] rounded-full"
              style={{ transform: centerZ(58), backgroundColor: mascot.eyeColor }}
            />
            <div
              className="absolute left-[28%] top-[46%] h-[5%] w-[7%] rounded-full opacity-80"
              style={{ transform: 'translateZ(42px)', backgroundColor: mascot.accentSoft }}
            />
            <div
              className="absolute right-[28%] top-[46%] h-[5%] w-[7%] rounded-full opacity-80"
              style={{ transform: 'translateZ(42px)', backgroundColor: mascot.accentSoft }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
