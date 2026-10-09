import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"

import { cn } from "@/shared/lib/utils"
import { arcBox, polar } from "./math"

import { useGauge } from "./context"

/**
 * What the tooltip is pinned to. `pointer` follows the cursor round the
 * gauge, `value` sits on the arc at the value, and the rest are fixed points
 * of the dial: its centre, or the middle of an edge or a corner of the box
 * its sweep fills.
 */
export type GaugeTooltipPosition =
  | "pointer"
  | "value"
  | "center"
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"

/**
 * Which way the bubble stands off its point. `auto` picks for the position:
 * outward along the radius at the value, so the bubble swings round with it,
 * above the pointer, centred on the centre, and away from the dial at an
 * edge or corner.
 */
export type GaugeTooltipSide =
  "auto" | "center" | "top" | "right" | "bottom" | "left"

export type GaugeTooltipProps = {
  position?: GaugeTooltipPosition
  side?: GaugeTooltipSide
  /**
   * Domain value a `value` tooltip points at and shows. Defaults to the
   * current value; a fixed one marks a target or a cutoff.
   */
  at?: number
  /**
   * How far out from the reference radius the point sits, in SVG units: the
   * spot on the arc for `value`, and the box round the sweep for the edges
   * and corners.
   */
  offset?: number
  /** Room between the point and the bubble, in CSS pixels. */
  gap?: number
  /**
   * Keep the bubble on screen: flip it to the far side of its point when
   * that side has more room, then slide it sideways in from the left or
   * right edge while it still overlaps its point. On by default.
   */
  avoidCollisions?: boolean
  /** Room kept clear between the bubble and the viewport edge, in CSS pixels. */
  collisionPadding?: number
  /**
   * Hold the tooltip open, or shut, instead of showing it on hover, while
   * a press that started on the gauge is held, and on keyboard focus.
   */
  open?: boolean
  /** Small line above the value. Leave out for the value on its own. */
  label?: ReactNode
  /** Printed after the value, a size down. */
  unit?: ReactNode
  decimals?: number
  format?: (value: number) => string
  /** Classes for the bubble, merged over its defaults. */
  className?: string
  style?: CSSProperties
  /**
   * Replaces the default label, value and unit with any HTML, or a function
   * of the value being shown for content that has to follow it.
   */
  children?: ReactNode | ((value: number) => ReactNode)
}

type Point = { x: number; y: number }
type Size = { width: number; height: number }
type Axis = "x" | "y"

const extent = { x: "width", y: "height" } as const

/**
 * The bubble's top left corner for a direction off the point: centred on the
 * point, moved `gap` along the direction, then pushed half its own size the
 * same way, so a side tooltip touches the point with that edge.
 */
const corner = (p: Point, d: Point, size: Size, gap: number): Point => {
  const len = Math.hypot(d.x, d.y) || 1
  return {
    x: p.x + (d.x / len) * gap + ((d.x - 1) / 2) * size.width,
    y: p.y + (d.y / len) * gap + ((d.y - 1) / 2) * size.height,
  }
}

/** Directions in screen space, y down, scaled so the longer axis is 1. */
const sides: Record<Exclude<GaugeTooltipSide, "auto">, Point> = {
  center: { x: 0, y: 0 },
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
}

/** Where each fixed position sits in the sweep's box, 0 to 1 across. */
const boxPoints: Record<string, Point> = {
  top: { x: 0.5, y: 0 },
  right: { x: 1, y: 0.5 },
  bottom: { x: 0.5, y: 1 },
  left: { x: 0, y: 0.5 },
  "top-left": { x: 0, y: 0 },
  "top-right": { x: 1, y: 0 },
  "bottom-left": { x: 0, y: 1 },
  "bottom-right": { x: 1, y: 1 },
}

/** What can take keyboard focus, to find the element that owns the gauge's. */
const FOCUSABLE =
  '[tabindex]:not([tabindex="-1"]), a[href], button, input, select, textarea'

/* The portal needs a document, which the server render has none of. */
const subscribe = () => () => {}
const useIsClient = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  )

/**
 * An HTML tooltip for the gauge, shown while the pointer is over it. It reads
 * the value with an optional label and unit by default, or renders whatever
 * its children are, and can be pinned to the value on the arc, follow the
 * pointer, or hold a fixed spot on the dial.
 *
 * The bubble is portalled to the body and placed through the SVG's screen
 * transform, so it is never clipped by the gauge and keeps its own CSS size
 * however the gauge, or an inset it sits in, is scaled.
 */
