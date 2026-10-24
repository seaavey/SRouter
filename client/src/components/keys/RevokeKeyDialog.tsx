import type { APIKeyResponse } from "@/api/types"
import { Button } from "@/components/arc/button/button"
import { DialogClose } from "@/components/arc/dialog/dialog"
import ResponsiveDialog from "@/components/seavx/ResponsiveDialog"

type RevokeKeyDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  keyRecord: APIKeyResponse | null
  onConfirm: () => Promise<void>
}

/**
 * Revoking is the one irreversible row action, so it gets a surface that names
 * the key and the consequence instead of a red control sitting in every row.
 */
export function RevokeKeyDialog({
  open,
  onOpenChange,
  keyRecord,
  onConfirm,
}: RevokeKeyDialogProps) {
  async function handleConfirm() {
    try {
      await onConfirm()
      onOpenChange(false)
    } catch {
      // The caller reports the failure; the dialog stays open so it can be retried.
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Revoke key"
      description="The key stops authenticating immediately and cannot be restored."
      detents={[0.4, 0.7]}
      className="sm:max-w-lg"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {keyRecord?.name ?? "This key"}
          </span>{" "}
          <span className="font-mono">{keyRecord?.key_prefix}</span> will be
          deleted. Any client still sending it starts failing with 401.
        </p>
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button type="button" variant="secondary" size="md">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="danger"
            size="md"
            disabled={keyRecord === null}
            onClick={handleConfirm}
            className="w-full sm:w-auto"
          >
            Revoke key
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  )
}
