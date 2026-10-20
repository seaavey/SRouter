import * as React from "react"

type Theme = "dark" | "light" | "system"
type ResolvedTheme = "dark" | "light"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
  disableTransitionOnChange?: boolean
}

type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
  /** The theme actually painted: `system` resolved against the OS setting. */
  resolvedTheme: ResolvedTheme
}

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)"
const THEME_VALUES: Theme[] = ["dark", "light", "system"]

const ThemeProviderContext = React.createContext<
  ThemeProviderState | undefined
>(undefined)

function isTheme(value: string | null): value is Theme {
  if (value === null) {
    return false
  }

  return THEME_VALUES.includes(value as Theme)
}

function getSystemTheme(): ResolvedTheme {
  if (window.matchMedia(COLOR_SCHEME_QUERY).matches) {
    return "dark"
  }

  return "light"
}

function disableTransitionsTemporarily() {
  const style = document.createElement("style")
  style.appendChild(
    document.createTextNode(
      "*,*::before,*::after{-webkit-transition:none!important;transition:none!important}"
    )
  )
  document.head.appendChild(style)

  return () => {
    window.getComputedStyle(document.body)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        style.remove()
      })
    })
  }
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (target.isContentEditable) {
    return true
  }

  const editableParent = target.closest(
    "input, textarea, select, [contenteditable='true']"
  )
  if (editableParent) {
    return true
  }

  return false
}

/**
 * Chrome on Android and Safari paint their toolbar from this meta. The
 * media-scoped defaults in `index.html` follow the OS, which cannot express a
 * manual choice, so the painted background replaces them on the first apply.
 */
function syncThemeColor() {
  const background = window.getComputedStyle(document.body).backgroundColor
  if (!background || background === "rgba(0, 0, 0, 0)") {
    return
  }

  let meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]:not([media])'
  )
  if (!meta) {
    for (const stale of document.querySelectorAll('meta[name="theme-color"]')) {
      stale.remove()
    }
    meta = document.createElement("meta")
    meta.name = "theme-color"
    document.head.appendChild(meta)
  }
  meta.content = background
}

type ViewTransition = {
  ready: Promise<void>
  finished: Promise<void>
}

type DocumentWithViewTransition = Document & {
  startViewTransition?: (
    updateCallback: () => void | Promise<void>
  ) => ViewTransition
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "theme",
  disableTransitionOnChange = true,
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<Theme>(() => {
    const storedTheme = localStorage.getItem(storageKey)
    if (isTheme(storedTheme)) {
      return storedTheme
    }

    return defaultTheme
  })

  const isMountedRef = React.useRef(false)
  const currentThemeRef = React.useRef<ResolvedTheme | null>(null)

  const setTheme = React.useCallback(
    (nextTheme: Theme) => {
      localStorage.setItem(storageKey, nextTheme)
      setThemeState(nextTheme)
    },
    [storageKey]
  )

  const applyTheme = React.useCallback(
    (nextTheme: Theme) => {
      const root = document.documentElement
      const resolvedTheme =
        nextTheme === "system" ? getSystemTheme() : nextTheme

      const prevResolvedTheme = currentThemeRef.current
      currentThemeRef.current = resolvedTheme

      const updateDOM = () => {
        const restoreTransitions = disableTransitionOnChange
          ? disableTransitionsTemporarily()
          : null

        root.classList.remove("light", "dark")
        root.classList.add(resolvedTheme)
        root.setAttribute("data-theme", resolvedTheme)
        syncThemeColor()

        if (restoreTransitions) {
          restoreTransitions()
        }
      }

      // Skip view transition animation on initial page load or if theme didn't actually change
      if (!isMountedRef.current || prevResolvedTheme === resolvedTheme) {
        isMountedRef.current = true
        updateDOM()
        return
      }

      const doc = document as DocumentWithViewTransition
      const supportsViewTransition =
        typeof doc.startViewTransition === "function" &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches

      if (supportsViewTransition) {
        doc.startViewTransition(updateDOM)
      } else {
        updateDOM()
      }
    },
    [disableTransitionOnChange]
  )

  // The painted theme is derived, not mirrored: `system` resolves against the
  // OS setting, so a flip there re-renders through the store instead of an
  // effect writing state.
  const systemTheme = React.useSyncExternalStore(
    React.useCallback(
      (onChange) => {
        const media = window.matchMedia(COLOR_SCHEME_QUERY)
        const handleChange = () => {
          if (theme === "system") applyTheme("system")
          onChange()
        }
        media.addEventListener("change", handleChange)
        return () => media.removeEventListener("change", handleChange)
      },
      [applyTheme, theme]
    ),
    getSystemTheme
  )
  const resolvedTheme: ResolvedTheme = theme === "system" ? systemTheme : theme

  React.useEffect(() => {
    applyTheme(theme)
  }, [theme, applyTheme])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (isEditableTarget(event.target)) {
        return
      }

      if (event.key.toLowerCase() !== "d") {
        return
      }

      setThemeState((currentTheme) => {
        const nextTheme =
          currentTheme === "dark"
            ? "light"
            : currentTheme === "light"
              ? "dark"
              : getSystemTheme() === "dark"
                ? "light"
                : "dark"

        localStorage.setItem(storageKey, nextTheme)
        return nextTheme
      })
    }

    window.addEventListener("keydown", handleKeyDown)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [storageKey])

  React.useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.storageArea !== localStorage) {
        return
      }

      if (event.key !== storageKey) {
        return
      }

      if (isTheme(event.newValue)) {
        setThemeState(event.newValue)
        return
      }

      setThemeState(defaultTheme)
    }

    window.addEventListener("storage", handleStorageChange)

    return () => {
      window.removeEventListener("storage", handleStorageChange)
    }
  }, [defaultTheme, storageKey])

  const value = React.useMemo(
    () => ({
      theme,
      setTheme,
      resolvedTheme,
    }),
    [theme, setTheme, resolvedTheme]
  )

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = React.useContext(ThemeProviderContext)

  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }

  return context
}
