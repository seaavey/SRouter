import { useRef, useState } from "react"
import type { FormEvent } from "react"

import { MAX_UPLOAD_BYTES, importDatabase } from "@/api/database"
import ActionButton from "@/components/arc/action-button/action-button"
import { Alert } from "@/components/arc/alert/alert"
import { Button } from "@/components/arc/button/button"
import { DialogClose } from "@/components/arc/dialog/dialog"
import { FileUpload } from "@/components/arc/file-upload/file-upload"
import type { FileUploadItem } from "@/components/arc/file-upload/file-upload"
import ResponsiveDialog from "@/components/seavx/ResponsiveDialog"

type RestoreDatabaseDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Restoring replaces every row and clears the session cookie, so the success
 * path is a hard reload onto the login screen: every cache entry in this tab
 * belongs to the database that was just replaced.
 */
export function RestoreDatabaseDialog({
  open,
  onOpenChange,
}: RestoreDatabaseDialogProps) {
  const [picked, setPicked] = useState<FileUploadItem[]>([])
  const [failure, setFailure] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)
  const submitRef = useRef<HTMLButtonElement | null>(null)

  // The picker keeps a refused file in its list so it can explain itself, so
  // only a file that cleared its own type and size check may arm the button.
  const file =
    picked[0] !== undefined && !picked[0].error ? picked[0].file : null

  // Enter inside a field submits the form, and the button also carries the
  // action: forward the keyboard submit to the button so one press runs it once.
  function preventSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const submitter = (event.nativeEvent as SubmitEvent)?.submitter
    if (submitter !== submitRef.current) submitRef.current?.click()
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setPicked([])
      setFailure(null)
    }
    onOpenChange(nextOpen)
  }

  async function handleRestore() {
    if (file === null) {
      throw new Error("Pick a database file first.")
    }

    try {
      await importDatabase(file)
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : "The database could not be restored."
      )
      throw error
    }

    window.location.assign("/login")
  }

  const title = "Restore from backup"
  const description =
    "Replaces every row in this gateway's database with the file you pick."

  const formBody = (
    <form
      ref={formRef}
      onSubmit={preventSubmit}
      className="flex flex-col gap-4"
    >
      <Alert tone="warning" title="This signs you out">
        The server saves the current database to
        ~/.srouter/backups/import-backup.db first, then replaces it and clears
        your session.
      </Alert>

      <FileUpload
        accept=".db,.gz,application/gzip"
        multiple={false}
        maxSize={MAX_UPLOAD_BYTES}
        label="Database file"
        description="A .db or .db.gz file exported from this gateway, up to 25 MB."
        value={picked}
        onChange={setPicked}
      />

      {failure !== null ? (
        <Alert tone="danger" title="Could not restore the database">
          {failure}
        </Alert>
      ) : null}

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <DialogClose asChild>
          <Button type="button" variant="secondary" size="md">
            Cancel
          </Button>
        </DialogClose>
        <ActionButton
          ref={submitRef}
          type="submit"
          label="Restore database"
          pendingLabel="Restoring database"
          successLabel="Restored"
          onAction={handleRestore}
          disabled={file === null}
          className="w-full sm:w-auto"
        />
      </div>
    </form>
  )

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={title}
      description={description}
      className="sm:max-w-lg"
    >
      {formBody}
    </ResponsiveDialog>
  )
}
