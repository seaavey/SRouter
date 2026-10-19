type SRouterMarkProps = {
  size?: number
}

/**
 * The SRouter brand glyph: a circled node with four spokes. One definition
 * for the sidebar rail and the login screen, so the mark cannot drift between
 * the two. The public file twin lives at `client/public/SRouter.svg` for URL
 * use; keep the paths in step when either changes.
 */
export default function SRouterMark({ size = 18 }: SRouterMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M4.93 4.93l4.24 4.24" />
      <path d="M14.83 9.17l4.24-4.24" />
      <path d="M14.83 14.83l4.24 4.24" />
      <path d="M4.93 19.07l4.24-4.24" />
    </svg>
  )
}
