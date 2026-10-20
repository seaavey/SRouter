import { useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import type { FormEvent } from "react"

import type { UserResponse } from "@/api/types"
import { updateUser } from "@/api/users"
import ActionButton from "@/components/arc/action-button/action-button"
import { Button } from "@/components/arc/button/button"
import { DialogClose } from "@/components/arc/dialog/dialog"
import { FloatingField } from "@/components/arc/floating-field/floating-field"
import { toast } from "@/components/arc/toast-stack/toast-stack"
import ResponsiveDialog from "@/components/seavx/ResponsiveDialog"

type RenameUserDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  userRecord: UserResponse | null
}

export default function RenameUserDialog({
  open,
  onOpenChange,
  userRecord,
}: RenameUserDialogProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [seedID, setSeedID] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)
  const submitRef = useRef<HTMLButtonElement | null>(null)

  // Seed from the row that opened the dialog, the way EditKeyDialog does.
  if (userRecord !== null && userRecord.id !== seedID) {
    setSeedID(userRecord.id)
    setName(userRecord.name)
  }

  const named = name.trim().length > 0

  function preventSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const submitter = (event.nativeEvent as SubmitEvent)?.submitter
    if (submitter !== submitRef.current) submitRef.current?.click()
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setName("")
      setSeedID(null)
    }
    onOpenChange(nextOpen)
  }

  async function handleRename() {
    if (userRecord === null) return
    if (!formRef.current?.reportValidity()) {
      throw new Error("Name the user.")
    }

    try {
      await updateUser(userRecord.id, { name: name.trim() })
      void queryClient.invalidateQueries({ queryKey: ["users"] })
      toast.success("User renamed")
      handleOpenChange(false)
    } catch (error) {
      toast.error("Could not rename the user", {
        description: error instanceof Error ? error.message : undefined,
      })
      throw error
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Rename user"
      description="The login token and the keys the account owns are unaffected."
    >
      <form
        ref={formRef}
        onSubmit={preventSubmit}
        className="flex flex-col gap-4"
      >
        <FloatingField
          id="rename-user-name"
          label="Name"
          requiredMark
          required
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder="Acme Labs"
        />

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button type="button" variant="secondary" size="md">
              Cancel
            </Button>
          </DialogClose>
          <ActionButton
            ref={submitRef}
            type="submit"
            label="Save name"
            pendingLabel="Saving name"
            successLabel="Name saved"
            onAction={handleRename}
            disabled={!named}
            className="w-full sm:w-auto"
          />
        </div>
      </form>
    </ResponsiveDialog>
  )
}
