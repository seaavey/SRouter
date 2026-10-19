import { Check, LoaderCircle, ShieldCheck } from "lucide-react"
import { useRef } from "react"
import type { FormEvent, ReactNode } from "react"

import type { ProviderProtocol } from "@/api/types"
import ActionButton from "@/components/arc/action-button/action-button"
import { Button } from "@/components/arc/button/button"
import { DialogClose } from "@/components/arc/dialog/dialog"
import { FloatingField } from "@/components/arc/floating-field/floating-field"
import { RadioCards } from "@/components/arc/radio-cards/radio-cards"
import { cn } from "@/lib/utils"

import useCustomProviderForm from "../hooks/useCustomProviderForm"
import useProviderProbe from "../hooks/useProviderProbe"

/**
 * A brand mark rendered inside a container filled with each vendor's signature
 * brand color (#10A37F for OpenAI, #D97757 for Anthropic). The glyph itself is
 * filled in white through a mask so monochrome assets retain contrast on both
 * light and dark surfaces. The `role`/`aria-label` pair names the radio: the
 * mark itself carries no text.
 */
function ProtocolMark({
  asset,
  name,
  brandColor,
}: {
  asset: string
  name: string
  brandColor: string
}) {
  return (
    <span
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg shadow-xs"
      style={{ backgroundColor: brandColor }}
    >
      <span
        role="img"
        aria-label={name}
        className="inline-block size-5 bg-white"
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
    </span>
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
  {
    value: "openai",
    label: (
      <div className="flex items-start gap-2.5">
        <ProtocolMark asset="openai" name="OpenAI" brandColor="#10A37F" />
        <span className="mt-0.5 text-xs font-medium">OpenAI</span>
      </div>
    ),
  },
  {
    value: "anthropic",
    label: (
      <div className="flex items-start gap-2.5">
        <ProtocolMark asset="anthropic" name="Anthropic" brandColor="#D97757" />
        <span className="mt-0.5 text-xs font-medium">Anthropic</span>
      </div>
    ),
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

  async function handleCheckConnection() {
    try {
      await checkConnection()
    } catch {
      // reportValidity() or toast in useProviderProbe already alerted the operator
    }
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

      <div
        className={cn(
          "flex flex-col gap-3 rounded-2xl border p-3.5 transition-colors sm:flex-row sm:items-center sm:justify-between",
          probe.status === "verified"
            ? "border-success/30 bg-success/5"
            : "border-border bg-surface-muted/40"
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors",
              probe.status === "verified"
                ? "bg-success/15 text-success"
                : probe.status === "checking"
                  ? "border border-border bg-surface-raised text-foreground"
                  : "border border-border bg-surface text-muted-foreground"
            )}
          >
            {probe.status === "checking" ? (
              <LoaderCircle
                size={17}
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : probe.status === "verified" ? (
              <Check size={17} strokeWidth={2.5} aria-hidden="true" />
            ) : (
              <ShieldCheck size={17} aria-hidden="true" />
            )}
          </div>

          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "text-xs leading-tight font-medium",
                  probe.status === "verified"
                    ? "text-success"
                    : "text-foreground"
                )}
              >
                {probe.status === "verified"
                  ? "Connection verified"
                  : probe.status === "checking"
                    ? "Checking connection…"
                    : "Endpoint verification"}
              </span>
              {probe.status === "verified" && (
                <span className="inline-flex items-center rounded-full bg-success/15 px-1.5 py-0.5 text-xs font-medium text-success">
                  Ready
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {probe.status === "verified"
                ? "Endpoint verified. Add provider is ready."
                : probe.status === "checking"
                  ? "Checking the endpoint and API key…"
                  : "Verify this endpoint before adding it."}
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant={probe.status === "verified" ? "secondary" : "primary"}
          size="sm"
          loading={probe.status === "checking"}
          onClick={handleCheckConnection}
          className="w-full shrink-0 font-medium sm:w-auto"
        >
          {probe.status === "verified" ? "Re-test" : "Check connection"}
        </Button>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-end">
        <DialogClose asChild>
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="w-full sm:w-auto"
          >
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
