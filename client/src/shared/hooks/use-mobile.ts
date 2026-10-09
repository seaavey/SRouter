import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

/**
 * `useSyncExternalStore` rather than an effect that sets state: the media query
 * is an external store, and subscribing to it this way reads the correct value
 * on the first render instead of rendering desktop, then correcting to mobile.
 */
function subscribe(onChange: () => void) {
  const mediaQuery = window.matchMedia(QUERY)
  mediaQuery.addEventListener("change", onChange)

  return () => mediaQuery.removeEventListener("change", onChange)
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches
}

/** The server has no viewport; assume desktop, matching the sidebar's default. */
function getServerSnapshot() {
  return false
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
