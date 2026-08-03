import { useState, type CSSProperties, type ReactNode } from 'react'
import { motionForPose } from '../../characters/types'
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
  pose?: number
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
  pose = 0,
}: CourierMascotProps) {
  const [spinCycle, setSpinCycle] = useState(0)
  const mascot = getMascotMeta(mascotId)
  const phase = getMascotPhase(bond)
  const phaseScale =
    phase === 'egg' ? 0.76 : phase === 'hatchling' ? 0.9 : phase === 'courier' ? 1 : phase === 'partner' ? 1.06 : 1.14
  const scale = (1 + Math.min(bond, 80) / 400) * phaseScale
  // 居眠りポーズ中はお世話状態に関係なく眠り顔(目を閉じる)にする
  const moodFace =
    motionForPose(pose) === 'rest' ? 'sleepy' : care ? getMascotMoodFace(care) : 'calm'
  const bodyOpacity = care && care.energy <= 24 ? 0.84 : 1
  const isEgg = phase === 'egg'
  const isCourier = phase === 'courier'
  const isPartner = phase === 'partner'
  const isStar = phase === 'star'
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

  // ミオ: 完成形ベクトル版(mio-vector-preview.html の340px基準レイアウトを%へ換算して移植)
  // 頭は元絵トレースのSVG輪郭+カール耳、他パーツはDOM。z-indexで前後を決める
  // 平面レイヤー1枚として描くため、親のpreserve-3dから切り離す(translateZは層全体へ)
  const mioFurBody = 'linear-gradient(180deg, #fffdfa 0%, #f8f0e9 76%, #e7ded9 100%)'
  const mioFurLimb = 'linear-gradient(180deg, #fffdfa 0%, #f8f0e9 72%, #e7ded9 100%)'
  const mioOutline =
    'drop-shadow(1px 0 0 rgba(98,91,94,.34)) drop-shadow(-1px 0 0 rgba(98,91,94,.34)) drop-shadow(0 1px 0 rgba(98,91,94,.34)) drop-shadow(0 -1px 0 rgba(98,91,94,.34))'
  const mioMarkGradient = 'linear-gradient(160deg, #87878a 0 10%, #aeabad 45%, transparent 85%)'
  const mioStripeGradient = 'linear-gradient(180deg, #87878a 0, #aeabad 58%, transparent 100%)'
  // 頭は「耳なしベース+左耳+右耳」の3パーツ構成(トレース輪郭から耳の頂点列を分離)。
  // 耳はグループごと付け根を支点に動かせる。付け根の接合線(chord)は無ストロークで
  // 頭と同色にし、輪郭線は可視エッジだけ別パスで描いて継ぎ目を消す
  const mioHeadBasePath =
    'M 61 131 L 52 127 L 55 149 L 44 142 L 55 171 L 33 166 L 37 200 L 49 219 L 32 219 L 50 230 L 33 245 L 50 250 L 40 271 L 50 269 L 43 292 L 24 310 L 33 311 L 34 317 L 16 326 L 31 336 L 0 367 L 6 386 L 26 405 L 19 411 L 17 425 L 41 443 L 40 449 L 30 453 L 49 475 L 68 483 L 64 497 L 101 507 L 96 518 L 128 526 L 129 535 L 167 541 L 168 547 L 203 551 C 275 571 414 574 485 558 L 550 547 L 558 538 L 588 535 L 591 526 L 622 518 L 616 508 L 629 503 L 649 507 L 656 499 L 652 483 L 672 475 L 691 451 L 682 451 L 678 444 L 708 418 L 709 412 L 697 411 L 695 404 L 708 394 L 720 369 L 688 336 L 689 331 L 704 326 L 691 318 L 696 311 L 681 299 L 667 274 L 672 269 L 681 275 L 671 251 L 689 245 L 669 234 L 686 220 L 674 219 L 673 214 L 681 204 L 687 164 L 665 171 L 675 147 L 662 153 L 668 127 L 659 130 L 647 136 L 635 122 L 621 134 L 609 116 L 595 132 L 583 112 L 569 128 L 558 108 L 545 122 L 535 100 L 523 112 L 502 90 L 465 62 L 442 55 L 416 58 L 395 42 L 367 35 L 327 40 L 303 56 L 275 53 L 259 57 L 212 89 L 198 112 L 186 100 L 176 122 L 163 108 L 152 128 L 138 112 L 126 132 L 112 116 L 100 134 L 86 122 L 74 136 L 61 131 Z'
  // 顔の輪郭線: 耳の前を横切るふさ毛区間には線を引かない。
  // 頬〜あご〜反対側の大回りと、耳の間の額のふさ毛ラインだけをストロークする
  const mioHeadEdgePath =
    'M 61 131 L 52 127 L 55 149 L 44 142 L 55 171 L 33 166 L 37 200 L 49 219 L 32 219 L 50 230 L 33 245 L 50 250 L 40 271 L 50 269 L 43 292 L 24 310 L 33 311 L 34 317 L 16 326 L 31 336 L 0 367 L 6 386 L 26 405 L 19 411 L 17 425 L 41 443 L 40 449 L 30 453 L 49 475 L 68 483 L 64 497 L 101 507 L 96 518 L 128 526 L 129 535 L 167 541 L 168 547 L 203 551 C 275 571 414 574 485 558 L 550 547 L 558 538 L 588 535 L 591 526 L 622 518 L 616 508 L 629 503 L 649 507 L 656 499 L 652 483 L 672 475 L 691 451 L 682 451 L 678 444 L 708 418 L 709 412 L 697 411 L 695 404 L 708 394 L 720 369 L 688 336 L 689 331 L 704 326 L 691 318 L 696 311 L 681 299 L 667 274 L 672 269 L 681 275 L 671 251 L 689 245 L 669 234 L 686 220 L 674 219 L 673 214 L 681 204 L 687 164 L 665 171 L 675 147 L 662 153 L 668 127 L 659 130 M 502 90 L 465 62 L 442 55 L 416 58 L 395 42 L 367 35 L 327 40 L 303 56 L 275 53 L 259 57 L 212 89'
  // 塗りは付け根より下へ大きく延長する(頭の裏に隠れる)。ふさ毛ジグザグの谷との間に
  // 透明な隙間ができないようにするための下敷き
  const mioEarLeftFillPath =
    'M 61 131 L 78 82 L 103 45 L 146 10 L 188 0 L 209 7 L 224 28 L 224 47 L 217 57 L 208 59 L 199 47 L 194 57 L 198 78 L 212 89 L 222 125 L 205 162 L 160 180 L 105 176 L 66 156 Z'
  const mioEarLeftEdgePath =
    'M 212 89 L 198 78 L 194 57 L 199 47 L 208 59 L 217 57 L 224 47 L 224 28 L 209 7 L 188 0 L 146 10 L 103 45 L 78 82 L 61 131'
  const mioEarRightFillPath =
    'M 659 130 L 636 69 L 596 22 L 570 7 L 546 1 L 510 11 L 497 31 L 497 48 L 507 59 L 522 48 L 526 68 L 517 82 L 502 90 L 499 125 L 516 162 L 561 180 L 616 176 L 655 156 Z'
  const mioEarRightEdgePath =
    'M 502 90 L 517 82 L 526 68 L 522 48 L 507 59 L 497 48 L 497 31 L 510 11 L 546 1 L 570 7 L 596 22 L 636 69 L 659 130'
  // 内耳ピンク: カールの先端(折り返し)まで沿わせ、下側はやや幅広の丸み。
  // 根元は顔のふさ毛で覆うので、下端は耳の付け根を少し越える程度で止める
  const mioEarLeftPath =
    'M 84 170 C 76 140 80 105 92 78 C 100 55 115 32 138 20 C 155 11 178 8 195 16 C 205 21 210 32 208 42 C 197 36 185 38 176 48 C 160 66 150 80 144 100 C 134 125 130 148 140 170 C 122 178 100 178 84 170 Z'
  const mioEarRightPath =
    'M 637 170 C 645 140 641 105 629 78 C 621 55 606 32 583 20 C 566 11 543 8 526 16 C 516 21 511 32 513 42 C 524 36 536 38 545 48 C 561 66 571 80 577 100 C 587 125 591 148 581 170 C 599 178 621 178 637 170 Z'
  const mioWhisker = (angle: string, delay: string, position: CSSProperties): CSSProperties =>
    ({
      ...position,
      height: 1,
      borderRadius: 999,
      background: 'rgba(142,132,132,.5)',
      animationDelay: delay,
      '--mio-whisker-angle': angle,
    }) as CSSProperties

  const catModel = (
    // 元デザインはステージいっぱいに描かれているため、他キャラと大きさを揃えるよう
    // 足元基準で縮小し、上へ持ち上げる(マクコとほぼ同じ 6%〜89% の範囲に収める)
    // 他キャラや卵と同じ疑似3D(パーツごとのtranslateZ層積み)で描くため、
    // このラッパーはpreserve-3dで子のZ軸を活かす。z-indexではなくZ値が前後を決める
    <div
      className="absolute inset-0"
      style={{ transform: 'translateY(-6%) scale3d(0.88, 0.88, 0.88)', transformOrigin: '50% 100%', transformStyle: 'preserve-3d' }}
    >
      {/* 胴体(柄と白い胸を内包) */}
      <div
        data-mascot-part="torso"
        className="absolute overflow-hidden"
        style={{
          left: '36.5%',
          top: '64%',
          width: '27%',
          height: '23.5%',
          transform: 'translateZ(22px)',
          borderRadius: '47% 47% 42% 42% / 36% 36% 62% 62%',
          background: mioFurBody,
          filter: `${mioOutline} drop-shadow(0 9px 9px rgba(89,70,75,.1))`,
        }}
      >
        <div
          className="absolute"
          style={{
            left: '-2%',
            top: '-2%',
            width: '39%',
            height: '48%',
            opacity: 0.74,
            background: mioMarkGradient,
            clipPath: 'polygon(0 0, 100% 0, 79% 45%, 55% 100%, 30% 64%, 0 54%)',
          }}
        />
        <div
          className="absolute"
          style={{
            right: '-2%',
            top: '-2%',
            width: '39%',
            height: '48%',
            opacity: 0.74,
            background: mioMarkGradient,
            clipPath: 'polygon(100% 0, 0 0, 21% 45%, 45% 100%, 70% 64%, 100% 54%)',
          }}
        />
        <div
          className="absolute"
          style={{
            left: '22%',
            top: '5%',
            width: '56%',
            height: '78%',
            borderRadius: '48% 48% 50% 50%',
            background:
              'radial-gradient(ellipse at 50% 36%, #fff 0 38%, rgba(255,253,250,.92) 62%, transparent 78%)',
          }}
        >
          <div
            className="absolute"
            style={{
              left: '25%',
              bottom: '-7%',
              width: '50%',
              height: '28%',
              borderRadius: '50%',
              background: 'rgba(255,255,255,.66)',
            }}
          />
        </div>
      </div>

      {/* 腕(ゆっくり揺れる) */}
      <div
        data-mascot-part="left-arm"
        className="absolute mio-arm-left"
        style={{ left: '25.4%', top: '69.5%', width: '10.8%', height: '12.5%', transform: 'translateZ(30px) rotate(15deg)', transformOrigin: '88% 9%' }}
      >
        <div
          className="absolute inset-0 overflow-hidden"
          style={{
            borderRadius: '50% 50% 48% 48% / 39% 39% 61% 61%',
            background: `radial-gradient(ellipse at 50% -5%, #aeabad 0 5%, #d6d1cf 23%, transparent 48%), ${mioFurLimb}`,
            filter: `${mioOutline} drop-shadow(0 6px 6px rgba(89,70,75,.09))`,
          }}
        >
          <div
            className="absolute"
            style={{ left: '14%', bottom: '5%', width: '72%', height: '30%', borderRadius: '50%', borderBottom: '1px solid rgba(175,137,139,.26)' }}
          />
        </div>
      </div>
      <div
        data-mascot-part="right-arm"
        className="absolute mio-arm-right"
        style={{ right: '25.4%', top: '69.5%', width: '10.8%', height: '12.5%', transform: 'translateZ(30px) rotate(-15deg)', transformOrigin: '12% 9%' }}
      >
        <div
          className="absolute inset-0 overflow-hidden"
          style={{
            borderRadius: '50% 50% 48% 48% / 39% 39% 61% 61%',
            background: `radial-gradient(ellipse at 50% -5%, #aeabad 0 5%, #d6d1cf 23%, transparent 48%), ${mioFurLimb}`,
            filter: `${mioOutline} drop-shadow(0 6px 6px rgba(89,70,75,.09))`,
          }}
        >
          <div
            className="absolute"
            style={{ left: '14%', bottom: '5%', width: '72%', height: '30%', borderRadius: '50%', borderBottom: '1px solid rgba(175,137,139,.26)' }}
          />
        </div>
      </div>

      {/* 脚 */}
      <div
        data-mascot-part="left-leg"
        className="absolute overflow-hidden"
        style={{
          left: '35.2%',
          top: '83.3%',
          width: '12.8%',
          height: '11%',
          transform: 'translateZ(32px) rotate(2deg)',
          borderRadius: '46% 46% 58% 58% / 34% 34% 66% 66%',
          background: `radial-gradient(ellipse at 50% -15%, #d6d1cf 0 4%, transparent 38%), ${mioFurLimb}`,
          filter: `${mioOutline} drop-shadow(0 6px 6px rgba(89,70,75,.09))`,
        }}
      >
        <div
          className="absolute"
          style={{ left: '13%', bottom: '8%', width: '74%', height: '28%', borderRadius: '50%', borderBottom: '1px solid rgba(175,137,139,.28)' }}
        />
      </div>
      <div
        data-mascot-part="right-leg"
        className="absolute overflow-hidden"
        style={{
          right: '35.2%',
          top: '83.3%',
          width: '12.8%',
          height: '11%',
          transform: 'translateZ(32px) rotate(-2deg)',
          borderRadius: '46% 46% 58% 58% / 34% 34% 66% 66%',
          background: `radial-gradient(ellipse at 50% -15%, #d6d1cf 0 4%, transparent 38%), ${mioFurLimb}`,
          filter: `${mioOutline} drop-shadow(0 6px 6px rgba(89,70,75,.09))`,
        }}
      >
        <div
          className="absolute"
          style={{ left: '13%', bottom: '8%', width: '74%', height: '28%', borderRadius: '50%', borderBottom: '1px solid rgba(175,137,139,.28)' }}
        />
      </div>

      {/* 頭(元絵トレースの輪郭+カール耳。SVG 1枚) */}
      <svg
        data-mascot-part="head"
        className="absolute"
        style={{ left: '5%', top: 0, width: '90%', height: '71.5%', transform: 'translateZ(36px)', overflow: 'visible' }}
        viewBox="0 0 721 575"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {/* 耳は頭より先に描く(=頭の後ろ)。ピンクや耳の根元は顔の輪郭が前面から自然に隠す */}
        <g data-mascot-part="left-ear" className="mio-ear-left">
          <path d={mioEarLeftFillPath} fill="#fffdfa" />
          <path
            d={mioEarLeftEdgePath}
            fill="none"
            stroke="rgba(98,91,94,.5)"
            strokeWidth={1.1}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={mioEarLeftPath}
            fill="#efacb9"
            stroke="rgba(173,117,132,.52)"
            strokeWidth={0.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </g>
        <g data-mascot-part="right-ear" className="mio-ear-right">
          <path d={mioEarRightFillPath} fill="#fffdfa" />
          <path
            d={mioEarRightEdgePath}
            fill="none"
            stroke="rgba(98,91,94,.5)"
            strokeWidth={1.1}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={mioEarRightPath}
            fill="#efacb9"
            stroke="rgba(173,117,132,.52)"
            strokeWidth={0.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </g>
        <path d={mioHeadBasePath} fill="#fffdfa" />
        <path
          d={mioHeadEdgePath}
          fill="none"
          stroke="rgba(98,91,94,.5)"
          strokeWidth={1.1}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* 額の縞 */}
      <div
        className="absolute"
        style={{
          left: '47%',
          top: '17%',
          width: '6%',
          height: '18.5%',
          transform: 'translateZ(43px)',
          opacity: 0.78,
          background: mioStripeGradient,
          clipPath: 'polygon(22% 0, 78% 0, 88% 38%, 58% 100%, 42% 100%, 12% 38%)',
        }}
      />
      <div
        className="absolute"
        style={{
          left: '40%',
          top: '17%',
          width: '4.5%',
          height: '15%',
          opacity: 0.68,
          transform: 'translateZ(43px) rotate(-12deg)',
          background: mioStripeGradient,
          clipPath: 'polygon(22% 0, 78% 0, 88% 38%, 58% 100%, 42% 100%, 12% 38%)',
        }}
      />
      <div
        className="absolute"
        style={{
          right: '40%',
          top: '17%',
          width: '4.5%',
          height: '15%',
          opacity: 0.68,
          transform: 'translateZ(43px) rotate(12deg)',
          background: mioStripeGradient,
          clipPath: 'polygon(22% 0, 78% 0, 88% 38%, 58% 100%, 42% 100%, 12% 38%)',
        }}
      />

      {/* 口元のふくらみ */}
      <div
        className="absolute"
        style={{
          left: '31%',
          top: '43%',
          width: '38%',
          height: '19%',
          transform: 'translateZ(45px)',
          borderRadius: '47% 47% 52% 52%',
          background:
            'radial-gradient(ellipse at 50% 45%, #fff 0 47%, rgba(255,253,250,.86) 68%, transparent 82%)',
        }}
      />

      {/* 目(まばたき+機嫌で細くなる)。居眠り中は潰すと不気味なので、閉じたまぶたの線に差し替える */}
      {moodFace === 'sleepy' ? (
        <>
          <div
            className="absolute"
            style={{ left: '28.5%', top: '40%', width: '12.5%', height: '4.5%', transform: 'translateZ(52px)', borderBottom: '2.5px solid rgba(91,83,85,.85)', borderRadius: '0 0 60% 60%' }}
          />
          <div
            className="absolute"
            style={{ right: '28.5%', top: '40%', width: '12.5%', height: '4.5%', transform: 'translateZ(52px)', borderBottom: '2.5px solid rgba(91,83,85,.85)', borderRadius: '0 0 60% 60%' }}
          />
        </>
      ) : (
        <>
          <div
            className="absolute mio-eye overflow-hidden"
            style={{
              left: '27%',
              top: '36.5%',
              width: '15.5%',
              height: eyeHeight(15.5),
              transform: 'translateZ(52px)',
              border: '2px solid rgba(91,83,85,.88)',
              borderRadius: '50%',
              background:
                'radial-gradient(circle at 50% 66%, rgba(151,121,95,.7) 0 4%, transparent 5%), radial-gradient(circle at 50% 52%, #17191e 0 56%, #34363a 57% 72%, #d8d5d0 74% 83%, #fff 84% 100%)',
              boxShadow: '0 3px 0 rgba(99,82,82,.15), inset 0 -5px 8px rgba(172,132,97,.2)',
            }}
          >
            <span
              className="absolute"
              style={{ left: '22%', top: '14%', width: '24%', height: '25%', borderRadius: '50%', background: 'rgba(255,255,255,.95)', transform: 'rotate(18deg)' }}
            />
            <span
              className="absolute"
              style={{ right: '18%', top: '42%', width: '9%', height: '10%', borderRadius: '50%', background: 'rgba(255,255,255,.78)' }}
            />
            <span
              className="absolute"
              style={{ left: '34%', bottom: '8%', width: '32%', height: '7%', borderRadius: '50%', background: 'rgba(214,168,127,.64)', filter: 'blur(.5px)' }}
            />
          </div>
          <div
            className="absolute mio-eye overflow-hidden"
            style={{
              right: '27%',
              top: '36.5%',
              width: '15.5%',
              height: eyeHeight(15.5),
              transform: 'translateZ(52px)',
              border: '2px solid rgba(91,83,85,.88)',
              borderRadius: '50%',
              background:
                'radial-gradient(circle at 50% 66%, rgba(151,121,95,.7) 0 4%, transparent 5%), radial-gradient(circle at 50% 52%, #17191e 0 56%, #34363a 57% 72%, #d8d5d0 74% 83%, #fff 84% 100%)',
              boxShadow: '0 3px 0 rgba(99,82,82,.15), inset 0 -5px 8px rgba(172,132,97,.2)',
            }}
          >
            <span
              className="absolute"
              style={{ left: '22%', top: '14%', width: '24%', height: '25%', borderRadius: '50%', background: 'rgba(255,255,255,.95)', transform: 'rotate(18deg)' }}
            />
            <span
              className="absolute"
              style={{ right: '18%', top: '42%', width: '9%', height: '10%', borderRadius: '50%', background: 'rgba(255,255,255,.78)' }}
            />
            <span
              className="absolute"
              style={{ left: '34%', bottom: '8%', width: '32%', height: '7%', borderRadius: '50%', background: 'rgba(214,168,127,.64)', filter: 'blur(.5px)' }}
            />
          </div>
        </>
      )}

      {/* 鼻と口 */}
      <div
        className="absolute"
        style={{
          left: '47%',
          top: '50.5%',
          width: '6%',
          height: '4.2%',
          transform: 'translateZ(58px)',
          borderRadius: '48% 48% 55% 55%',
          background: 'linear-gradient(145deg, #ffc3cf, #ef99aa)',
          clipPath: 'polygon(8% 10%, 92% 10%, 80% 62%, 50% 100%, 20% 62%)',
          filter: 'drop-shadow(0 1px 1px rgba(139,77,91,.28))',
        }}
      >
        <span
          className="absolute"
          style={{ left: '23%', top: '17%', width: '25%', height: '20%', borderRadius: '50%', background: 'rgba(255,255,255,.72)' }}
        />
      </div>
      <div
        className="absolute"
        style={{ left: '49.75%', top: '54.1%', width: '.5%', height: '3.2%', transform: 'translateZ(56px)', borderRadius: 999, background: '#a87378' }}
      />
      <div
        className="absolute"
        style={{ left: '43.25%', top: '54.7%', width: '7%', height: '4.5%', transform: 'translateZ(56px) rotate(6deg)', borderBottom: '2px solid #a87378', borderRadius: '0 0 55% 55%' }}
      />
      <div
        className="absolute"
        style={{ right: '43.25%', top: '54.7%', width: '7%', height: '4.5%', transform: 'translateZ(56px) rotate(-6deg)', borderBottom: '2px solid #a87378', borderRadius: '0 0 55% 55%' }}
      />

      {/* ひげ(ぴくぴく動く) */}
      <div className="absolute mio-whisker-left" style={mioWhisker('7deg', '0s', { left: '-5%', top: '44%', width: '22%' })} />
      <div className="absolute mio-whisker-left" style={mioWhisker('1deg', '-.45s', { left: '-7%', top: '48%', width: '24%' })} />
      <div className="absolute mio-whisker-left" style={mioWhisker('-6deg', '-.9s', { left: '-5%', top: '52%', width: '22%' })} />
      <div className="absolute mio-whisker-right" style={mioWhisker('-7deg', '0s', { right: '-5%', top: '44%', width: '22%' })} />
      <div className="absolute mio-whisker-right" style={mioWhisker('-1deg', '-.45s', { right: '-7%', top: '48%', width: '24%' })} />
      <div className="absolute mio-whisker-right" style={mioWhisker('6deg', '-.9s', { right: '-5%', top: '52%', width: '22%' })} />
    </div>
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

  // ミオ(cat)は頭が大きく顔が低い位置まであるため、帽子は小さく上へ、
  // マフラーは顔にかからない首元(胴体の上端)へずらす
  const isCat = mascot.model === 'cat'
  const courierGear = (
    <>
      <div
        className="absolute left-1/2 rounded-[14px] mascot-courier-cap"
        style={{
          top: isCat ? '9.5%' : '9%',
          height: isCat ? '4.2%' : '8%',
          width: isCat ? '18%' : '36%',
          // 3D回転で頭から浮かないよう、Zは頭のすぐ上に寄せる
          transform: 'translateX(-50%) translateZ(42px) rotate(-2deg)',
          background: `linear-gradient(180deg, ${mascot.accent} 0%, ${mascot.accentStrong} 100%)`,
        }}
      />
      <div
        className="absolute left-1/2 rounded-full mascot-courier-strap"
        style={{
          top: isCat ? '13%' : '14.5%',
          height: isCat ? '2.2%' : '3.5%',
          width: isCat ? '24%' : '46%',
          transform: 'translateX(-50%) translateZ(40px)',
          backgroundColor: mascot.accentStrong,
          opacity: 0.9,
        }}
      />
    </>
  )

  const partnerGear = (
    <>
      {courierGear}
      {/* ミオはあごの下に巻き、Zを頭(36)と胴体(22)の間にして「顔の後ろ・体の前」に挟む */}
      <div
        className="absolute left-1/2 rounded-[18px] mascot-partner-scarf"
        style={{
          top: isCat ? '67%' : '52%',
          height: isCat ? '5%' : '7%',
          width: isCat ? '26%' : '46%',
          transform: `translateX(-50%) translateZ(${isCat ? 28 : 32}px)`,
          background: `linear-gradient(90deg, ${mascot.accentSoft} 0%, ${mascot.accent} 100%)`,
        }}
      />
      <div
        className="absolute rounded-full"
        style={{
          left: isCat ? '52%' : '60%',
          top: isCat ? '71%' : '55%',
          height: isCat ? '8%' : '13%',
          width: isCat ? '4.5%' : '7%',
          transform: `translateZ(${isCat ? 27 : 31}px) rotate(${isCat ? 8 : 16}deg)`,
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
      // 立体感の比率をどのサイズでも同じにする: perspectiveはsize比例、
      // Z層はシーンのscaleZ(size/96)でサイズ比例に伸縮させる(96px時の見え方が基準)。
      // preserve-3dで外側のポーズ回転(見回し等)にもZ層を引き継ぐ
      style={{ width: size, height: size, perspective: size * 4, opacity: bodyOpacity, transformStyle: 'preserve-3d' }}
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
            style={{ transformStyle: 'preserve-3d', transform: `scale3d(${scale}, ${scale}, ${(size / 96) * scale})` }}
          >
            <div
              className="absolute left-1/2 top-[84%] h-6 w-[46%] -translate-x-1/2 rounded-full opacity-30 blur-sm"
              style={{ backgroundColor: mascot.accent }}
            />
            {phaseScene}
            {phaseGear}
            {phaseFace}
          </div>
        </div>
      </div>
    </div>
  )
}
