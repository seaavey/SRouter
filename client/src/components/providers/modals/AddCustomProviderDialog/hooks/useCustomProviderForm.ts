import { useRef, useState } from "react"

import {
  verifyCustomProvider,
  type AddCustomProviderInput,
} from "@/api/providers"
import type { ProviderProtocol } from "@/api/types"
import { toast } from "@/components/arc/toast-stack/toast-stack"

type CustomProviderForm = Required<AddCustomProviderInput> & {
  protocol: ProviderProtocol
}

type VerificationState =
  { status: "idle" } | { status: "checking" } | { status: "success" }

const INITIAL_FORM: CustomProviderForm = {
  name: "",
  prefix: "",
  protocol: "openai",
  base_url: "",
  api_key: "",
}

type UseCustomProviderFormOptions = {
  onSubmit: (input: AddCustomProviderInput) => Promise<void>
  onOpenChange: (open: boolean) => void
}

export default function useCustomProviderForm({
  onSubmit,
  onOpenChange,
}: UseCustomProviderFormOptions) {
  const [form, setForm] = useState(INITIAL_FORM)
  const [verification, setVerification] = useState<VerificationState>({
    status: "idle",
  })
  const [verifiedConfiguration, setVerifiedConfiguration] = useState<
    string | null
  >(null)
  const [addAttempted, setAddAttempted] = useState(false)
  const formRef = useRef<HTMLFormElement | null>(null)
  const baseURLRef = useRef<HTMLInputElement | null>(null)
  const apiKeyRef = useRef<HTMLInputElement | null>(null)
  // A probe that resolves after the endpoint moved on must be ignored, not
  // promote a configuration nobody is looking at any more.
  const verificationRun = useRef(0)

  function configurationKey() {
    return JSON.stringify({
      protocol: form.protocol,
      base_url: form.base_url.trim(),
      api_key: form.api_key.trim(),
    })
  }

  function invalidateVerification() {
    verificationRun.current += 1
    setVerifiedConfiguration(null)
    setVerification({ status: "idle" })
  }

  function updateForm(next: Partial<CustomProviderForm>) {
    setForm((current) => ({ ...current, ...next }))
    if ("protocol" in next || "base_url" in next || "api_key" in next) {
      invalidateVerification()
    }
  }

  function reset() {
    verificationRun.current += 1
    setVerifiedConfiguration(null)
    setAddAttempted(false)
    setForm(INITIAL_FORM)
    setVerification({ status: "idle" })
  }

  async function verify() {
    const fields = [baseURLRef.current, apiKeyRef.current]
    const firstInvalidField = fields.find(
      (field) => field && !field.validity.valid
    )
    if (firstInvalidField) {
      firstInvalidField.reportValidity()
      toast.error("Check the required fields", {
        description: "Enter a valid base URL and API key before checking.",
      })
      throw new Error("Enter a valid base URL and API key before checking.")
    }

    const run = verificationRun.current + 1
    verificationRun.current = run
    setVerifiedConfiguration(null)
    setVerification({ status: "checking" })

    try {
      const result = await verifyCustomProvider({
        protocol: form.protocol,
        base_url: form.base_url.trim(),
        api_key: form.api_key.trim(),
      })
      if (!result.success) throw new Error(result.message)

      if (verificationRun.current !== run) {
        throw new Error("Connection details changed during the check.")
      }

      setVerifiedConfiguration(configurationKey())
      setVerification({ status: "success" })
      toast.success("Provider connection verified", {
        description: result.message,
      })
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not verify this provider."
      const isStale = verificationRun.current !== run
      setVerifiedConfiguration(null)
      setVerification({ status: "idle" })
      if (!isStale) {
        toast.error("Provider verification failed", { description: message })
      }
      throw error instanceof Error
        ? error
        : new Error(message, { cause: error })
    }
  }

  async function submit() {
    setAddAttempted(true)
    if (!formRef.current?.reportValidity()) {
      toast.error("Complete the required fields", {
        description: "Add a provider name, valid base URL, and API key.",
      })
      return
    }

    try {
      await onSubmit({
        name: form.name.trim(),
        prefix: form.prefix.trim() || undefined,
        protocol: form.protocol,
        base_url: form.base_url.trim(),
        api_key: form.api_key.trim(),
      })
      reset()
      onOpenChange(false)
    } catch (error) {
      toast.error("Could not add provider", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      })
      throw error instanceof Error
        ? error
        : new Error("Could not add provider.", { cause: error })
    }
  }

  const canAddProvider =
    verification.status === "success" &&
    verifiedConfiguration === configurationKey() &&
    form.name.trim().length > 0 &&
    form.base_url.trim().length > 0 &&
    form.api_key.trim().length > 0

  return {
    form,
    updateForm,
    verification,
    addAttempted,
    canAddProvider,
    formRef,
    baseURLRef,
    apiKeyRef,
    verify,
    submit,
    reset,
  }
}
