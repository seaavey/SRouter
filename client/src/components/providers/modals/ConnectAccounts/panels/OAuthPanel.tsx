import {
  ExternalLink,
  Info,
  LoaderCircle,
  ShieldCheck,
  X,
  Clipboard,
} from "lucide-react"
import { useRef } from "react"

import ActionButton from "@/components/arc/action-button/action-button"
import { Button } from "@/components/arc/button/button"
import { CopyButton } from "@/components/arc/copy-button/copy-button"
import { FloatingField } from "@/components/arc/floating-field/floating-field"

import useOAuthFlow from "../hooks/useOAuthFlow"

type OAuthPanelProps = {
  flow: ReturnType<typeof useOAuthFlow>
  providerName?: string
}

export default function OAuthPanel({ flow, providerName }: OAuthPanelProps) {
  const {
    oauthData,
    callbackInput,
    setCallbackInput,
    pending,
    start,
    pasteCallback,
    complete,
    reset,
  } = flow

  // The submit button owns the action, so the form only forwards Enter-key
  // submits to it. Without this the button's own click and the form's submit
  // both fire and the callback is exchanged twice.
  const submitButtonRef = useRef<HTMLButtonElement>(null)

  if (!oauthData) {
    return (
      <div className="space-y-3.5 rounded-xl border border-border/80 bg-surface-muted/30 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck size={16} aria-hidden="true" />
          </div>
          <div className="text-xs">
            <span className="block font-medium text-foreground">
              Vendor sign-in portal
            </span>
            <span className="mt-1 block leading-relaxed text-muted-foreground">
              Click below to generate a secure PKCE session and open the
              official provider login portal in a new browser tab.
            </span>
          </div>
        </div>

        <ActionButton
          label="Open login window"
          pendingLabel="Opening login window…"
          successLabel="Window opened"
          onAction={start}
          className="h-9 w-full font-medium"
        />
      </div>
    )
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const submitter = (event.nativeEvent as SubmitEvent)?.submitter
        if (submitter !== submitButtonRef.current) {
          submitButtonRef.current?.click()
        }
      }}
      className="space-y-3.5 rounded-xl border border-border/80 bg-surface-muted/30 p-4"
    >
      {flow.isPolling ? (
        <div className="flex items-start gap-2.5" role="status">
          <LoaderCircle
            size={14}
            className="mt-0.5 shrink-0 animate-spin text-primary motion-reduce:animate-none"
            aria-hidden="true"
          />
          <div className="min-w-0 text-xs leading-relaxed">
            <span className="block font-medium text-foreground">
              Waiting for approval in browser…
            </span>
            <span className="mt-0.5 block text-muted-foreground">
              Approve the request on {providerName ?? "the provider"}; this
              dialog saves the account and closes as soon as it lands.
            </span>
          </div>
        </div>
      ) : (
        <div className="text-xs leading-relaxed">
          <span className="block font-medium text-foreground">
            Paste the callback URL or code
          </span>
          <span className="mt-0.5 block text-muted-foreground">
            Finish the sign-in on {providerName ?? "the provider"}, then paste
            what came back.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <CopyButton
          value={oauthData.authorize_url}
          label="Copy link"
          variant="outline"
        />
        <a
          href={oauthData.authorize_url}
          target="_blank"
          rel="noopener noreferrer"
          title="Reopen the authorization page"
          className="inline-flex min-h-[var(--control-height-sm)] items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted"
        >
          <ExternalLink size={13} aria-hidden="true" />
          <span>Re-open sign-in</span>
        </a>
      </div>

      <p className="flex items-start gap-2 rounded-lg border border-border/60 bg-surface/60 p-2.5 text-xs leading-relaxed text-muted-foreground">
        <Info
          size={14}
          className="mt-0.5 shrink-0 text-primary"
          aria-hidden="true"
        />
        <span>
          If the browser tab ends on <em>&quot;Unable to connect&quot;</em>,
          copy the whole URL from the address bar and paste it below.
        </span>
      </p>

      <FloatingField
        label="Callback URL or authorization code"
        value={callbackInput}
        onChange={(event) => setCallbackInput(event.target.value)}
        monospace
        endAction={
          callbackInput ? (
            <button
              type="button"
              onClick={() => setCallbackInput("")}
              className="inline-flex cursor-pointer items-center p-1 text-muted-foreground hover:text-foreground"
              title="Clear input"
            >
              <X size={14} />
            </button>
          ) : (
            <button
              type="button"
              onClick={pasteCallback}
              className="inline-flex cursor-pointer items-center gap-1 rounded border border-border/70 bg-surface-muted/90 px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              title="Paste from clipboard"
            >
              <Clipboard size={11} />
              <span>Paste</span>
            </button>
          )
        }
      />

      <div className="flex items-center gap-2 pt-1">
        <ActionButton
          ref={submitButtonRef}
          type="submit"
          label="Confirm & connect"
          pendingLabel="Verifying…"
          successLabel="Connected"
          onAction={complete}
          disabled={pending || !callbackInput.trim()}
          className="h-9 flex-1 font-medium"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={reset}
          disabled={pending}
          className="h-9"
        >
          Reset
        </Button>
      </div>
    </form>
  )
}
