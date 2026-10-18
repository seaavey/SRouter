import { Check, LoaderCircle } from "lucide-react"
import { useRef } from "react"
import type { FormEvent, ReactNode } from "react"

import type { ProviderProtocol } from "@/api/types"
import ActionButton from "@/components/arc/action-button/action-button"
import { Button } from "@/components/arc/button/button"
import { DialogClose } from "@/components/arc/dialog/dialog"
import { FloatingField } from "@/components/arc/floating-field/floating-field"
import { RadioCards } from "@/components/arc/radio-cards/radio-cards"

import useCustomProviderForm from "../hooks/useCustomProviderForm"
import useProviderProbe from "../hooks/useProviderProbe"

/**
 * A brand mark drawn in `currentColor`, which an `<img>` resolves to black and
 * would lose on the dark surface, so the shape is filled through a mask the way
 * `ProviderLogo` fills its monochrome assets. The `role`/`aria-label` pair is
 * what names the radio: the mark itself carries no text.
 */
function ProtocolMark({ asset, name }: { asset: string; name: string }) {
  return (
    <span
      role="img"
      aria-label={name}
      className="inline-block size-6 bg-foreground"
      style={{
        maskImage: `url(/providers/${asset}.svg)`,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskImage: `url(/providers/${asset}.svg)`,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
      }}
    />
  )
}

/**
 * The gateway executes two request shapes, not three: `ProviderShape::parse` in
 * `server/src/features/providers/custom/executor.rs` reads Anthropic and folds
 * everything else into OpenAI. A third "Custom" row would let an operator pick
 * a wire format the server then quietly treats as OpenAI, so the panel offers
 * only what the executor actually honours.
 */
const PROTOCOLS = [
  { value: "openai", label: <ProtocolMark asset="openai" name="OpenAI" /> },
  {
    value: "anthropic",
    label: <ProtocolMark asset="anthropic" name="Anthropic" />,
  },
] satisfies { value: ProviderProtocol; label: ReactNode }[]

type CustomProviderFormPanelProps = {
  form: ReturnType<typeof useCustomProviderForm>
  probe: ReturnType<typeof useProviderProbe>
}

export default function CustomProviderFormPanel({
  form,
  probe,
}: CustomProviderFormPanelProps) {
  const formRef = useRef<HTMLFormElement | null>(null)
  const baseURLRef = useRef<HTMLInputElement | null>(null)
  const apiKeyRef = useRef<HTMLInputElement | null>(null)
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
    if (protocol) form.updateForm({ protocol: protocol.value })
  }

  // ActionButton reports success whenever onAction resolves, so an invalid
  // field has to reject; reportValidity() is what tells the operator why.
  function checkConnection() {
    const invalid = [baseURLRef.current, apiKeyRef.current].find(
      (field) => field && !field.validity.valid
    )
    if (invalid) {
      invalid.reportValidity()
      throw new Error("Enter a valid base URL and API key first.")
    }
    return probe.check(form.credentials)
  }

  function addProvider() {
    if (!formRef.current?.reportValidity()) {
      throw new Error("The endpoint URL is not valid.")
    }
    return form.submit()
  }

  const canAdd =
    probe.status === "verified" &&
    form.values.name.trim().length > 0 &&
    form.credentials.base_url.length > 0 &&
    form.credentials.api_key.length > 0

  return (
    <form
      ref={formRef}
      onSubmit={preventSubmit}
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FloatingField
          id="custom-provider-name"
          label="Provider name"
          requiredMark
          autoComplete="off"
          value={form.values.name}
          onChange={(event) =>
            form.updateForm({ name: event.currentTarget.value })
          }
          placeholder="Acme AI"
          required
        />

        <FloatingField
          id="custom-provider-prefix"
          label="Model prefix (optional)"
          autoComplete="off"
          monospace
          value={form.values.prefix}
          onChange={(event) =>
            form.updateForm({ prefix: event.currentTarget.value })
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
          value={form.values.protocol}
          onValueChange={handleProtocolChange}
          options={PROTOCOLS}
        />
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FloatingField
          ref={baseURLRef}
          id="custom-provider-url"
          label="Base URL"
          requiredMark
          type="url"
          autoComplete="url"
          monospace
          value={form.values.base_url}
          onChange={(event) =>
            form.updateForm({ base_url: event.currentTarget.value })
          }
          placeholder="https://api.example.com/v1"
          required
        />

        <FloatingField
          ref={apiKeyRef}
          id="custom-provider-api-key"
          label="API key"
          requiredMark
          type="password"
          canTogglePassword
          monospace
          autoComplete="new-password"
          value={form.values.api_key}
          onChange={(event) =>
            form.updateForm({ api_key: event.currentTarget.value })
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
          onAction={checkConnection}
          className="!border-border !bg-surface !text-foreground"
        />
        {probe.status === "checking" && (
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
        {probe.status === "verified" && (
          <p
            role="status"
            className="flex items-center gap-2 text-xs text-success sm:max-w-64"
          >
            <Check size={14} aria-hidden="true" />
            Connection verified. Add provider is ready.
          </p>
        )}
        {probe.status === "idle" && (
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
          onAction={addProvider}
          disabled={!canAdd}
          className="w-full sm:w-auto"
        />
      </div>
    </form>
  )
}