export const GaugeTooltip = ({
  position = "value",
  side = "auto",
  at,
  offset = 24,
  gap = 8,
  avoidCollisions = true,
  collisionPadding = 8,
  open,
  label,
  unit,
  decimals = 0,
  format,
  className,
  style,
  children,
}: GaugeTooltipProps) => {
  const gauge = useGauge()
  const isClient = useIsClient()
  const anchor = useRef<SVGGElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const pointer = useRef<Point | null>(null)
  const [hovered, setHovered] = useState(false)
  /* A press that starts on the gauge, held until it is let go anywhere. */
  const [pressed, setPressed] = useState(false)
  const [focused, setFocused] = useState(false)
  const shown = open ?? (hovered || pressed || focused)

  const value = at ?? gauge.value
  const angle = gauge.angleOf(value)

  /** The point the bubble is pinned to, in client pixels. */
  const pinned = (): Point | null => {
    if (position === "pointer") return pointer.current
    const ctm = anchor.current?.getScreenCTM()
    if (!ctm) return null
    let p: Point = { x: 0, y: 0 }
    if (position === "value") p = polar(gauge.radius + offset, angle)
    else if (position !== "center") {
      const b = arcBox(gauge.radius + offset, gauge.startAngle, gauge.endAngle)
      const spot = boxPoints[position]
      p = { x: b.x + b.width * spot.x, y: b.y + b.height * spot.y }
    }
    return new DOMPoint(p.x, p.y).matrixTransform(ctm)
  }

  /** The way the bubble stands off its point. */
  const direction = (): Point => {
    if (side !== "auto") return sides[side]
    if (position === "pointer") return sides.top
    if (position === "center") return sides.center
    if (position !== "value") {
      const spot = boxPoints[position]
      return { x: spot.x * 2 - 1, y: spot.y * 2 - 1 }
    }
    /* Outward along the radius, stretched onto the square so the bubble's
       nearest edge or corner meets the point at any angle. */
    const r = polar(1, angle)
    const m = Math.max(Math.abs(r.x), Math.abs(r.y)) || 1
    return { x: r.x / m, y: r.y / m }
  }

  /* Written straight to the element rather than through state, so a bubble
     following the pointer moves without a render per pixel. */
  const place = useEffectEvent(() => {
    const el = box.current
    if (!el) return
    const p = pinned()
    if (!p) {
      el.style.visibility = "hidden"
      return
    }
    const size = { width: el.offsetWidth, height: el.offsetHeight }
    let d = direction()
    let at = corner(p, d, size, gap)

    if (avoidCollisions) {
      const view = {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      }
      const pad = collisionPadding
      /* How much of the bubble falls outside the padded viewport along one
         axis. Capped at its size, so a point far off screen reads the same
         on either side and does not flip back and forth as it scrolls. */
      const spill = (at: Point, axis: Axis) => {
        const span = size[extent[axis]]
        const room = view[extent[axis]] - pad
        const out =
          Math.max(0, pad - at[axis]) + Math.max(0, at[axis] + span - room)
        return Math.min(span, out)
      }
      /* Flip to the other side of the point, axis by axis, when the bubble
         spills over and the far side spills less. */
      for (const axis of ["x", "y"] as const) {
        const before = spill(at, axis)
        if (before === 0 || d[axis] === 0) continue
        const flipped = { ...d, [axis]: -d[axis] }
        const there = corner(p, flipped, size, gap)
        if (spill(there, axis) < before) {
          d = flipped
          at = there
        }
      }
      /* Then slide sideways back inside the left or right edge, but only
         when the bubble spans its point across, and only as far as it keeps
         spanning it, so it never leaves its point. Never up or down: that is
         the way the page scrolls, and a bubble sliding along the top or
         bottom of the window would creep against its point as it went. */
      const { width } = size
      if (p.x >= at.x && p.x <= at.x + width) {
        const inside = Math.max(pad, Math.min(at.x, view.width - pad - width))
        at = { ...at, x: Math.max(p.x - width, Math.min(inside, p.x)) }
      }
    }

    /* In page coordinates, so the bubble rides a page scroll natively
       instead of trailing a frame behind it the way a fixed one would. */
    el.style.visibility = ""
    el.style.left = `${at.x + window.scrollX}px`
    el.style.top = `${at.y + window.scrollY}px`
  })

  /* Hover is taken over the whole gauge, from the SVG the anchor sits in. */
  useEffect(() => {
    const svg = anchor.current?.ownerSVGElement
    if (!svg) return
    const track = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY }
    }
    const enter = (e: PointerEvent) => {
      track(e)
      setHovered(true)
    }
    const move = (e: PointerEvent) => {
      track(e)
      place()
    }
    const leave = () => setHovered(false)
    const down = (e: PointerEvent) => {
      track(e)
      setPressed(true)
    }
    svg.addEventListener("pointerenter", enter)
    svg.addEventListener("pointermove", move)
    svg.addEventListener("pointerleave", leave)
    svg.addEventListener("pointerdown", down)
    return () => {
      svg.removeEventListener("pointerenter", enter)
      svg.removeEventListener("pointermove", move)
      svg.removeEventListener("pointerleave", leave)
      svg.removeEventListener("pointerdown", down)
    }
  }, [])

  /* Keyboard focus on the gauge, or on the nearest focusable element round
     it such as a GaugeControl, brings the tooltip up too. Only focus that
     shows a ring counts, so clicking a control does not; a key pressed
     after the click does, as that is when the browser starts showing it. */
  useEffect(() => {
    const owner = anchor.current?.ownerSVGElement?.closest(FOCUSABLE)
    if (!owner) return
    const check = () =>
      setFocused(
        document.activeElement === owner && owner.matches(":focus-visible")
      )
    /* A key pressed while it has focus is keyboard use, whether or not the
       browser has switched its ring on yet. */
    const key = () => setFocused(document.activeElement === owner)
    const blur = () => setFocused(false)
    check()
    owner.addEventListener("focus", check)
    owner.addEventListener("keydown", key)
    owner.addEventListener("blur", blur)
    return () => {
      owner.removeEventListener("focus", check)
      owner.removeEventListener("keydown", key)
      owner.removeEventListener("blur", blur)
    }
  }, [])

  /* A drag holds the tooltip up until it ends. A GaugeControl captures the
     pointer on its wrapper, which counts as leaving the SVG and stops its
     moves reaching it, so the press is followed on the window instead. It
     also brings the tooltip up on touch, which has no hover. */
  useEffect(() => {
    if (!pressed) return
    const move = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY }
      place()
    }
    const release = () => setPressed(false)
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", release)
    window.addEventListener("pointercancel", release)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", release)
      window.removeEventListener("pointercancel", release)
    }
  }, [pressed])

  /* A scroll can bring an edge up against the bubble, and a scrolling box
     the gauge sits in moves the point out from under it. */
  useEffect(() => {
    if (!shown) return
    const update = () => place()
    window.addEventListener("scroll", update, true)
    window.addEventListener("resize", update)
    return () => {
      window.removeEventListener("scroll", update, true)
      window.removeEventListener("resize", update)
    }
  }, [shown])

  /* Every render, since an animated value moves the point frame by frame. */
  useLayoutEffect(() => {
    if (shown) place()
  })

  const content =
    typeof children === "function"
      ? children(value)
      : (children ?? (
          <DefaultContent
            text={format ? format(value) : value.toFixed(decimals)}
            label={label}
            unit={unit}
          />
        ))

  return (
    <>
      <g ref={anchor} />
      {shown &&
        isClient &&
        createPortal(
          /* The wrapper holds the position so the bubble's own transform is
             free for its entrance animation. */
          <div
            ref={box}
            className="pointer-events-none absolute top-0 left-0 z-50"
          >
            <div
              role="tooltip"
              data-slot="gauge-tooltip"
              style={style}
              className={cn(
                "w-max max-w-xs animate-in rounded-lg bg-foreground px-3 py-1.5 text-xs text-background shadow-md fade-in-0 zoom-in-95",
                className
              )}
            >
              {content}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}

/** The label over the value and its unit. */
const DefaultContent = ({
  text,
  label,
  unit,
}: {
  text: string
  label?: ReactNode
  unit?: ReactNode
}) => (
  <div className="flex flex-col items-center leading-tight">
    {label && <span className="opacity-70">{label}</span>}
    <span className="text-sm font-semibold tabular-nums">
      {text}
      {unit && (
        <span className="ml-0.5 text-xs font-medium opacity-70">{unit}</span>
      )}
    </span>
  </div>
)
