import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import type { UserResponse } from "@/api/types"
import { rotateUserToken } from "@/api/users"
import ActionButton from "@/components/arc/action-button/action-button"
import { Alert } from "@/components/arc/alert/alert"
import { Button } from "@/components/arc/button/button"
import { CopyButton } from "@/components/arc/copy-button/copy-button"
import { DialogClose } from "@/components/arc/dialog/dialog"
import { toast } from "@/components/arc/toast-stack/toast-stack"
import ResponsiveDialog from "@/components/seavx/ResponsiveDialog"

type TokenDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  userRecord: UserResponse | null
}

export default function TokenDialog({
  open,
  onOpenChange,
  userRecord,
}: TokenDialogProps) {
  const queryClient = useQueryClient()
  const [token, setToken] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      onOpenChange(true)
      return
    }
    if (token !== null) {
      void queryClient.invalidateQueries({ queryKey: ["users"] })
      toast.success("Login token replaced")
    }
    setToken(null)
    setFailure(null)
    onOpenChange(false)
  }

  async function handleRotate() {
    if (userRecord === null) return

    try {
      const rotated = await rotateUserToken(userRecord.id)
      setFailure(null)
      setToken(rotated.token)
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "Could not replace the token."
      )
      throw error
    }
  }

  const title = token === null ? "New login token" : "Login token replaced"
  const description =
    token === null
      ? `Replacing the token for ${userRecord?.name ?? "this account"} signs the account out everywhere. The old token stops working immediately.`
      : "This is the only time this token is shown. Store it now."

  const confirmBody = (
    <div className="flex flex-col gap-4">
      {failure !== null && (
        <Alert tone="danger" title="Could not replace the token">
          {failure}
        </Alert>
      )}

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <DialogClose asChild>
          <Button type="button" variant="secondary" size="md">
            Cancel
          </Button>
        </DialogClose>
        <ActionButton
          label="Replace token"
          pendingLabel="Replacing token"
          successLabel="Token replaced"
          onAction={handleRotate}
          disabled={userRecord === null}
          className="w-full sm:w-auto"
        />
      </div>
    </div>
  )

  const tokenBody = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground">Login token</span>
        <div className="rounded-[var(--radius-control)] border border-border bg-surface-muted/50 p-3">
          <span className="font-mono text-xs break-all text-foreground">
            {token}
          </span>
        </div>
        <CopyButton value={token ?? ""} label="Copy token" />
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
    >
      {token === null ? confirmBody : tokenBody}
    </ResponsiveDialog>
  )
}
