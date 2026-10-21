import { useState } from "react"
import type { ComponentProps, CSSProperties } from "react"

import type { ProviderProtocol } from "@/api/types"
import { cn } from "@/lib/utils"

/**
 * Brand marks served from `client/public/providers`. Most ids name their vendor
 * directly; these five disagree, because two driver ids share one vendor asset
 * and three carry a separator the file name does not.
 */
const LOGOS: Record<string, string> = {
  antigravity: "antigravity",
  claude: "claude",
  cline: "cline",
  codebuddy: "codebuddy",
  "codebuddy-cn": "codebuddy",
  "grok-web": "grok",
  openai_codex: "openai",
  opencode_zen: "opencode",
  qoder: "qoder",
}

/**
 * Assets that paint in `currentColor` instead of a brand colour. An `<img>`
 * renders them as an isolated document where `currentColor` resolves to black,
 * so they would vanish on the dark surface; they fill the foreground colour
 * through a mask instead. `qoder` joins them because its brand green sits on a
 * `currentColor` body, which would drop out the same way and leave a fragment.
 */
const MONOCHROME = new Set([
  "anthropic",
  "cline",
  "grok",
  "openai",
  "opencode",
  "qoder",
])

/**
 * The mark a custom provider falls back to when its endpoint serves no
 * favicon: the protocol the endpoint speaks.
 */
const PROTOCOL_ASSETS: Record<ProviderProtocol, string | null> = {
  openai: "openai",
  anthropic: "anthropic",
  custom: null,
}

/**
 * The favicon an endpoint publishes, taken from the base URL the operator
 * entered. The URL is used as given: a base URL of `https://api.example.com/v1`
 * asks for `https://api.example.com/v1/favicon.svg`.
 *
 * shortcut: only the exact base URL + `/favicon.svg` is tried, so an endpoint
 * that publishes its favicon at the origin root keeps the protocol mark. Point
 * the base URL at the favicon's own path when that is what the endpoint
 * serves.
 */
function faviconURL(baseURL?: string) {
  if (!baseURL) return null
  try {
    const base = new URL(baseURL)
    base.pathname = `${base.pathname.replace(/\/$/, "")}/favicon.svg`
    base.search = ""
    base.hash = ""
    return base.href
  } catch {
    return null
  }
}

export interface ProviderLogoProps extends ComponentProps<"span"> {
  providerID?: string
  protocol?: ProviderProtocol
  baseURL?: string
  size?: number
}

/** A mark painted in one foreground colour, following the theme through a mask. */
function MonoMark({
  slug,
  className,
  style,
  ...props
}: ComponentProps<"span"> & { slug: string }) {
  const asset = `/providers/${slug}.svg`
  return (
    <span
      className={cn("inline-flex bg-foreground", className)}
      style={{
        ...style,
        maskImage: `url(${asset})`,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskImage: `url(${asset})`,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
      }}
      aria-hidden="true"
      {...props}
    />
  )
}

/** A mark with its own brand colour, sitting on a muted chip. */
function BrandMark({
  slug,
  className,
  style,
  ...props
}: ComponentProps<"span"> & { slug: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center overflow-hidden rounded-sm bg-surface-muted p-0.5",
        className
      )}
      style={style}
      aria-hidden="true"
      {...props}
    >
      <img
        src={`/providers/${slug}.svg`}
        alt=""
        className="size-full object-contain"
      />
    </span>
  )
}

/**
 * Renders one asset from `client/public/providers`. A monochrome mark fills
 * the foreground colour through a mask so it follows the theme; a coloured
 * one sits on a muted chip, because those assets are framed to the full 24px
 * box and touch their own edges.
 */
function renderAsset(
  slug: string,
  className?: string,
  style?: CSSProperties,
  props: ComponentProps<"span"> = {}
) {
  if (MONOCHROME.has(slug)) {
    return (
      <MonoMark slug={slug} className={className} style={style} {...props} />
    )
  }

  return (
    <BrandMark slug={slug} className={className} style={style} {...props} />
  )
}

/** The generic mark for a provider that names neither a vendor nor a protocol. */
function GenericMark({ className, style, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn("inline-flex text-foreground", className)}
      style={style}
      aria-hidden="true"
      {...props}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="M9 3v18" />
        <path d="M15 3v18" />
        <path d="M3 9h18" />
        <path d="M3 15h18" />
      </svg>
    </span>
  )
}

/**
 * Vendor and driver logos keyed by provider identifier. The caller sizes the
 * box and the mark fills it, so a fixed avatar and a flex chip both work.
 * If size is provided, it is applied as width and height style.
 *
 * A custom provider has no asset of its own, so it asks its endpoint for a
 * favicon and falls back to the mark of the protocol it speaks.
 */
export function ProviderLogo({
  providerID,
  protocol,
  baseURL,
  size,
  className,
  style,
  ...props
}: ProviderLogoProps) {
  const [failedFavicon, setFailedFavicon] = useState<string | null>(null)
  const slug = LOGOS[(providerID ?? "").toLowerCase()]
  const frame = size ? { width: size, height: size, ...style } : style

  // A custom provider carries a generated id, so there is no asset to serve.
  if (!slug) {
    const favicon = faviconURL(baseURL)

    if (favicon && failedFavicon !== favicon) {
      return (
        <span
          className={cn(
            "inline-flex items-center justify-center overflow-hidden rounded-sm bg-surface-muted p-0.5",
            className
          )}
          style={frame}
          aria-hidden="true"
          {...props}
        >
          <img
            src={favicon}
            alt=""
            className="size-full object-contain"
            onError={() => setFailedFavicon(favicon)}
          />
        </span>
      )
    }

    const protocolSlug = protocol ? PROTOCOL_ASSETS[protocol] : null
    if (protocolSlug) {
      return renderAsset(protocolSlug, className, frame, props)
    }

    return <GenericMark className={className} style={frame} {...props} />
  }

  return renderAsset(slug, className, frame, props)
}
