import { useEffect, useRef } from 'react'
import { Sparkles } from 'lucide-react'
import { getMascotMeta } from '../../data/mascots'
import { getMascotPhaseLabel, useMascotStore } from '../../stores/mascotStore'

const CONFETTI_COLORS = ['#ff7899', '#ffd05c', '#56cfc0', '#7797ff', '#bd75e8', '#ff9b59']

interface ConfettiParticle {
  x: number
  y: number
  vx: number
  vy: number
  width: number
  height: number
  rotation: number
  angularVelocity: number
  flutter: number
  flutterSpeed: number
  color: string
  ribbon: boolean
}

function PhysicsConfetti({ eventAt }: { eventAt: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let width = window.innerWidth
    let height = window.innerHeight
    let frame = 0
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const resize = () => {
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    const particles: ConfettiParticle[] = Array.from({ length: 140 }, (_, index) => {
      const fromLeft = index % 2 === 0
      const spread = Math.random()
      return {
        x: fromLeft ? width * 0.1 : width * 0.9,
        y: height - Math.min(150, width * 0.1),
        vx: (fromLeft ? 1 : -1) * (220 + spread * width * 0.62),
        vy: -(520 + Math.random() * height * 0.72),
        width: index % 7 === 0 ? 6 : 8 + Math.random() * 7,
        height: index % 7 === 0 ? 28 + Math.random() * 18 : 12 + Math.random() * 12,
        rotation: Math.random() * Math.PI * 2,
        angularVelocity: (Math.random() - 0.5) * 13,
        flutter: Math.random() * Math.PI * 2,
        flutterSpeed: 5 + Math.random() * 9,
        color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
        ribbon: index % 7 === 0,
      }
    })

    let previousTime = performance.now()
    const startedAt = previousTime
    const render = (time: number) => {
      const dt = Math.min((time - previousTime) / 1000, 0.032)
      previousTime = time
      context.clearRect(0, 0, width, height)

      particles.forEach((particle) => {
        particle.flutter += particle.flutterSpeed * dt
        const airDrag = Math.pow(0.985, dt * 60)
        particle.vx *= airDrag
        particle.vy = particle.vy * airDrag + 620 * dt
        particle.x += (particle.vx + Math.sin(particle.flutter) * 72) * dt
        particle.y += particle.vy * dt
        particle.rotation += particle.angularVelocity * dt

        const flip = Math.cos(particle.flutter * 1.35)
        context.save()
        context.translate(particle.x, particle.y)
        context.rotate(particle.rotation)
        context.scale(Math.max(0.08, Math.abs(flip)), 1)
        context.fillStyle = particle.color
        if (particle.ribbon) {
          context.beginPath()
          context.moveTo(-particle.width / 2, -particle.height / 2)
          context.bezierCurveTo(
            particle.width,
            -particle.height / 6,
            -particle.width,
            particle.height / 6,
            particle.width / 2,
            particle.height / 2
          )
          context.lineWidth = particle.width
          context.strokeStyle = particle.color
          context.stroke()
        } else {
          context.fillRect(-particle.width / 2, -particle.height / 2, particle.width, particle.height)
        }
        context.restore()
      })

      if (time - startedAt < 4100) frame = window.requestAnimationFrame(render)
    }
    frame = window.requestAnimationFrame(render)
    window.addEventListener('resize', resize)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [eventAt])

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
}

export function EvolutionCelebrationOverlay() {
  const { evolutionEvent, dismissEvolutionEvent } = useMascotStore()

  useEffect(() => {
    if (!evolutionEvent) return
    const timer = window.setTimeout(dismissEvolutionEvent, 4200)
    return () => window.clearTimeout(timer)
  }, [dismissEvolutionEvent, evolutionEvent])

  if (!evolutionEvent) return null

  const mascot = getMascotMeta(evolutionEvent.mascotId)

  return (
    <div
      key={evolutionEvent.at}
      className="growth-celebration pointer-events-none fixed inset-0 z-[240] overflow-hidden"
      aria-live="polite"
    >
      <div className="growth-celebration-glow absolute inset-0" />

      <div className="growth-cracker growth-cracker-left"><span /></div>
      <div className="growth-cracker growth-cracker-right"><span /></div>
      <div className="growth-blast growth-blast-left" />
      <div className="growth-blast growth-blast-right" />
      <PhysicsConfetti eventAt={evolutionEvent.at} />

      <div className="growth-announcement absolute left-1/2 top-[18%] flex -translate-x-1/2 flex-col items-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-[#dc913f] shadow-[0_16px_40px_rgba(220,145,63,.28)]">
          <Sparkles size={22} />
        </span>
        <p className="mt-4 text-[11px] font-bold tracking-[0.28em] text-[#c87932]">GROWTH!</p>
        <h2 className="mt-2 whitespace-nowrap font-display text-[clamp(30px,5vw,64px)] text-sumi-text drop-shadow-[0_4px_18px_rgba(255,255,255,.9)]">
          {mascot.name} が成長しました！
        </h2>
        <span className="mt-3 rounded-full border border-white/90 bg-white/85 px-5 py-2 text-sm font-semibold text-[#b86f31] shadow-[0_12px_30px_rgba(190,117,53,.16)] backdrop-blur-md">
          {getMascotPhaseLabel(evolutionEvent.phase)}
        </span>
      </div>
    </div>
  )
}
