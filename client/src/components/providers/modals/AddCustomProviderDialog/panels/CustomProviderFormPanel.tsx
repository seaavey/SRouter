import { Check, LoaderCircle } from "lucide-react"
import { useRef } from "react"
import type { FormEvent } from "react"

import type { ProviderProtocol } from "@/api/types"
import ActionButton from "@/components/arc/action-button/action-button"
import { Button } from "@/components/arc/button/button"
import { DialogClose } from "@/components/arc/dialog/dialog"
import { FloatingField } from "@/components/arc/floating-field/floating-field"
import { RadioCards } from "@/components/arc/radio-cards/radio-cards"

import useCustomProviderForm from "../hooks/useCustomProviderForm"

/**
 * The gateway executes two request shapes, not three: `ProviderShape::parse` in
 * `server/src/features/providers/custom/executor.rs` reads Anthropic and folds
 * everything else into OpenAI. A third "Custom" row would let an operator pick
 * a wire format the server then quietly treats as OpenAI, so the panel offers
 * only what the executor actually honours.
 */
const PROTOCOLS = [
  {
    value: "openai",
    label: "OpenAI compatible",
    description: "POST /chat/completions with the OpenAI request shape.",
  },
  {
    value: "anthropic",
    label: "Anthropic compatible",
    description: "POST /v1/messages with the Anthropic Messages shape.",
  },
] satisfies { value: ProviderProtocol; label: string; description: string }[]

type CustomProviderFormPanelProps = {
  flow: ReturnType<typeof useCustomProviderForm>
}

export default function CustomProviderFormPanel({
  flow,
}: CustomProviderFormPanelProps) {
  // The submit button owns the action, so the form only forwards Enter-key
  // submits to it. Without this the button's own click and the form's submit
  // both fire and the provider is added twice.
  const submitButtonRef = useRef<HTMLButtonElement | null>(null)

  function preventSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const submitter = (event.nativeEvent as SubmitEvent)?.submitter
    if (submitter !== submitButtonRef.current) {
      submitButtonRef.current?.click()
    }
  }

  function handleProtocolChange(value: string) {
    const protocol = PROTOCOLS.find((option) => option.value === value)
    if (protocol) flow.updateForm({ protocol: protocol.value })
  }

  return (
    <form
      ref={flow.formRef}
      onSubmit={preventSubmit}
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FloatingField
          id="custom-provider-name"
          label="Provider name"
          requiredMark
          autoComplete="off"
          value={flow.form.name}
          onChange={(event) =>
            flow.updateForm({ name: event.currentTarget.value })
          }
          placeholder="Acme AI"
          aria-invalid={flow.addAttempted && flow.form.name.trim().length === 0}
          required
        />

        <FloatingField
          id="custom-provider-prefix"
          label="Model prefix (optional)"
          autoComplete="off"
          monospace
          value={flow.form.prefix}
          onChange={(event) =>
            flow.updateForm({ prefix: event.currentTarget.value })
          }
          placeholder="acme"
        />
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-xs font-medium text-foreground">
          Protocol
        </legend>
        <RadioCards
          aria-label="Protocol"
          name="custom-provider-protocol"
          layout="grid"
          minColumnWidth={220}
          value={flow.form.protocol}
          onValueChange={handleProtocolChange}
          options={PROTOCOLS}
        />
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FloatingField
          ref={flow.baseURLRef}
          id="custom-provider-url"
          label="Base URL"
          requiredMark
          type="url"
          autoComplete="url"
          monospace
          value={flow.form.base_url}
          onChange={(event) =>
            flow.updateForm({ base_url: event.currentTarget.value })
          }
          placeholder="https://api.example.com/v1"
          required
        />

        <FloatingField
          ref={flow.apiKeyRef}
          id="custom-provider-api-key"
          label="API key"
          requiredMark
          type="password"
          canTogglePassword
          monospace
          autoComplete="new-password"
          value={flow.form.api_key}
          onChange={(event) =>
            flow.updateForm({ api_key: event.currentTarget.value })
          }
          placeholder="sk-..."
          required
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ActionButton
          label="Check connection"
          pendingLabel="Checking connection"
          successLabel="Connection verified"
          onAction={flow.verify}
          className="!border-border !bg-surface !text-foreground"
        />
        {flow.verification.status === "checking" && (
          <p
            role="status"
            className="flex items-center gap-2 text-xs text-muted-foreground sm:max-w-64"
          >
            <LoaderCircle
              size={14}
              className="shrink-0 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            Checking the endpoint and API key.
          </p>
        )}
        {flow.verification.status === "success" && (
          <p
            role="status"
            className="flex items-center gap-2 text-xs text-success sm:max-w-64"
          >
            <Check size={14} aria-hidden="true" />
            Connection verified. Add provider is ready.
          </p>
        )}
        {flow.verification.status === "idle" && (
          <p className="text-xs text-muted-foreground">
            Verify this endpoint before adding it.
          </p>
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <DialogClose asChild>
          <Button type="button" variant="secondary" size="md">
            Cancel
          </Button>
        </DialogClose>
        <ActionButton
          ref={submitButtonRef}
          type="submit"
          label="Add provider"
          pendingLabel="Adding provider"
          successLabel="Provider added"
          onAction={flow.submit}
          disabled={!flow.canAddProvider}
          className="w-full sm:w-auto"
        />
      </div>
    </form>
  )
}
