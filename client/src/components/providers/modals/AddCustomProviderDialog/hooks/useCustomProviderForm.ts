import { useState } from "react"

import type { AddCustomProviderInput } from "@/api/providers"
import type { ProviderProtocol } from "@/api/types"
import { toast } from "@/components/arc/toast-stack/toast-stack"

type CustomProviderForm = Required<AddCustomProviderInput> & {
  protocol: ProviderProtocol
}

const INITIAL_FORM: CustomProviderForm = {
  name: "",
  prefix: "",
  protocol: "openai",
  base_url: "",
  api_key: "",
}

type UseCustomProviderFormOptions = {
  onSubmit: (input: AddCustomProviderInput) => Promise<void>
  onClose: () => void
  /** A verified probe stops meaning anything once the endpoint changes. */
  onCredentialsChange: () => void
}

export default function useCustomProviderForm({
  onSubmit,
  onClose,
  onCredentialsChange,
}: UseCustomProviderFormOptions) {
  const [values, setValues] = useState(INITIAL_FORM)

  const credentials = {
    protocol: values.protocol,
    base_url: values.base_url.trim(),
    api_key: values.api_key.trim(),
  }

  function updateForm(next: Partial<CustomProviderForm>) {
    setValues((current) => ({ ...current, ...next }))
    if ("protocol" in next || "base_url" in next || "api_key" in next) {
      onCredentialsChange()
    }
  }

  function reset() {
    setValues(INITIAL_FORM)
  }

  async function submit() {
    try {
      await onSubmit({
        name: values.name.trim(),
        prefix: values.prefix.trim() || undefined,
        ...credentials,
      })
      onClose()
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

  return { values, credentials, updateForm, reset, submit }
}
