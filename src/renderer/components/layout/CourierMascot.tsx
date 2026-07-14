import { useState, type CSSProperties, type ReactNode } from 'react'
import { getMascotMeta, type MascotId } from '../../data/mascots'
import {
  getMascotMoodFace,
  getMascotPhase,
  type MascotCareStats,
} from '../../stores/mascotStore'

interface CourierMascotProps {
  mascotId: MascotId
  bond?: number
  care?: MascotCareStats
  className?: string
  size?: number
  stage?: 'full' | 'mini'
  spinOnClick?: boolean
}

// 中央寄せ + 奥行き。インラインtransformはクラスの-translate-x-1/2を
// 上書きしてしまうため、translateX(-50%)を必ず含める。
const centerZ = (z: number, extra = '') => `translateX(-50%) translateZ(${z}px)${extra ? ` ${extra}` : ''}`

export function CourierMascot({
  mascotId,
  bond = 0,
  care,
  className = '',
  size = 160,
  stage = 'full',
  spinOnClick = false,
}: CourierMascotProps) {
  const [spinCycle, setSpinCycle] = useState(0)
  const mascot = getMascotMeta(mascotId)
  const phase = getMascotPhase(bond)
  const phaseScale =
    phase === 'egg' ? 0.76 : phase === 'hatchling' ? 0.9 : phase === 'courier' ? 1 : phase === 'partner' ? 1.06 : 1.14
  const scale = (1 + Math.min(bond, 80) / 400) * phaseScale
  const envelopeLift = phase === 'star' ? -4 : phase === 'partner' ? -2 : 0
  const moodFace = care ? getMascotMoodFace(care) : 'calm'
  const bodyOpacity = care && care.energy <= 24 ? 0.84 : 1
  const isEgg = phase === 'egg'
  const isCourier = phase === 'courier'
  const isPartner = phase === 'partner'
  const isStar = phase === 'star'
  const showEnvelope = isCourier || isPartner || isStar
  const isMini = stage === 'mini'

  const eyeHeight = (base: number) => {
    if (moodFace === 'sleepy') return `${Math.max(base * 0.3, 1.6)}%`
    if (moodFace === 'grumpy') return `${base * 0.55}%`
    return `${base}%`
  }

  const renderEye = (opts: {
    left?: string
    right?: string
    top: string
    width: number
    color: string
    z: number
    highlight?: boolean
    bigHighlight?: boolean
  }) => {
    const { left, right, top, width, color, z, highlight = true, bigHighlight = false } = opts
    const sideStyle: CSSProperties = left ? { left } : { right }
    return (
      <>
        <div
          className="absolute rounded-full"
          style={{
            ...sideStyle,
            top,
            width: `${width}%`,
            height: eyeHeight(width),
            backgroundColor: color,
            transform: `translateZ(${z}px)`,
          }}
        />
        {highlight && moodFace !== 'sleepy' && (
          <div
            className="absolute rounded-full bg-white"
            style={{
              ...(left
                ? { left: `calc(${left} + ${width * 0.16}%)` }
                : { right: `calc(${right} + ${width * 0.44}%)` }),
              top: `calc(${top} + ${width * 0.14}%)`,
              width: `${bigHighlight ? width * 0.4 : width * 0.3}%`,
              height: `${bigHighlight ? width * 0.4 : width * 0.3}%`,
              transform: `translateZ(${z + 4}px)`,
              opacity: 0.95,
            }}
          />
        )}
        {bigHighlight && moodFace !== 'sleepy' && (
          <div
            className="absolute rounded-full bg-white"
            style={{
              ...(left
                ? { left: `calc(${left} + ${width * 0.62}%)` }
                : { right: `calc(${right} + ${width * 0.06}%)` }),
              top: `calc(${top} + ${width * 0.58}%)`,
              width: `${width * 0.2}%`,
              height: `${width * 0.2}%`,
              transform: `translateZ(${z + 4}px)`,
              opacity: 0.85,
            }}
          />
        )}
      </>
    )
  }

  const renderMouth = (opts: {
    top: string
    color: string
    z: number
    variant?: 'arc' | 'omega'
    width?: number
  }): ReactNode => {
    const { top, color, z, variant = 'arc', width = 11 } = opts
    if (moodFace === 'hungry') {
      return (
        <div
          className="absolute left-1/2 rounded-full"
          style={{
            top,
            width: `${width * 0.7}%`,
            height: `${width * 0.55}%`,
            backgroundColor: color,
            transform: centerZ(z),
          }}
        />
      )
    }
    if (moodFace === 'grumpy') {
      return (
        <div
          className="absolute left-1/2 rounded-full"
          style={{
            top: `calc(${top} + 1.5%)`,
            width: `${width}%`,
            height: '2.5px',
            backgroundColor: color,
            transform: centerZ(z, 'rotate(-7deg)'),
          }}
        />
      )
    }
    if (moodFace === 'sleepy') {
      return (
        <div
          className="absolute left-1/2 rounded-full"
          style={{
            top: `calc(${top} + 1.5%)`,
            width: `${width * 0.55}%`,
            height: '2px',
            backgroundColor: color,
            transform: centerZ(z),
            opacity: 0.85,
          }}
        />
      )
    }
    if (variant === 'omega') {
      return (
        <>
          <div
            className="absolute"
            style={{
              left: '45.2%',
              top,
              width: '5%',
              height: '3.2%',
              borderBottom: `2px solid ${color}`,
              borderRadius: '0 0 50% 50%',
              transform: `translateZ(${z}px)`,
            }}
          />
          <div
            className="absolute"
            style={{
              left: '50%',
              top,
              width: '5%',
              height: '3.2%',
              borderBottom: `2px solid ${color}`,
              borderRadius: '0 0 50% 50%',
              transform: `translateZ(${z}px)`,
            }}
          />
        </>
      )
    }
    return (
      <div
        className="absolute left-1/2"
        style={{
          top,
          width: `${width}%`,
          height: `${width * 0.45}%`,
          borderBottom: `2.5px solid ${color}`,
          borderRadius: '0 0 50% 50%',
          transform: centerZ(z),
        }}
      />
    )
  }

  const eggFace = (
    <>
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
    </>
  )

  const eggModel = (
    <>
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
    </>
  )

  const carriedEnvelope = (
    <div
      className={`absolute left-1/2 top-[60%] h-[18%] w-[34%] rounded-[16px] border-2 bg-white ${isStar ? 'mascot-star-envelope' : ''}`}
      style={{
        transform: `translateX(-50%) translateZ(58px) translateY(${envelopeLift}px)`,
        borderColor: mascot.accentSoft,
      }}
    >
      <div
        className="absolute inset-x-[8%] top-[14%] h-[2px] rounded-full"
        style={{ backgroundColor: mascot.accent }}
      />
      <div
        className="absolute left-[12%] top-[14%] h-[56%] w-[38%] origin-top-right rotate-[26deg] rounded-[16px] border-t-2"
        style={{ borderColor: mascot.accent }}
      />
      <div
        className="absolute right-[12%] top-[14%] h-[56%] w-[38%] origin-top-left rotate-[-26deg] rounded-[16px] border-t-2"
        style={{ borderColor: mascot.accent }}
      />
      <div
        className="absolute left-1/2 top-[44%] h-2.5 w-2.5 -translate-x-1/2 rounded-full"
        style={{ backgroundColor: mascot.accent }}
      />
    </div>
  )

  // マクコ: ピンクのクマのぬいぐるみ
  const bearModel = (
    <>
      {/* 耳 */}
      <div
        className="absolute left-[17%] top-[5%] h-[20%] w-[21%] mascot-bear-ear-left"
        style={{ transformStyle: 'preserve-3d' }}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{
            transform: 'translateZ(20px)',
            background: `linear-gradient(180deg, ${mascot.bodyTop} 0%, ${mascot.bodyBottom} 100%)`,
            boxShadow: `0 8px 18px ${mascot.accentSoft}`,
          }}
        />
        <div
          className="absolute left-[21%] top-[24%] h-[54%] w-[54%] rounded-full"
          style={{ transform: 'translateZ(24px)', backgroundColor: mascot.accentSoft }}
        />
      </div>
      <div
        className="absolute right-[17%] top-[5%] h-[20%] w-[21%] mascot-bear-ear-right"
        style={{ transformStyle: 'preserve-3d' }}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{
            transform: 'translateZ(20px)',
            background: `linear-gradient(180deg, ${mascot.bodyTop} 0%, ${mascot.bodyBottom} 100%)`,
            boxShadow: `0 8px 18px ${mascot.accentSoft}`,
          }}
        />
        <div
          className="absolute right-[21%] top-[24%] h-[54%] w-[54%] rounded-full"
          style={{ transform: 'translateZ(24px)', backgroundColor: mascot.accentSoft }}
        />
      </div>
      {/* 頭 */}
      <div
        className="absolute left-1/2 top-[12%] h-[42%] w-[58%] rounded-[48%]"
        style={{
          transform: centerZ(30),
          background: `linear-gradient(180deg, ${mascot.bodyTop} 0%, ${mascot.bodyBottom} 100%)`,
          boxShadow: `0 20px 38px ${mascot.accentSoft}`,
        }}
      />
      {/* 腕 */}
      <div
        className="absolute left-[15%] top-[50%] h-[18%] w-[14%] rounded-full"
        style={{ transform: 'translateZ(26px) rotate(18deg)', backgroundColor: mascot.bodyBottom }}
      />
      <div
        className="absolute right-[15%] top-[50%] h-[18%] w-[14%] rounded-full"
        style={{ transform: 'translateZ(26px) rotate(-18deg)', backgroundColor: mascot.bodyBottom }}
      />
      {/* 胴体 */}
      <div
        className="absolute left-1/2 top-[46%] h-[34%] w-[52%] rounded-[46%]"
        style={{
          transform: centerZ(22),
          background: `linear-gradient(180deg, ${mascot.bodyTop} 0%, ${mascot.bodyBottom} 100%)`,
        }}
      />
      {/* おなか */}
      <div
        className="absolute left-1/2 top-[51%] h-[22%] w-[30%] rounded-full"
        style={{ transform: centerZ(28), backgroundColor: mascot.accentSoft }}
      />
      {/* おなかのステッチ */}
      <div
        className="absolute left-[48.5%] top-[58%] h-[5%] w-[1.4%] rounded-full opacity-50"
        style={{ transform: 'translateZ(32px) rotate(45deg)', backgroundColor: mascot.accentStrong }}
      />
      <div
        className="absolute left-[48.5%] top-[58%] h-[5%] w-[1.4%] rounded-full opacity-50"
        style={{ transform: 'translateZ(32px) rotate(-45deg)', backgroundColor: mascot.accentStrong }}
      />
      {/* 足 */}
      <div
        className="absolute left-[27%] top-[72%] h-[12%] w-[16%] rounded-full"
        style={{ transform: 'translateZ(28px)', backgroundColor: mascot.bodyBottom }}
      />
      <div
        className="absolute right-[27%] top-[72%] h-[12%] w-[16%] rounded-full"
        style={{ transform: 'translateZ(28px)', backgroundColor: mascot.bodyBottom }}
      />
      <div
        className="absolute left-[31%] top-[75%] h-[6.5%] w-[8.5%] rounded-full"
        style={{ transform: 'translateZ(34px)', backgroundColor: mascot.accentSoft }}
      />
      <div
        className="absolute right-[31%] top-[75%] h-[6.5%] w-[8.5%] rounded-full"
        style={{ transform: 'translateZ(34px)', backgroundColor: mascot.accentSoft }}
      />
      {/* マズル */}
      <div
        className="absolute left-1/2 top-[34.5%] h-[15%] w-[24%] rounded-[50%]"
        style={{ transform: centerZ(42), backgroundColor: 'rgba(255,255,255,0.92)' }}
      />
      {/* 鼻 */}
      <div
        className="absolute left-1/2 top-[36.5%] h-[5.5%] w-[8%]"
        style={{
          transform: centerZ(48),
          backgroundColor: mascot.eyeColor,
          borderRadius: '50% 50% 60% 60%',
        }}
      />
      {/* 鼻下のステッチ */}
      <div
        className="absolute left-1/2 top-[41.5%] h-[3%] w-[1.4%] rounded-full"
        style={{ transform: centerZ(48), backgroundColor: mascot.eyeColor, opacity: 0.85 }}
      />
      {/* 目 */}
      {renderEye({ left: '32.5%', top: '28.5%', width: 8, color: mascot.eyeColor, z: 46 })}
      {renderEye({ right: '32.5%', top: '28.5%', width: 8, color: mascot.eyeColor, z: 46 })}
      {/* 口 */}
      {renderMouth({ top: '43.5%', color: mascot.eyeColor, z: 48, width: 10 })}
      {/* ほっぺ */}
      <div
        className="absolute left-[22%] top-[38.5%] h-[5.5%] w-[10%] rounded-full opacity-60"
        style={{ transform: 'translateZ(40px)', backgroundColor: mascot.accent }}
      />
      <div
        className="absolute right-[22%] top-[38.5%] h-[5.5%] w-[10%] rounded-full opacity-60"
        style={{ transform: 'translateZ(40px)', backgroundColor: mascot.accent }}
      />
    </>
  )

  // ミオ: 白いふわふわの子猫
  const catModel = (
    <>
      {/* しっぽ (ふさふさ) */}
      <div
        className="absolute right-[10%] top-[48%] h-[28%] w-[15%] mascot-cat-tail"
        style={{
          transform: 'translateZ(12px) rotate(38deg)',
          background: `linear-gradient(180deg, ${mascot.bodyTop} 0%, ${mascot.bodyBottom} 100%)`,
          borderRadius: '55% 45% 60% 40%',
          boxShadow: '0 4px 10px rgba(196, 178, 170, 0.35)',
        }}
      />
      {/* 頭まわりのふわ毛 (後ろのふくらみ) */}
      <div
        className="absolute left-[18%] top-[22%] h-[16%] w-[16%] rounded-full"
        style={{ transform: 'translateZ(26px)', backgroundColor: mascot.bodyTop }}
      />
      <div
        className="absolute right-[18%] top-[22%] h-[16%] w-[16%] rounded-full"
        style={{ transform: 'translateZ(26px)', backgroundColor: mascot.bodyTop }}
      />
      <div
        className="absolute left-[15%] top-[34%] h-[14%] w-[14%] rounded-full"
        style={{ transform: 'translateZ(26px)', backgroundColor: mascot.bodyTop }}
      />
      <div
        className="absolute right-[15%] top-[34%] h-[14%] w-[14%] rounded-full"
        style={{ transform: 'translateZ(26px)', backgroundColor: mascot.bodyTop }}
      />
      {/* 耳 */}
      <div
        className="absolute left-[23%] top-[4%] h-[19%] w-[18%] mascot-cat-ear-left"
        style={{ transformStyle: 'preserve-3d' }}
      >
        <div
          className="absolute inset-0"
          style={{
            transform: 'translateZ(24px)',
            background: `linear-gradient(180deg, ${mascot.bodyTop} 0%, ${mascot.bodyBottom} 100%)`,
            clipPath: 'polygon(50% 0%, 4% 100%, 96% 100%)',
          }}
        />
        <div
          className="absolute left-[19%] top-[30%] h-[62%] w-[62%]"
          style={{
            transform: 'translateZ(28px)',
            backgroundColor: mascot.accentSoft,
            clipPath: 'polygon(50% 0%, 8% 100%, 92% 100%)',
          }}
        />
      </div>
      <div
        className="absolute right-[23%] top-[4%] h-[19%] w-[18%] mascot-cat-ear-right"
        style={{ transformStyle: 'preserve-3d' }}
      >
        <div
          className="absolute inset-0"
          style={{
            transform: 'translateZ(24px)',
            background: `linear-gradient(180deg, ${mascot.bodyTop} 0%, ${mascot.bodyBottom} 100%)`,
            clipPath: 'polygon(50% 0%, 4% 100%, 96% 100%)',
          }}
        />
        <div
          className="absolute right-[19%] top-[30%] h-[62%] w-[62%]"
          style={{
            transform: 'translateZ(28px)',
            backgroundColor: mascot.accentSoft,
            clipPath: 'polygon(50% 0%, 8% 100%, 92% 100%)',
          }}
        />
      </div>
      {/* 頭 (ふわっと大きめ) */}
      <div
        className="absolute left-1/2 top-[12%] h-[43%] w-[62%]"
        style={{
          transform: centerZ(32),
          background: `linear-gradient(180deg, ${mascot.bodyTop} 0%, ${mascot.bodyBottom} 100%)`,
          borderRadius: '48% 48% 46% 46%',
          boxShadow: '0 20px 38px rgba(196, 178, 170, 0.45)',
        }}
      />
      {/* ほっぺのふわ毛 (左右3枚ずつ) */}
      <div
        className="absolute left-[13%] top-[36%] h-[7%] w-[9%]"
        style={{
          transform: 'translateZ(36px) rotate(18deg)',
          backgroundColor: mascot.bodyTop,
          borderRadius: '20% 80% 60% 40%',
        }}
      />
      <div
        className="absolute left-[12%] top-[42%] h-[6%] w-[8%]"
        style={{
          transform: 'translateZ(36px) rotate(-4deg)',
          backgroundColor: mascot.bodyTop,
          borderRadius: '20% 80% 70% 30%',
        }}
      />
      <div
        className="absolute right-[13%] top-[36%] h-[7%] w-[9%]"
        style={{
          transform: 'translateZ(36px) rotate(-18deg)',
          backgroundColor: mascot.bodyTop,
          borderRadius: '80% 20% 40% 60%',
        }}
      />
      <div
        className="absolute right-[12%] top-[42%] h-[6%] w-[8%]"
        style={{
          transform: 'translateZ(36px) rotate(4deg)',
          backgroundColor: mascot.bodyTop,
          borderRadius: '80% 20% 30% 70%',
        }}
      />
      {/* 前髪のふわ毛 (3束) */}
      <div
        className="absolute left-[38%] top-[9.5%] h-[8%] w-[7%]"
        style={{
          transform: 'translateZ(34px) rotate(-22deg)',
          backgroundColor: mascot.bodyTop,
          borderRadius: '60% 40% 30% 70%',
        }}
      />
      <div
        className="absolute left-[46%] top-[7.5%] h-[10%] w-[8%]"
        style={{
          transform: 'translateZ(36px) rotate(-6deg)',
          backgroundColor: mascot.bodyTop,
          borderRadius: '55% 45% 40% 60%',
        }}
      />
      <div
        className="absolute left-[55%] top-[9.5%] h-[8%] w-[7%]"
        style={{
          transform: 'translateZ(34px) rotate(18deg)',
          backgroundColor: mascot.bodyTop,
          borderRadius: '40% 60% 70% 30%',
        }}
      />
      {/* 胴体 (小さめ) */}
      <div
        className="absolute left-1/2 top-[50%] h-[28%] w-[46%] rounded-[48%]"
        style={{
          transform: centerZ(24),
          background: `linear-gradient(180deg, ${mascot.bodyTop} 0%, ${mascot.bodyBottom} 100%)`,
        }}
      />
      {/* 胸のふわふわ */}
      <div
        className="absolute left-[41%] top-[53%] h-[9%] w-[9%] rounded-full"
        style={{ transform: 'translateZ(30px)', backgroundColor: '#ffffff' }}
      />
      <div
        className="absolute left-[48%] top-[52%] h-[10%] w-[10%] rounded-full"
        style={{ transform: 'translateZ(30px)', backgroundColor: '#ffffff' }}
      />
      <div
        className="absolute right-[40%] top-[54%] h-[8%] w-[8%] rounded-full"
        style={{ transform: 'translateZ(30px)', backgroundColor: '#ffffff' }}
      />
      {/* 前足 */}
      <div
        className="absolute left-[34%] top-[70%] h-[9%] w-[11%] rounded-full"
        style={{ transform: 'translateZ(30px)', backgroundColor: mascot.bodyTop, boxShadow: '0 2px 6px rgba(196, 178, 170, 0.4)' }}
      />
      <div
        className="absolute right-[34%] top-[70%] h-[9%] w-[11%] rounded-full"
        style={{ transform: 'translateZ(30px)', backgroundColor: mascot.bodyTop, boxShadow: '0 2px 6px rgba(196, 178, 170, 0.4)' }}
      />
      {/* 肉球ライン */}
      <div
        className="absolute left-[38%] top-[74.5%] h-[3%] w-[1%] rounded-full opacity-40"
        style={{ transform: 'translateZ(34px)', backgroundColor: '#c9b8b0' }}
      />
      <div
        className="absolute right-[38%] top-[74.5%] h-[3%] w-[1%] rounded-full opacity-40"
        style={{ transform: 'translateZ(34px)', backgroundColor: '#c9b8b0' }}
      />
      {/* 目 (大きな赤ちゃんの瞳) */}
      {renderEye({ left: '29.5%', top: '28%', width: 11, color: mascot.eyeColor, z: 46, bigHighlight: true })}
      {renderEye({ right: '29.5%', top: '28%', width: 11, color: mascot.eyeColor, z: 46, bigHighlight: true })}
      {/* 鼻 */}
      <div
        className="absolute left-1/2 top-[40.5%] h-[3.4%] w-[5%]"
        style={{
          transform: centerZ(50),
          backgroundColor: mascot.accent,
          clipPath: 'polygon(50% 100%, 0 0, 100% 0)',
          borderRadius: '2px',
        }}
      />
      {/* 口 (ω) */}
      {renderMouth({ top: '43%', color: '#a08d86', z: 50, variant: 'omega', width: 9 })}
      {/* ひげ */}
      <div
        className="absolute left-[8%] top-[38%] h-[1.2%] w-[14%] rounded-full opacity-60"
        style={{ transform: 'translateZ(44px) rotate(5deg)', backgroundColor: '#d8cfc9' }}
      />
      <div
        className="absolute left-[8%] top-[42.5%] h-[1.2%] w-[13%] rounded-full opacity-60"
        style={{ transform: 'translateZ(44px) rotate(-4deg)', backgroundColor: '#d8cfc9' }}
      />
      <div
        className="absolute right-[8%] top-[38%] h-[1.2%] w-[14%] rounded-full opacity-60"
        style={{ transform: 'translateZ(44px) rotate(-5deg)', backgroundColor: '#d8cfc9' }}
      />
      <div
        className="absolute right-[8%] top-[42.5%] h-[1.2%] w-[13%] rounded-full opacity-60"
        style={{ transform: 'translateZ(44px) rotate(4deg)', backgroundColor: '#d8cfc9' }}
      />
      {/* ほっぺ */}
      <div
        className="absolute left-[22.5%] top-[39%] h-[5%] w-[9%] rounded-full opacity-50"
        style={{ transform: 'translateZ(42px)', backgroundColor: mascot.accent }}
      />
      <div
        className="absolute right-[22.5%] top-[39%] h-[5%] w-[9%] rounded-full opacity-50"
        style={{ transform: 'translateZ(42px)', backgroundColor: mascot.accent }}
      />
    </>
  )

  // ポスティ: レトロなポンコツブリキロボ
  const robotModel = (
    <>
      {/* アンテナ (バネコイル) */}
      <div
        className="absolute left-1/2 top-[2%] h-[13%] w-[3.4%] mascot-robot-antenna"
        style={{
          transform: centerZ(30),
          background: `repeating-linear-gradient(180deg, ${mascot.accentStrong} 0px, ${mascot.accentStrong} 2px, ${mascot.bodyTop} 2px, ${mascot.bodyTop} 4px)`,
          borderRadius: '3px',
        }}
      />
      <div
        className="absolute left-1/2 top-[-3%] h-[7%] w-[7%] rounded-full mascot-robot-beacon"
        style={{
          transform: centerZ(34),
          backgroundColor: '#ff6b6b',
          boxShadow: '0 0 10px #ff6b6b',
        }}
      />
      {/* 耳ボルト */}
      <div
        className="absolute left-[13%] top-[24%] h-[9%] w-[6%] rounded-[3px]"
        style={{ transform: 'translateZ(26px)', backgroundColor: '#8fa3c8' }}
      />
      <div
        className="absolute right-[13%] top-[24%] h-[9%] w-[6%] rounded-[3px]"
        style={{ transform: 'translateZ(26px)', backgroundColor: '#8fa3c8' }}
      />
      <div
        className="absolute left-[11%] top-[26.5%] h-[4%] w-[3%] rounded-full"
        style={{ transform: 'translateZ(28px)', backgroundColor: '#5f739c' }}
      />
      <div
        className="absolute right-[11%] top-[26.5%] h-[4%] w-[3%] rounded-full"
        style={{ transform: 'translateZ(28px)', backgroundColor: '#5f739c' }}
      />
      {/* 頭 (四角いブリキ缶) */}
      <div
        className="absolute left-1/2 top-[11%] h-[34%] w-[62%] rounded-[9px]"
        style={{
          transform: centerZ(32),
          background: `linear-gradient(180deg, ${mascot.bodyTop} 0%, ${mascot.bodyBottom} 100%)`,
          boxShadow: `0 20px 38px ${mascot.accentSoft}, inset 0 -3px 0 rgba(31, 51, 104, 0.25)`,
        }}
      />
      {/* 頭の継ぎ目とリベット */}
      <div
        className="absolute left-1/2 top-[17%] h-[2px] w-[56%] opacity-45"
        style={{ transform: centerZ(36), backgroundColor: '#2c4bb0' }}
      />
      <div
        className="absolute left-[23%] top-[13.5%] h-[2.4%] w-[2.4%] rounded-full"
        style={{ transform: 'translateZ(38px)', backgroundColor: '#5f739c' }}
      />
      <div
        className="absolute right-[23%] top-[13.5%] h-[2.4%] w-[2.4%] rounded-full"
        style={{ transform: 'translateZ(38px)', backgroundColor: '#5f739c' }}
      />
      <div
        className="absolute left-[23%] top-[40%] h-[2.4%] w-[2.4%] rounded-full"
        style={{ transform: 'translateZ(38px)', backgroundColor: '#5f739c' }}
      />
      <div
        className="absolute right-[23%] top-[40%] h-[2.4%] w-[2.4%] rounded-full"
        style={{ transform: 'translateZ(38px)', backgroundColor: '#5f739c' }}
      />
      {/* 目 (丸い電球アイ + 金属リム) */}
      <div
        className="absolute left-[29%] top-[20.5%] h-[13%] w-[13%] rounded-full"
        style={{
          transform: 'translateZ(42px)',
          background: 'linear-gradient(180deg, #8fa3c8 0%, #5f739c 100%)',
          boxShadow: 'inset 0 -2px 0 rgba(31, 51, 104, 0.4)',
        }}
      />
      <div
        className="absolute right-[29%] top-[20.5%] h-[13%] w-[13%] rounded-full"
        style={{
          transform: 'translateZ(42px)',
          background: 'linear-gradient(180deg, #8fa3c8 0%, #5f739c 100%)',
          boxShadow: 'inset 0 -2px 0 rgba(31, 51, 104, 0.4)',
        }}
      />
      <div
        className="absolute left-[31.5%] top-[23%] w-[8%]"
        style={{
          height: eyeHeight(8),
          transform: 'translateZ(45px)',
          backgroundColor: mascot.eyeColor,
          borderRadius: '50%',
          boxShadow: `0 0 10px ${mascot.eyeColor}`,
        }}
      />
      <div
        className="absolute right-[31.5%] top-[23%] w-[8%]"
        style={{
          height: eyeHeight(8),
          transform: 'translateZ(45px)',
          backgroundColor: mascot.eyeColor,
          borderRadius: '50%',
          boxShadow: `0 0 10px ${mascot.eyeColor}`,
        }}
      />
      {/* 口 (スピーカーグリル / 不機嫌時は表情) */}
      {moodFace === 'grumpy' || moodFace === 'hungry' || moodFace === 'sleepy' ? (
        renderMouth({ top: '37%', color: '#2c4bb0', z: 45, width: 9 })
      ) : (
        <>
          <div
            className="absolute left-[43%] top-[36.5%] h-[5.5%] w-[2%] rounded-full"
            style={{ transform: 'translateZ(44px)', backgroundColor: '#2c4bb0', opacity: 0.75 }}
          />
          <div
            className="absolute left-[47.5%] top-[35.5%] h-[7.5%] w-[2%] rounded-full"
            style={{ transform: 'translateZ(44px)', backgroundColor: '#2c4bb0', opacity: 0.75 }}
          />
          <div
            className="absolute left-[52%] top-[36.5%] h-[5.5%] w-[2%] rounded-full"
            style={{ transform: 'translateZ(44px)', backgroundColor: '#2c4bb0', opacity: 0.75 }}
          />
        </>
      )}
      {/* チークのネジ */}
      <div
        className="absolute left-[25.5%] top-[35%] h-[3.6%] w-[3.6%] rounded-full opacity-90"
        style={{ transform: 'translateZ(42px)', backgroundColor: '#8fa3c8' }}
      />
      <div
        className="absolute right-[25.5%] top-[35%] h-[3.6%] w-[3.6%] rounded-full opacity-90"
        style={{ transform: 'translateZ(42px)', backgroundColor: '#8fa3c8' }}
      />
      {/* へこみ傷 (ポンコツ感) */}
      <div
        className="absolute right-[26%] top-[15%] h-[1.6%] w-[8%] rounded-full opacity-40"
        style={{ transform: 'translateZ(38px) rotate(-18deg)', backgroundColor: '#2c4bb0' }}
      />
      <div
        className="absolute right-[28%] top-[17.5%] h-[1.4%] w-[5%] rounded-full opacity-30"
        style={{ transform: 'translateZ(38px) rotate(-18deg)', backgroundColor: '#2c4bb0' }}
      />
      {/* 首 (ジャバラ) */}
      <div
        className="absolute left-1/2 top-[45.5%] h-[7%] w-[18%] rounded-[4px]"
        style={{
          transform: centerZ(22),
          background: `repeating-linear-gradient(180deg, #8fa3c8 0px, #8fa3c8 3px, ${mascot.accentStrong} 3px, ${mascot.accentStrong} 6px)`,
        }}
      />
      {/* 腕 (筒型 + 継ぎ目) */}
      <div
        className="absolute left-[15%] top-[53%] h-[19%] w-[9%] rounded-[10px]"
        style={{
          transform: 'translateZ(18px) rotate(-10deg)',
          background: `repeating-linear-gradient(180deg, ${mascot.accentStrong} 0px, ${mascot.accentStrong} 7px, #3557c4 7px, #3557c4 9px)`,
        }}
      />
      <div
        className="absolute right-[15%] top-[53%] h-[19%] w-[9%] rounded-[10px]"
        style={{
          transform: 'translateZ(18px) rotate(10deg)',
          background: `repeating-linear-gradient(180deg, ${mascot.accentStrong} 0px, ${mascot.accentStrong} 7px, #3557c4 7px, #3557c4 9px)`,
        }}
      />
      {/* ハサミ型ハンド */}
      <div
        className="absolute left-[12.5%] top-[70%] h-[6.5%] w-[8%]"
        style={{
          transform: 'translateZ(20px) rotate(-10deg)',
          backgroundColor: '#8fa3c8',
          clipPath: 'polygon(0 0, 38% 0, 38% 55%, 62% 55%, 62% 0, 100% 0, 100% 100%, 0 100%)',
          borderRadius: '3px',
        }}
      />
      <div
        className="absolute right-[12.5%] top-[70%] h-[6.5%] w-[8%]"
        style={{
          transform: 'translateZ(20px) rotate(10deg)',
          backgroundColor: '#8fa3c8',
          clipPath: 'polygon(0 0, 38% 0, 38% 55%, 62% 55%, 62% 0, 100% 0, 100% 100%, 0 100%)',
          borderRadius: '3px',
        }}
      />
      {/* 胴体 (角ばった缶ボディ) */}
      <div
        className="absolute left-1/2 top-[50%] h-[27%] w-[52%] rounded-[8px]"
        style={{
          transform: centerZ(24),
          background: `linear-gradient(180deg, ${mascot.bodyTop} 0%, ${mascot.bodyBottom} 100%)`,
          boxShadow: 'inset 0 -3px 0 rgba(31, 51, 104, 0.25)',
        }}
      />
      {/* 胴体リベット */}
      <div
        className="absolute left-[27%] top-[52%] h-[2.2%] w-[2.2%] rounded-full"
        style={{ transform: 'translateZ(30px)', backgroundColor: '#5f739c' }}
      />
      <div
        className="absolute right-[27%] top-[52%] h-[2.2%] w-[2.2%] rounded-full"
        style={{ transform: 'translateZ(30px)', backgroundColor: '#5f739c' }}
      />
      {/* 郵便受けスロット (胸) */}
      <div
        className="absolute left-1/2 top-[54.5%] h-[4.5%] w-[26%] rounded-[3px]"
        style={{ transform: centerZ(30), backgroundColor: '#1d3464' }}
      />
      <div
        className="absolute left-1/2 top-[55.4%] h-[2.6%] w-[21%] rounded-[2px] bg-white"
        style={{ transform: centerZ(32), opacity: 0.95 }}
      />
      {/* アナログメーター */}
      <div
        className="absolute left-[35%] top-[62%] h-[9%] w-[12%] rounded-full"
        style={{
          transform: 'translateZ(30px)',
          backgroundColor: '#f4f0e4',
          boxShadow: 'inset 0 0 0 2px #5f739c',
        }}
      />
      <div
        className="absolute left-[40%] top-[64%] h-[4%] w-[1.4%] rounded-full"
        style={{ transform: 'translateZ(32px) rotate(36deg)', transformOrigin: 'center bottom', backgroundColor: '#e0524d' }}
      />
      {/* ゼンマイ (側面) */}
      <div
        className="absolute right-[20%] top-[59%] h-[7%] w-[7%] rounded-full"
        style={{ transform: 'translateZ(28px)', backgroundColor: '#8fa3c8', boxShadow: 'inset 0 0 0 2px #5f739c' }}
      />
      <div
        className="absolute right-[22.5%] top-[57%] h-[11%] w-[2%] rounded-full"
        style={{ transform: 'translateZ(27px)', backgroundColor: '#5f739c' }}
      />
      {/* サビ (ポンコツ感) */}
      <div
        className="absolute right-[29%] top-[71%] h-[3%] w-[5%] rounded-full opacity-60"
        style={{ transform: 'translateZ(28px)', backgroundColor: '#b08a5a' }}
      />
      <div
        className="absolute right-[27%] top-[73%] h-[2%] w-[3.4%] rounded-full opacity-45"
        style={{ transform: 'translateZ(28px)', backgroundColor: '#b08a5a' }}
      />
      {/* 足 (ずんどうな筒足 + 大きな台座) */}
      <div
        className="absolute left-[33%] top-[75.5%] h-[6%] w-[10%]"
        style={{ transform: 'translateZ(20px)', backgroundColor: mascot.accentStrong, borderRadius: '3px' }}
      />
      <div
        className="absolute right-[33%] top-[75.5%] h-[6%] w-[10%]"
        style={{ transform: 'translateZ(20px)', backgroundColor: mascot.accentStrong, borderRadius: '3px' }}
      />
      <div
        className="absolute left-[28%] top-[80%] h-[4.5%] w-[17%] rounded-[4px]"
        style={{ transform: 'translateZ(22px)', backgroundColor: '#2c4bb0', boxShadow: 'inset 0 -2px 0 rgba(20, 36, 73, 0.5)' }}
      />
      <div
        className="absolute right-[28%] top-[80%] h-[4.5%] w-[17%] rounded-[4px]"
        style={{ transform: 'translateZ(22px)', backgroundColor: '#2c4bb0', boxShadow: 'inset 0 -2px 0 rgba(20, 36, 73, 0.5)' }}
      />
    </>
  )

  // サエタ: 緑の小鳥
  const birdModel = (
    <>
      {/* しっぽ (3枚羽) */}
      <div
        className="absolute right-[4%] top-[48%] h-[20%] w-[24%] mascot-bird-tail"
        style={{ transform: 'translateZ(8px) rotate(28deg)', transformStyle: 'preserve-3d' }}
      >
        <div
          className="absolute left-[12%] top-[0%] h-[38%] w-[86%]"
          style={{
            transform: 'translateZ(0px) rotate(-14deg)',
            backgroundColor: mascot.accentStrong,
            borderRadius: '30% 70% 70% 30%',
          }}
        />
        <div
          className="absolute left-[8%] top-[30%] h-[40%] w-[92%]"
          style={{
            transform: 'translateZ(2px)',
            backgroundColor: mascot.accent,
            borderRadius: '30% 70% 70% 30%',
          }}
        />
        <div
          className="absolute left-[12%] top-[60%] h-[38%] w-[84%]"
          style={{
            transform: 'translateZ(1px) rotate(14deg)',
            backgroundColor: mascot.bodyBottom,
            borderRadius: '30% 70% 70% 30%',
          }}
        />
      </div>
      {/* 翼 (羽先に切り込み) */}
      <div
        className="absolute left-[1%] top-[35%] h-[26%] w-[31%] mascot-bird-wing-left"
        style={{
          transform: 'translateZ(20px) rotate(-24deg)',
          background: `linear-gradient(120deg, ${mascot.accentStrong} 0%, ${mascot.accent} 100%)`,
          borderRadius: '70% 30% 20% 50%',
          clipPath: 'polygon(0 0, 100% 0, 100% 55%, 78% 68%, 88% 82%, 60% 88%, 66% 100%, 30% 96%, 0 78%)',
        }}
      />
      <div
        className="absolute right-[1%] top-[35%] h-[26%] w-[31%] mascot-bird-wing-right"
        style={{
          transform: 'translateZ(20px) rotate(24deg)',
          background: `linear-gradient(240deg, ${mascot.accentStrong} 0%, ${mascot.accent} 100%)`,
          borderRadius: '30% 70% 50% 20%',
          clipPath: 'polygon(0 0, 100% 0, 100% 78%, 70% 96%, 34% 100%, 40% 88%, 12% 82%, 22% 68%, 0 55%)',
        }}
      />
      {/* 頭の冠羽 (3枚) */}
      <div
        className="absolute left-[38%] top-[7%] h-[11%] w-[6.5%]"
        style={{
          transform: 'translateZ(24px) rotate(-26deg)',
          backgroundColor: mascot.accentStrong,
          borderRadius: '60% 40% 20% 60%',
        }}
      />
      <div
        className="absolute left-[46.5%] top-[3.5%] h-[14%] w-[7%]"
        style={{
          transform: 'translateZ(26px) rotate(-4deg)',
          backgroundColor: mascot.accent,
          borderRadius: '55% 45% 25% 55%',
        }}
      />
      <div
        className="absolute left-[55%] top-[6.5%] h-[11%] w-[6.5%]"
        style={{
          transform: 'translateZ(24px) rotate(18deg)',
          backgroundColor: mascot.bodyBottom,
          borderRadius: '40% 60% 60% 20%',
        }}
      />
      {/* 体 (しずく型・頭と一体) */}
      <div
        className="absolute left-1/2 top-[15%] h-[60%] w-[56%]"
        style={{
          transform: centerZ(28),
          background: `linear-gradient(180deg, ${mascot.bodyTop} 0%, ${mascot.bodyBottom} 100%)`,
          borderRadius: '50% 50% 44% 44%',
          boxShadow: `0 20px 38px ${mascot.accentSoft}`,
        }}
      />
      {/* 頬から下のおなか (クリーム色) */}
      <div
        className="absolute left-1/2 top-[42%] h-[30%] w-[38%]"
        style={{
          transform: centerZ(34),
          backgroundColor: '#f7fbec',
          borderRadius: '48% 48% 46% 46%',
        }}
      />
      {/* おなかの羽模様 */}
      <div
        className="absolute left-[43%] top-[60%] h-[4%] w-[6%] rounded-full opacity-40"
        style={{ transform: 'translateZ(36px)', backgroundColor: mascot.accent }}
      />
      <div
        className="absolute right-[43%] top-[63%] h-[4%] w-[6%] rounded-full opacity-40"
        style={{ transform: 'translateZ(36px)', backgroundColor: mascot.accent }}
      />
      {/* 目 */}
      {renderEye({ left: '28.5%', top: '28%', width: 10, color: mascot.eyeColor, z: 44, bigHighlight: true })}
      {renderEye({ right: '28.5%', top: '28%', width: 10, color: mascot.eyeColor, z: 44, bigHighlight: true })}
      {/* くちばし (上下2枚) */}
      <div
        className="absolute left-1/2 top-[36.5%] h-[6%] w-[13%]"
        style={{
          transform: centerZ(48),
          background: 'linear-gradient(180deg, #ffc266 0%, #ff9f3d 100%)',
          clipPath: 'polygon(0 30%, 50% 0, 100% 30%, 50% 100%)',
          borderRadius: '4px',
        }}
      />
      <div
        className="absolute left-1/2 top-[41%] h-[3%] w-[7%]"
        style={{
          transform: centerZ(46),
          backgroundColor: '#e8862e',
          clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
        }}
      />
      {/* ほっぺ */}
      <div
        className="absolute left-[21%] top-[38.5%] h-[5%] w-[9%] rounded-full opacity-60"
        style={{ transform: 'translateZ(40px)', backgroundColor: '#ffb5c2' }}
      />
      <div
        className="absolute right-[21%] top-[38.5%] h-[5%] w-[9%] rounded-full opacity-60"
        style={{ transform: 'translateZ(40px)', backgroundColor: '#ffb5c2' }}
      />
      {/* 口 (ごきげんが悪いときだけ表示) */}
      {(moodFace === 'grumpy' || moodFace === 'hungry' || moodFace === 'sleepy') &&
        renderMouth({ top: '46%', color: '#5a7a55', z: 46, width: 8 })}
      {/* 足 (3本指) */}
      <div
        className="absolute left-[37%] top-[73%] h-[9%] w-[8%]"
        style={{
          transform: 'translateZ(26px)',
          backgroundColor: '#ff9f3d',
          clipPath: 'polygon(34% 0, 66% 0, 66% 55%, 100% 100%, 62% 82%, 50% 100%, 38% 82%, 0 100%, 34% 55%)',
        }}
      />
      <div
        className="absolute right-[37%] top-[73%] h-[9%] w-[8%]"
        style={{
          transform: 'translateZ(26px)',
          backgroundColor: '#ff9f3d',
          clipPath: 'polygon(34% 0, 66% 0, 66% 55%, 100% 100%, 62% 82%, 50% 100%, 38% 82%, 0 100%, 34% 55%)',
        }}
      />
    </>
  )

  const courierGear = (
    <>
      <div
        className="absolute left-1/2 top-[9%] h-[8%] w-[36%] rounded-[14px] mascot-courier-cap"
        style={{
          transform: 'translateX(-50%) translateZ(56px) rotate(-2deg)',
          background: `linear-gradient(180deg, ${mascot.accent} 0%, ${mascot.accentStrong} 100%)`,
        }}
      />
      <div
        className="absolute left-1/2 top-[14.5%] h-[3.5%] w-[46%] rounded-full mascot-courier-strap"
        style={{
          transform: 'translateX(-50%) translateZ(54px)',
          backgroundColor: mascot.accentStrong,
          opacity: 0.9,
        }}
      />
    </>
  )

  const partnerGear = (
    <>
      {courierGear}
      <div
        className="absolute left-1/2 top-[52%] h-[7%] w-[46%] rounded-[18px] mascot-partner-scarf"
        style={{
          transform: 'translateX(-50%) translateZ(60px)',
          background: `linear-gradient(90deg, ${mascot.accentSoft} 0%, ${mascot.accent} 100%)`,
        }}
      />
      <div
        className="absolute left-[60%] top-[55%] h-[13%] w-[7%] rounded-full"
        style={{
          transform: 'translateZ(58px) rotate(16deg)',
          backgroundColor: mascot.accent,
        }}
      />
    </>
  )

  const starGear = (
    <>
      {partnerGear}
      <div
        className="absolute left-1/2 top-[8%] h-[74%] w-[74%] rounded-full border mascot-star-halo"
        style={{
          transform: centerZ(10),
          borderColor: mascot.accentSoft,
          boxShadow: `0 0 28px ${mascot.accentSoft}`,
        }}
      />
    </>
  )

  const modelScene =
    mascot.model === 'bear'
      ? bearModel
      : mascot.model === 'cat'
        ? catModel
        : mascot.model === 'robot'
          ? robotModel
          : birdModel

  const keepRobotIdentity = mascot.id === 'posty'
  const phaseScene = isEgg && !keepRobotIdentity ? eggModel : modelScene
  const phaseFace = isEgg && !keepRobotIdentity ? eggFace : null
  const phaseGear =
    isMini || isEgg ? null : isStar ? starGear : isPartner ? partnerGear : isCourier ? courierGear : null

  return (
    <div
      className={`relative mascot-stage mascot-model-${mascot.model} ${
        isStar ? 'mascot-phase-star-stage' : ''
      } ${spinOnClick ? 'mascot-stage-interactive' : ''} ${className}`}
      style={{ width: size, height: size, perspective: size * 4, opacity: bodyOpacity }}
      onClick={spinOnClick ? () => setSpinCycle((cycle) => cycle + 1) : undefined}
      title={spinOnClick ? 'クリックでくるっと回る' : undefined}
    >
      <div className="absolute inset-0 rounded-full blur-2xl opacity-70"
        style={{
          background: `radial-gradient(circle, ${mascot.accentSoft} 0%, rgba(255,255,255,0) 68%)`,
        }}
      />
      <div
        key={spinCycle}
        className={`absolute inset-0 mascot-spin-shell ${spinCycle > 0 ? 'mascot-spin-once' : ''}`}
      >
        <div
          // filter/opacityをここに置くとpreserve-3dが平面化されて回転時の背面が消えるため、外側のステージ要素に掛ける
          className={`absolute inset-0 mascot-tilt mascot-idle-${mascot.model} mascot-phase-${phase}`}
          style={{ transformStyle: 'preserve-3d' }}
        >
          <div
            className="absolute inset-0"
            style={{ transformStyle: 'preserve-3d', transform: `scale(${scale})` }}
          >
            <div
              className="absolute left-1/2 top-[84%] h-6 w-[46%] -translate-x-1/2 rounded-full opacity-30 blur-sm"
              style={{ backgroundColor: mascot.accent }}
            />
            {phaseScene}
            {phaseGear}
            {phaseFace}
            {moodFace === 'dirty' && (
              <>
                <div
                  className="absolute left-[18%] top-[62%] h-3 w-3 rounded-full opacity-80"
                  style={{ transform: 'translateZ(58px)', backgroundColor: '#d9c1a4' }}
                />
                <div
                  className="absolute right-[18%] top-[66%] h-2.5 w-2.5 rounded-full opacity-75"
                  style={{ transform: 'translateZ(58px)', backgroundColor: '#d9c1a4' }}
                />
              </>
            )}
            {!isMini && showEnvelope && carriedEnvelope}
          </div>
        </div>
      </div>
    </div>
  )
}
