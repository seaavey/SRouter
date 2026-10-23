import { useEffect, useState } from "react"

import {
  completeOAuthCallback,
  initiateOAuthLogin,
  pollOAuthSession,
  type OAuthLoginResult,
} from "@/api/providers"
import { toast } from "@/components/arc/toast-stack/toast-stack"
import useClipboard from "@/hooks/useClipboard"

type UseOAuthFlowOptions = {
  providerID: string
  onSuccess: () => void
  onOpenChange: (open: boolean) => void
}

export default function useOAuthFlow({
  providerID,
  onSuccess,
  onOpenChange,
}: UseOAuthFlowOptions) {
  const [oauthData, setOauthData] = useState<OAuthLoginResult | null>(null)
  const [callbackInput, setCallbackInput] = useState("")
  const [pending, setPending] = useState(false)
  const { paste } = useClipboard()

  const normalized = providerID.toLowerCase()
  const isDeviceFlow =
    normalized.includes("qoder") ||
    normalized.includes("cline") ||
    normalized.includes("codebuddy") ||
    normalized.includes("commandcode")

  useEffect(() => {
    if (!oauthData?.state || !isDeviceFlow) {
      return
    }

    const stateToken = oauthData.state
    let cancelled = false
    let inFlight = false

    const poll = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const res = await pollOAuthSession(providerID, stateToken)
        if (res.status === "ok") {
          if (cancelled) return
          window.clearInterval(interval)
          setOauthData(null)
          setCallbackInput("")
          toast.success("Account connected successfully!")
          onSuccess()
          onOpenChange(false)
        }
      } catch {
        // Ignored; poll keeps trying until dismissed or approved
      } finally {
        inFlight = false
      }
    }

    // StrictMode replays effects in development; defer the first request until
    // the interval established by the surviving setup fires.
    const interval = window.setInterval(() => {
      void poll()
    }, 2000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [oauthData?.state, isDeviceFlow, providerID, onSuccess, onOpenChange])

  async function start() {
    setPending(true)
    try {
      const result = await initiateOAuthLogin(providerID)
      setOauthData(result)
      if (result.authorize_url) {
        window.open(result.authorize_url, "_blank", "noopener,noreferrer")
      }
      toast.success("Authorization window opened. Complete login in browser.")
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to initiate OAuth login"
      )
    } finally {
      setPending(false)
    }
  }

  async function pasteCallback() {
    const text = await paste()
    if (text === null) {
      toast.error("Clipboard permission unavailable. Paste manually.")
      return
    }
    if (text.trim()) {
      setCallbackInput(text.trim())
      toast.success("Pasted from clipboard")
    }
  }

  async function complete() {
    if (!callbackInput.trim()) {
      toast.error("Please enter the redirected callback URL or code")
      return
    }

    setPending(true)
    try {
      const isUrl = callbackInput.startsWith("http")
      await completeOAuthCallback(providerID, {
        state: oauthData?.state,
        ...(isUrl
          ? { callback_url: callbackInput.trim() }
          : { code: callbackInput.trim() }),
      })
      toast.success("Account connected successfully!")
      onSuccess()
      onOpenChange(false)
      setOauthData(null)
      setCallbackInput("")
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to complete authorization"
      )
    } finally {
      setPending(false)
    }
  }

  function reset() {
    setOauthData(null)
    setCallbackInput("")
  }

  return {
    oauthData,
    callbackInput,
    setCallbackInput,
    pending,
    isPolling: Boolean(oauthData?.state && isDeviceFlow),
    isDeviceFlow,
    start,
    pasteCallback,
    complete,
    reset,
  }
}
