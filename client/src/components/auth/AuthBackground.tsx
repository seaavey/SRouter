/**
 * The orbital rings behind the sign-in card. Purely decorative: it carries no
 * state and reads the theme through `currentColor`, so it follows the light
 * and dark palettes without a second copy of the markup.
 */
export default function AuthBackground() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 [mask-image:radial-gradient(ellipse_75%_75%_at_50%_50%,#000_30%,transparent_100%)]"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 1000 1000"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full overflow-visible"
      >
        <defs>
          {/* Luminous bloom and blur filters */}
          <filter
            id="ring-glow-core"
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
          >
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter
            id="ring-glow-soft"
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
          >
            <feGaussianBlur stdDeviation="5" />
          </filter>

          {/* Gradients along the curve for orbiting beams */}
          <linearGradient
            id="orbit-glow-420"
            x1="500"
            y1="80"
            x2="894.67"
            y2="356.35"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
            <stop offset="40%" stopColor="currentColor" stopOpacity="0.2" />
            <stop offset="75%" stopColor="currentColor" stopOpacity="0.65" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
          </linearGradient>

          <linearGradient
            id="orbit-glow-280"
            x1="500"
            y1="780"
            x2="270.64"
            y2="660.6"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
            <stop offset="45%" stopColor="currentColor" stopOpacity="0.2" />
            <stop offset="80%" stopColor="currentColor" stopOpacity="0.6" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.9" />
          </linearGradient>

          <linearGradient
            id="orbit-glow-560"
            x1="-26.23"
            y1="308.47"
            x2="308.47"
            y2="-26.23"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
            <stop offset="60%" stopColor="currentColor" stopOpacity="0.3" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.75" />
          </linearGradient>
        </defs>

        {/* Static Base Geometry */}
        <circle
          cx="500"
          cy="500"
          r="280"
          className="fill-none stroke-border stroke-[1] opacity-35"
        />
        <circle
          cx="500"
          cy="500"
          r="420"
          className="fill-none stroke-border stroke-[1] opacity-65"
        />
        <circle
          cx="500"
          cy="500"
          r="560"
          className="fill-none stroke-border stroke-[1] opacity-35"
        />
        <line
          x1="80"
          y1="500"
          x2="920"
          y2="500"
          className="fill-none stroke-border stroke-[1] opacity-35"
        />
        <line
          x1="500"
          y1="80"
          x2="500"
          y2="920"
          className="fill-none stroke-border stroke-[1] opacity-35"
        />

        {/* Outer Ring Orbit (Slow ambient celestial pulse) */}
        <g className="ring-orbit-outer text-foreground">
          <circle cx="500" cy="500" r="500" fill="none" pointerEvents="none" />
          <path
            d="M -26.23 308.47 A 560 560 0 0 1 308.47 -26.23"
            fill="none"
            stroke="url(#orbit-glow-560)"
            strokeWidth="5"
            strokeLinecap="round"
            filter="url(#ring-glow-soft)"
            className="opacity-40 dark:opacity-60"
          />
          <path
            d="M -26.23 308.47 A 560 560 0 0 1 308.47 -26.23"
            fill="none"
            stroke="url(#orbit-glow-560)"
            strokeWidth="1.25"
            strokeLinecap="round"
            className="opacity-60 dark:opacity-85"
          />
          <circle
            cx="308.47"
            cy="-26.23"
            r="6"
            fill="currentColor"
            filter="url(#ring-glow-core)"
            className="opacity-45 dark:opacity-75"
          />
          <circle
            cx="308.47"
            cy="-26.23"
            r="2"
            fill="currentColor"
            className="opacity-80 dark:opacity-100"
          />
        </g>

        {/* Hero Middle Ring Orbit (Clockwise luminous beam) */}
        <g className="ring-orbit-hero text-foreground">
          <circle cx="500" cy="500" r="500" fill="none" pointerEvents="none" />
          <path
            d="M 500 80 A 420 420 0 0 1 894.67 356.35"
            fill="none"
            stroke="url(#orbit-glow-420)"
            strokeWidth="7"
            strokeLinecap="round"
            filter="url(#ring-glow-soft)"
            className="opacity-65 dark:opacity-90"
          />
          <path
            d="M 500 80 A 420 420 0 0 1 894.67 356.35"
            fill="none"
            stroke="url(#orbit-glow-420)"
            strokeWidth="2"
            strokeLinecap="round"
            className="opacity-90 dark:opacity-100"
          />
          <circle
            cx="894.67"
            cy="356.35"
            r="9"
            fill="currentColor"
            filter="url(#ring-glow-core)"
            className="opacity-65 dark:opacity-95"
          />
          <circle
            cx="894.67"
            cy="356.35"
            r="3"
            fill="currentColor"
            className="opacity-95 dark:opacity-100"
          />
        </g>

        {/* Inner Ring Orbit (Counter-clockwise orbital pulse) */}
        <g className="ring-orbit-inner text-foreground">
          <circle cx="500" cy="500" r="500" fill="none" pointerEvents="none" />
          <path
            d="M 500 780 A 280 280 0 0 1 270.64 660.6"
            fill="none"
            stroke="url(#orbit-glow-280)"
            strokeWidth="6"
            strokeLinecap="round"
            filter="url(#ring-glow-soft)"
            className="opacity-55 dark:opacity-80"
          />
          <path
            d="M 500 780 A 280 280 0 0 1 270.64 660.6"
            fill="none"
            stroke="url(#orbit-glow-280)"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="opacity-80 dark:opacity-95"
          />
          <circle
            cx="270.64"
            cy="660.6"
            r="7"
            fill="currentColor"
            filter="url(#ring-glow-core)"
            className="opacity-55 dark:opacity-85"
          />
          <circle
            cx="270.64"
            cy="660.6"
            r="2.25"
            fill="currentColor"
            className="opacity-90 dark:opacity-100"
          />
        </g>
      </svg>
    </div>
  )
}
