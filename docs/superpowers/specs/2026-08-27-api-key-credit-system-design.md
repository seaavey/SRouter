# Design Specification: Virtual API Key Credit & Balance System

- **Author**: Antigravity & Seaavey
- **Date**: 2026-08-27
- **Status**: Approved

---

## 1. Overview & Goals

Allow SRouter administrators to monetize and allocate prepaid spending balances (Credits in USD) to virtual API keys (`sr-live-*`). 

### Key Capabilities
1. **Prepaid Credit Limit & Tracking**: Virtual keys can be configured with an optional credit limit in USD (e.g. `$5.00`, `$10.00`) or left as Unlimited.
2. **Live Usage Deduction**: Each request completed through `/v1/chat/completions` (OpenAI format) or `/v1/messages` (Anthropic format) computes exact inference cost via `@srouter/pricing` (`calculateCostFromTokens`) and accumulates `usage_cost` (and `usage_tokens`).
3. **Pre-flight Quota & Balance Guards**: Rejects requests with HTTP 402 (`insufficient_quota` / `insufficient_credit`) when credit balance is exhausted, and HTTP 429 (`quota_exceeded`) when token quota is exceeded.
4. **Add Saldo Action**: Admin can top up / add balance directly to any key via a dedicated popup modal (`AddSaldoDialog`) and backend endpoint (`POST /v1/keys/:id/add-saldo`).
5. **Dashboard Visibility**: Displays current remaining balance, lifetime cost consumed, progress bar, and credit limits inside `KeyTable`, `CreateKeyDialog`, and `KeySecretModal`.

---

## 2. Architecture & Data Model

### 2.1 Database Schema (`packages/db`)

Table `api_keys` schema additions:
```sql
ALTER TABLE api_keys ADD COLUMN credit_limit REAL DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN usage_cost REAL DEFAULT 0;
```
- `credit_limit` (`REAL`): Total dollar credit allotted to this key (`0` = Unlimited).
- `usage_cost` (`REAL`): Cumulative dollar cost consumed by completed requests.
- **Remaining Balance calculation**: `credit_limit > 0 ? Math.max(0, credit_limit - usage_cost) : Infinity`.

### 2.2 Shared Types (`packages/types`)

`DBAPIKey`:
```ts
export interface DBAPIKey {
    id: string;
    key: string;
    name: string;
    enabled: boolean;
    rateLimit: number;
    quotaLimit: number;
    usageTokens: number;
    creditLimit: number; // USD ($), 0 = unlimited
    usageCost: number;   // USD ($) cumulative
    allowed_models?: string[] | null;
    createdAt: number;
}
```

Zod Schemas:
```ts
export const CreateAPIKeySchema = z.object({
    name: z.string().min(1, "Field 'name' cannot be empty"),
    rateLimit: z.number().int().nonnegative().optional(),
    quotaLimit: z.number().int().nonnegative().optional(),
    creditLimit: z.number().nonnegative().optional(),
    allowed_models: z.array(z.string().min(1)).nullable().optional()
});

export const AddSaldoSchema = z.object({
    amount: z.number().positive("Amount must be greater than 0")
});
```

### 2.3 Database Functions (`packages/db/src/apiKeys.ts`)
1. `getAllAPIKeysDB()` & `getAPIKeyByKeyDB(key: string)`: Map `credit_limit` -> `creditLimit` (number) and `usage_cost` -> `usageCost` (number).
2. `createAPIKeyDB(data: { name: string; rateLimit?: number; quotaLimit?: number; creditLimit?: number; allowed_models?: string[] | null; })`: Inserts `credit_limit`.
3. `incrementAPIKeyUsageDB(keyId: string, tokens: number, cost: number)`:
   ```sql
   UPDATE api_keys
   SET usage_tokens = usage_tokens + ?, usage_cost = usage_cost + ?
   WHERE id = ?
   ```
4. `addSaldoAPIKeyDB(id: string, amount: number)`:
   ```sql
   UPDATE api_keys
   SET credit_limit = credit_limit + ?
   WHERE id = ?
   ```

---

## 3. API & Gateway Logic

