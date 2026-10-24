import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { providersListQuery } from "@/api/providers"

/**
 * Routing id to the driver's display name. A custom provider's id is a UUID,
 * so a log row that printed the id would name nothing an operator recognises.
 * Both the table and the detail sheet read the same cached list.
 */
export default function useProviderNames() {
  const { data } = useQuery(providersListQuery)
  return useMemo(
    () =>
      new Map(
        (data?.data ?? []).map((provider) => [provider.id, provider.name])
      ),
    [data]
  )
}
