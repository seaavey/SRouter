import { useQuery } from "@tanstack/react-query"

import { usersQuery } from "@/api/users"
import { FloatingField } from "@/components/arc/floating-field/floating-field"
import { Switch } from "@/components/arc/switch/switch"

import type {
  APIKeyResponse,
  CreateAPIKeyInput,
  UpdateAPIKeyInput,
} from "@/api/types"

import { ModelAllowlistField } from "./ModelAllowlistField"

/**
 * Both key forms edit the same fields, so the state shape, the field block, and
 * the conversion to the wire live in one module.
 */
export type KeyFormValues = {
  name: string
  /** `""` is unassigned; the wire speaks `null`, which the input builders map. */
  user_id: string
  enabled: boolean
  rate_limit: string
  quota_limit: string
  credit_limit: string
  allowed_models: string[]
}

export const EMPTY_KEY_FORM: KeyFormValues = {
  name: "",
  user_id: "",
  enabled: true,
  rate_limit: "",
  quota_limit: "",
  credit_limit: "",
  allowed_models: [],
}

type KeyFormFieldsProps = {
  values: KeyFormValues
  onChange: (patch: Partial<KeyFormValues>) => void
  showEnabled?: boolean
}

/** A stored limit renders as its own text, with `0` shown as the empty box that produced it. */
const limitText = (value: number | null) => (value ? String(value) : "")

/** `0` and out-of-range input both mean "no limit", which is how the server reads `0`. */
function limitValue(text: string, fractional = false) {
  const value = Number(text)
  if (!Number.isFinite(value) || value <= 0) return 0
  return fractional ? value : Math.trunc(value)
}

function sameModels(left: string[], right: string[]) {
  if (left.length !== right.length) return false
  const sorted = [...right].sort()
  return [...left].sort().every((model, index) => model === sorted[index])
}

export function keyFormValuesFromKey(key: APIKeyResponse): KeyFormValues {
  return {
    name: key.name,
    user_id: key.user_id ?? "",
    enabled: key.enabled,
    rate_limit: limitText(key.rate_limit),
    quota_limit: limitText(key.quota_limit),
    credit_limit: limitText(key.credit_limit),
    allowed_models: key.allowed_models ?? [],
  }
}

export function createInputFromForm(values: KeyFormValues): CreateAPIKeyInput {
  return {
    name: values.name.trim(),
    user_id: values.user_id === "" ? null : values.user_id,
    enabled: values.enabled,
    rate_limit: limitValue(values.rate_limit),
    quota_limit: limitValue(values.quota_limit),
    credit_limit: limitValue(values.credit_limit, true),
    allowed_models:
      values.allowed_models.length > 0 ? values.allowed_models : null,
  }
}

export function updateInputFromForm(
  values: KeyFormValues,
  key: APIKeyResponse
): UpdateAPIKeyInput {
  const patch: UpdateAPIKeyInput = {}
  const name = values.name.trim()
  if (name !== key.name) patch.name = name

  // `null` is an explicit unassign; an absent field leaves the owner untouched.
  if (values.user_id !== (key.user_id ?? "")) {
    patch.user_id = values.user_id === "" ? null : values.user_id
  }

  const rateLimit = limitValue(values.rate_limit)
  if (rateLimit !== key.rate_limit) patch.rate_limit = rateLimit

  const quotaLimit = limitValue(values.quota_limit)
  if (quotaLimit !== key.quota_limit) patch.quota_limit = quotaLimit

  const creditLimit = limitValue(values.credit_limit, true)
  if (creditLimit !== (key.credit_limit ?? 0)) patch.credit_limit = creditLimit

  if (!sameModels(values.allowed_models, key.allowed_models ?? [])) {
    patch.allowed_models =
      values.allowed_models.length > 0 ? values.allowed_models : null
  }

  return patch
}

export function KeyFormFields({
  values,
  onChange,
  showEnabled = false,
}: KeyFormFieldsProps) {
  const { data } = useQuery(usersQuery)
  const users = data?.data ?? []

  return (
    <div className="flex flex-col gap-4">
      <FloatingField
        id="key-name"
        label="Key name"
        requiredMark
        required
        autoComplete="off"
        value={values.name}
        onChange={(event) => onChange({ name: event.currentTarget.value })}
        placeholder="Production gateway"
      />

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="key-owner"
          className="text-xs font-medium text-foreground"
        >
          Owner
        </label>
        <select
          id="key-owner"
          value={values.user_id}
          onChange={(event) => onChange({ user_id: event.currentTarget.value })}
          aria-describedby="key-owner-hint"
          className="h-[var(--control-height-md)] w-full rounded-[var(--radius-control)] border border-border bg-surface-muted/50 px-2.5 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <option value="">Unassigned</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
        <span id="key-owner-hint" className="text-xs text-muted-foreground">
          An owned key appears in that customer's console.
        </span>
      </div>

      {showEnabled && (
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border bg-surface-muted/50 px-3 py-2">
          <div className="min-w-0">
            <span className="block text-xs font-medium text-foreground">
              Enabled
            </span>
            <span className="text-xs text-muted-foreground">
              A disabled key is refused before the request reaches a provider.
            </span>
          </div>
          <Switch
            checked={values.enabled}
            onCheckedChange={(enabled) => onChange({ enabled })}
            aria-label="Enable this key"
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FloatingField
          id="key-rate-limit"
          label="Rate limit (req/min)"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={values.rate_limit}
          onChange={(event) =>
            onChange({ rate_limit: event.currentTarget.value })
          }
          placeholder="Unlimited"
        />
        <FloatingField
          id="key-quota-limit"
          label="Token quota"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={values.quota_limit}
          onChange={(event) =>
            onChange({ quota_limit: event.currentTarget.value })
          }
          placeholder="No budget"
        />
      </div>

      <FloatingField
        id="key-credit-limit"
        label="Credit cap (USD)"
        type="number"
        min={0}
        step="any"
        inputMode="decimal"
        value={values.credit_limit}
        onChange={(event) =>
          onChange({ credit_limit: event.currentTarget.value })
        }
        placeholder="No cap"
        description="Spend the key may accumulate before the gateway refuses it. Empty means no cap."
      />

      <ModelAllowlistField
        value={values.allowed_models}
        onValueChange={(allowed_models: string[]) =>
          onChange({ allowed_models })
        }
      />
    </div>
  )
}
