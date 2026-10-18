import { useRef, useState } from "react"

import {
  verifyCustomProvider,
  type AddCustomProviderInput,
} from "@/api/providers"
import { toast } from "@/components/arc/toast-stack/toast-stack"

type ProbeStatus = "idle" | "checking" | "verified"

type ProbeCredentials = Pick<
  AddCustomProviderInput,
  "protocol" | "base_url" | "api_key"
>

export default function useProviderProbe() {
  const [status, setStatus] = useState<ProbeStatus>("idle")
  // A probe that resolves after the endpoint moved on must be ignored, not
  // promote a configuration nobody is looking at any more.
  const run = useRef(0)

  function reset() {
    run.current += 1
    setStatus("idle")
  }

  async function check(credentials: ProbeCredentials) {
    const current = run.current + 1
    run.current = current
    setStatus("checking")

    try {
      const result = await verifyCustomProvider(credentials)
      if (!result.success) throw new Error(result.message)
      if (run.current !== current) {
        throw new Error("Connection details changed during the check.")
      }

      setStatus("verified")
      toast.success("Provider connection verified", {
        description: result.message,
      })
    } catch (error) {
      // A stale rejection must not touch the status: a newer probe may already
      // be the one the dialog is waiting on.
      if (run.current === current) {
        setStatus("idle")
        toast.error("Provider verification failed", {
          description:
            error instanceof Error
              ? error.message
              : "Could not verify this provider.",
        })
      }
      throw error instanceof Error
        ? error
        : new Error("Could not verify this provider.", { cause: error })
    }
  }

  return { status, check, reset }
}
