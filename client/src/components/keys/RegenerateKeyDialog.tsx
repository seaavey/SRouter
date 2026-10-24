import { useState } from "react"

import type { APIKeyResponse } from "@/api/types"
import ActionButton from "@/components/arc/action-button/action-button"
import { Button } from "@/components/arc/button/button"
import { CopyButton } from "@/components/arc/copy-button/copy-button"
import { DialogClose } from "@/components/arc/dialog/dialog"
import ResponsiveDialog from "@/components/seavx/ResponsiveDialog"

type RegenerateKeyDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  keyRecord: APIKeyResponse | null
  /** Rotates on the server and resolves with the one-time new secret. */
  onConfirm: () => Promise<string>
}

/**
 * Two phases: confirm the rotation, then show the only copy of the new secret.
 * The old secret stops authenticating the moment the server answers, so the
 * consequence is stated before the action and the result is not dismissible by
 * accident without it being on screen.
 */
export function RegenerateKeyDialog({
  open,
  onOpenChange,
  keyRecord,
  onConfirm,
}: RegenerateKeyDialogProps) {
  const [secret, setSecret] = useState<string | null>(null)

  function handleOpenChange(next: boolean) {
    if (!next) setSecret(null)
    onOpenChange(next)
  }

  async function handleConfirm() {
    setSecret(await onConfirm())
  }

  const title = secret === null ? "Regenerate key" : "Key regenerated"
  const description =
    secret === null
      ? "A new secret replaces the current one, and the old secret stops authenticating immediately."
      : "This is the only time the new secret is shown. Store it before closing."

  const confirmBody = (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">
          {keyRecord?.name ?? "This key"}
        </span>{" "}
        keeps its id, name, limits and usage. Only its secret changes, so every
        client still sending the old one starts failing with 401.
      </p>
      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <DialogClose asChild>
          <Button type="button" variant="secondary" size="md">
            Cancel
          </Button>
        </DialogClose>
        <ActionButton
          label="Regenerate key"
          pendingLabel="Regenerating"
          successLabel="Regenerated"
          onAction={handleConfirm}
          disabled={keyRecord === null}
          className="w-full sm:w-auto"
        />
      </div>
    </div>
  )

  const secretBody = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground">Full secret</span>
        <div className="rounded-[var(--radius-control)] border border-border bg-surface-muted/50 p-3">
          <span className="font-mono text-xs break-all text-foreground">
            {secret}
          </span>
        </div>
        <CopyButton value={secret ?? ""} label="Copy key" />
      </div>
      <div className="flex justify-end">
        <DialogClose asChild>
          <Button type="button" variant="primary" size="md">
            Done
          </Button>
        </DialogClose>
      </div>
    </div>
  )

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={title}
      description={description}
      detents={[0.42, 0.75]}
      className="sm:max-w-lg"
    >
      {secret === null ? confirmBody : secretBody}
    </ResponsiveDialog>
  )
}
