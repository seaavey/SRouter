import type { AddCustomProviderInput } from "@/api/providers"
import ResponsiveDialog from "@/components/seavx/ResponsiveDialog"

import CustomProviderFormPanel from "./panels/CustomProviderFormPanel"
import useCustomProviderForm from "./hooks/useCustomProviderForm"

type AddCustomProviderDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: AddCustomProviderInput) => Promise<void>
}

export default function AddCustomProviderDialog({
  open,
  onOpenChange,
  onSubmit,
}: AddCustomProviderDialogProps) {
  const flow = useCustomProviderForm({ onSubmit, onOpenChange })

  // Dismissing clears the fields and the probe, so the next open starts where
  // the first one did; a successful submit resets itself in the hook.
  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) flow.reset()
    onOpenChange(nextOpen)
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Add custom provider"
      description="Register a public endpoint. The gateway blocks private and localhost destinations."
      detents={[0.85, 0.96]}
      className="!max-h-[92vh] sm:max-w-2xl"
      sheetClassName="space-y-4 px-1 pt-1 pb-6"
    >
      <CustomProviderFormPanel flow={flow} />
    </ResponsiveDialog>
  )
}
