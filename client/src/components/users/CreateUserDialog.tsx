import { useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import type { FormEvent } from "react"

import { createUser } from "@/api/users"
import ActionButton from "@/components/arc/action-button/action-button"
import { Alert } from "@/components/arc/alert/alert"
import { Button } from "@/components/arc/button/button"
import { CopyButton } from "@/components/arc/copy-button/copy-button"
import { DialogClose } from "@/components/arc/dialog/dialog"
import { FloatingField } from "@/components/arc/floating-field/floating-field"
import { toast } from "@/components/arc/toast-stack/toast-stack"
import ResponsiveDialog from "@/components/seavx/ResponsiveDialog"

type CreateUserDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function CreateUserDialog({
  open,
  onOpenChange,
}: CreateUserDialogProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [token, setToken] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)
  const submitRef = useRef<HTMLButtonElement | null>(null)
  const named = name.trim().length > 0

  function preventSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const submitter = (event.nativeEvent as SubmitEvent)?.submitter
    if (submitter !== submitRef.current) submitRef.current?.click()
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      onOpenChange(true)
      return
    }
    if (token !== null) {
      void queryClient.invalidateQueries({ queryKey: ["users"] })
      toast.success("User created")
    }
    setName("")
    setToken(null)
    setFailure(null)
    onOpenChange(false)
  }

  async function handleCreate() {
    if (!formRef.current?.reportValidity()) {
      throw new Error("Name the user.")
    }

    try {
      const created = await createUser({ name: name.trim() })
      setFailure(null)
      setToken(created.token)
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "Could not create the user."
      )
      throw error
    }
  }

  const title = token === null ? "Create user" : "User created"
  const description =
    token === null
      ? "Create an account for a customer. They sign in to the console with the token you see next."
      : "This is the only time this token is shown. Store it now."

  const formBody = (
    <form
      ref={formRef}
      onSubmit={preventSubmit}
      className="flex flex-col gap-4"
    >
      <FloatingField
        id="user-name"
        label="Name"
        requiredMark
        required
        autoComplete="off"
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
        placeholder="Acme Labs"
      />

      {failure !== null && (
        <Alert tone="danger" title="Could not create the user">
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
          ref={submitRef}
          type="submit"
          label="Create user"
          pendingLabel="Creating user"
          successLabel="User created"
          onAction={handleCreate}
          disabled={!named}
          className="w-full sm:w-auto"
        />
      </div>
    </form>
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
      {token === null ? formBody : tokenBody}
    </ResponsiveDialog>
  )
}
