import type { AddCustomProviderInput } from "@/api/providers"
import ResponsiveDialog from "@/components/seavx/ResponsiveDialog"

import CustomProviderFormPanel from "./panels/CustomProviderFormPanel"
import useCustomProviderForm from "./hooks/useCustomProviderForm"
import useProviderProbe from "./hooks/useProviderProbe"

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
  const probe = useProviderProbe()
  const form = useCustomProviderForm({
    onSubmit,
    onClose: close,
    onCredentialsChange: probe.reset,
  })

  // One close path for the shell, the footer, Escape, and a successful submit,
  // so the next open can never inherit a field or a verified probe.
  function close() {
    form.reset()
    probe.reset()
    onOpenChange(false)
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) onOpenChange(true)
    else close()
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
      <CustomProviderFormPanel form={form} probe={probe} />
    </ResponsiveDialog>
  )
}
