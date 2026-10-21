/** The credential the sign-in card collects. */
export type LoginMode = "password" | "token"

/** What the gateway is doing, as the footer reports it. */
export type AuthConnection = "connecting" | "offline" | "online"

/** Who the footer says is signing in. */
export type AuthAudience = "operator" | "customer"

export const LOGIN_MODE_OPTIONS: { value: LoginMode; label: string }[] = [
  { value: "password", label: "Password" },
  { value: "token", label: "Access token" },
]

/**
 * The full-width action button every button on the sign-in screen wears.
 * ActionButton styles itself through a CSS module, so the overrides need the
 * `!` prefix to win over it.
 */
export const AUTH_BUTTON_CLASS =
  "!min-h-11 !w-full !cursor-pointer !rounded-lg !text-sm !font-medium !tracking-tight transition-colors duration-150 focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-foreground dark:not-disabled:!border-white dark:not-disabled:!bg-white dark:not-disabled:!text-black dark:hover:not-disabled:!bg-zinc-100 dark:disabled:!cursor-not-allowed dark:disabled:!border-white/8 dark:disabled:!bg-white/6 dark:disabled:!text-white/35 dark:disabled:!opacity-100"
