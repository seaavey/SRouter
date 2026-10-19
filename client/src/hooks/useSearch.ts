import { useCallback, useMemo, useState } from "react"
import { useDebounce } from "@/hooks/useDebounce"

export interface UseSearchOptions<T> {
  /** Initial query string. Defaults to empty string. */
  initialQuery?: string
  /**
   * Delay in milliseconds before updating debouncedQuery and filtering.
   * When 0 or negative, updates are synchronous with keystrokes.
   */
  debounceMs?: number
  /**
   * Keys on the item to compare against the query.
   * If omitted and `filter` is omitted, searches string and number values on the object.
   */
  keys?: readonly (keyof T)[]
  /**
   * Custom filter predicate. Receives the item and lowercase trimmed query.
   * When provided, overrides `keys`.
   */
  filter?: (item: T, normalizedQuery: string) => boolean
}

export interface UseSearchResult<T> {
  /** The current search query string */
  query: string
  /** Debounced search query string (equals query when debounceMs is 0) */
  debouncedQuery: string
  /** Update the search query */
  setQuery: (query: string) => void
  /** Reset the search query to an empty string */
  clear: () => void
  /** Whether a non-empty trimmed search query exists */
  hasQuery: boolean
  /** Filtered collection based on the search query */
  filteredItems: T[]
  /** Props ready to spread onto UI Arc's SearchField component */
  fieldProps: {
    value: string
    onValueChange: (value: string) => void
  }
}

/**
 * Filter items in memory against a query string with optional debouncing.
 * Returns `fieldProps` that drop directly onto UI Arc's `SearchField`.
 */
export function useSearch<T = never>(
  items?: readonly T[],
  options?: UseSearchOptions<T>
): UseSearchResult<T> {
  const [query, setQueryState] = useState(options?.initialQuery ?? "")
  const debounceMs = options?.debounceMs ?? 0
  const debouncedQuery = useDebounce(query, debounceMs)

  const setQuery = useCallback((next: string) => {
    setQueryState(next)
  }, [])

  const clear = useCallback(() => {
    setQueryState("")
  }, [])

  const filterFn = options?.filter
  const keys = options?.keys

  const filteredItems = useMemo(() => {
    if (!items || items.length === 0) return []

    const normalized = (debounceMs > 0 ? debouncedQuery : query)
      .trim()
      .toLowerCase()
    if (!normalized) return [...items]

    if (filterFn) {
      return items.filter((item) => filterFn(item, normalized))
    }

    if (keys && keys.length > 0) {
      return items.filter((item) =>
        keys.some((key) => {
          const val = item[key]
          if (typeof val === "string") {
            return val.toLowerCase().includes(normalized)
          }
          if (typeof val === "number") {
            return String(val).includes(normalized)
          }
          return false
        })
      )
    }

    return items.filter((item) => {
      if (typeof item === "string") {
        return item.toLowerCase().includes(normalized)
      }
      if (typeof item === "object" && item !== null) {
        const record = item as Record<
          string,
          string | number | boolean | null | undefined
        >
        return Object.values(record).some((val) => {
          if (typeof val === "string") {
            return val.toLowerCase().includes(normalized)
          }
          if (typeof val === "number") {
            return String(val).includes(normalized)
          }
          return false
        })
      }
      return false
    })
  }, [items, debounceMs, debouncedQuery, query, filterFn, keys])

  const fieldProps = useMemo(
    () => ({
      value: query,
      onValueChange: setQuery,
    }),
    [query, setQuery]
  )

  const hasQuery = query.trim().length > 0

  return {
    query,
    debouncedQuery,
    setQuery,
    clear,
    hasQuery,
    filteredItems,
    fieldProps,
  }
}

export default useSearch
