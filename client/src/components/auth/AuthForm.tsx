import { useRef } from "react"
import type { FormEvent, ReactNode } from "react"

import ActionButton from "@/components/arc/action-button/action-button"

import { AUTH_BUTTON_CLASS } from "./types"

type AuthFormProps = {
  /** The credential fields. */
  children: ReactNode
  /** Whether the submit button accepts a click. */
  disabled: boolean
  /** Runs the sign-in. */
  onAction: () => Promise<void>
  pendingLabel: string
  submitLabel: string
  successLabel: string
}

/**
 * The form body of a sign-in card: the fields and the action button. The
 * button is a real submit button, so a press on Enter reaches it the same way
 * a click does.
 */
export default function AuthForm({
  children,
  disabled,
  onAction,
  pendingLabel,
  submitLabel,
  successLabel,
}: AuthFormProps) {
  const submitButtonRef = useRef<HTMLButtonElement>(null)

  function preventSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const submitter = (event.nativeEvent as SubmitEvent)?.submitter
    if (submitter !== submitButtonRef.current) {
      submitButtonRef.current?.click()
    }
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={preventSubmit}>
      <div className="flex flex-col gap-5">{children}</div>
      <div className="mt-1">
        <ActionButton
          ref={submitButtonRef}
          type="submit"
          className={AUTH_BUTTON_CLASS}
          label={submitLabel}
          pendingLabel={pendingLabel}
          successLabel={successLabel}
          shortcut="↵"
          disabled={disabled}
          onAction={onAction}
        />
      </div>
    </form>
  )
}