### 3.1 Pre-flight Enforcement Guard (`apps/api/src/middleware/ModelAccess.ts` or `ApiKeyAuth.ts`)
When a request authenticates via virtual API key (`authType === "api_key"` and `apiKeyRow` is present):
1. **Token Quota Check**:
   - If `apiKeyRow.quotaLimit > 0` and `apiKeyRow.usageTokens >= apiKeyRow.quotaLimit`:
     - Return HTTP 429 (`quota_exceeded`): `"Token quota exceeded. Maximum lifetime tokens reached."`
2. **Credit Balance Check**:
   - If `apiKeyRow.creditLimit > 0` and `apiKeyRow.usageCost >= apiKeyRow.creditLimit`:
     - Return HTTP 402 (`insufficient_credit`): `"Insufficient credit balance. Credit limit reached."`
     - OpenAI format: `{ error: { message: "...", type: "insufficient_quota", code: "insufficient_credit" } }`
     - Anthropic format: `{ type: "error", error: { type: "permission_error", message: "..." } }`

### 3.2 Cost Calculation & Increment (`apps/api/src/logic/chat.logic.ts` & controllers)
- Pass the authenticated `apiKeyRow` (or `apiKeyId`) from controller context `c` to `ChatLogic`.
- Upon successful response generation (`statusCode === 200`):
  - Extract token usage: `extractUsageBreakdown(providerId, usage)`.
  - Calculate dollar cost: `estimateCostForUsage(effectiveProvider, effectiveModel, breakdown)`.
  - Call `incrementAPIKeyUsageDB(apiKeyRow.id, breakdown.total_tokens, calculatedCost)`.

### 3.3 Management Endpoints (`apps/api/src/routes/v1/keys.ts`)
- `POST /v1/keys`: Accepts `creditLimit`.
- `POST /v1/keys/:id/add-saldo`:
  - Protected by `adminAuth`.
  - Validates request body with `ValidateJson(AddSaldoSchema)`.
  - Calls `addSaldoAPIKeyDB(id, body.amount)`.
  - Returns updated `DBAPIKey`.

---

## 4. Web Dashboard UI (`apps/web`)

### 4.1 `CreateKeyDialog.tsx`
- Adds input field **Credit balance ($ USD)**:
  - Input field for numbers (min: 0, step: 0.01).
  - Placeholder: `Unlimited`.
  - Helper note: `Optional pre-allocated spending budget in USD`.

### 4.2 `KeyTable.tsx`
- New column **Credit / Saldo**:
  - If `creditLimit > 0`: Displays remaining balance `$X.XX left` out of total `$Y.YY limit`, with a 3-tier colored progress bar (green `< 70%`, amber `70-90%`, red `> 90%`).
  - If `creditLimit === 0`: Displays `Unlimited` with `$X.XX used` subtext.
- Action column:
  - New **"Add Saldo"** action button per row (icon: `CircleDollarSign` or `Plus`).
  - Opens `AddSaldoDialog`.

### 4.3 `AddSaldoDialog.tsx` (New Component)
- Modal dialog:
  - Key name and current balance status.
  - Input field `Amount to add ($ USD)`.
  - Quick amount chip buttons: `+$5`, `+$10`, `+$25`, `+$50`.
  - Buttons: `Cancel`, `Add Saldo`.
  - Calls `useAddSaldo` hook / API client `POST /v1/keys/:id/add-saldo`.

### 4.4 `KeySecretModal.tsx`
- Displays initial credit limit in the summary details alongside Token Quota and Allowed Models.

---

## 5. Testing & Verification Plan

1. **Unit & Database Tests**:
   - `packages/db/tests`: Verify `creditLimit`, `usageCost`, `createAPIKeyDB`, `incrementAPIKeyUsageDB`, and `addSaldoAPIKeyDB`.
   - `apps/api/tests/api-keys-credit.test.ts`:
     - Test key creation with `creditLimit`.
     - Test pre-flight rejection with HTTP 402 when `usageCost >= creditLimit`.
     - Test `POST /v1/keys/:id/add-saldo` successfully increments `credit_limit`.
     - Test subsequent request passes after adding saldo.
2. **Build Verification**:
   - `pnpm run build` on `packages/types`, `packages/db`, `apps/api`, `apps/web`.
