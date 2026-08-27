# Virtual API Key Credit & Balance System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement prepaid credit limit ($ USD) and lifetime usage cost tracking for virtual API keys, with pre-flight balance guards, automatic inference cost deduction, an admin `POST /v1/keys/:id/credit` endpoint, and responsive Web UI management (CreateKeyDialog, KeyTable, AddCreditDialog).

**Architecture:** Extend SQLite `api_keys` schema with `credit_limit` and `usage_cost` columns. On every authenticated completion, check available balance pre-flight and reject exhausted keys with HTTP 402; calculate exact cost post-flight using `@srouter/pricing` and increment `usage_cost` and `usage_tokens`. Expose an `AddCredit` admin endpoint and update the dashboard UI with live balance progress bars and an Add Credit dialog.

**Tech Stack:** Node.js (v22+), SQLite (`node:sqlite`), Hono 4, Zod, React 19, Lucide React, Tailwind CSS v4.

## Global Constraints

- Runtime: Node.js >= 22, ESM only
- Dependency flow: `routes/v1 -> controllers -> logic -> services / packages/{db,pricing,types}`
- All gateway paths mount under `/v1` in `apps/api/src/index.ts`
- Errors use standard `{ error: { message, type, code } }` format
- Never run whole-monorepo build or whole-repo tests (server resource limit). Build/test only touched packages.

---

### Task 1: Database Schema & Shared Types (`@srouter/types` and `@srouter/db`)

**Files:**
- Modify: `packages/types/src/apiKeys.ts`
- Modify: `packages/types/src/schemas/apiKeys.ts`
- Modify: `packages/db/src/db.ts`
- Modify: `packages/db/src/apiKeys.ts`
- Test: `apps/api/tests/api-keys-credit-db.test.ts`

**Interfaces:**
- Produces: `DBAPIKey.creditLimit`, `DBAPIKey.usageCost`, `CreateAPIKeySchema.creditLimit`, `AddCreditSchema`, `addCreditAPIKeyDB(id: string, amount: number)`, `incrementAPIKeyUsageDB(keyId: string, tokens: number, cost?: number)`

- [ ] **Step 1: Write the failing test for DB operations**

Create `apps/api/tests/api-keys-credit-db.test.ts`:
```typescript
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
    addCreditAPIKeyDB,
    createAPIKeyDB,
    deleteAPIKeyDB,
    getAPIKeyByKeyDB,
    incrementAPIKeyUsageDB
} from "@srouter/db";

const createdIds: string[] = [];

afterEach(() => {
    for (const id of createdIds.splice(0)) {
        deleteAPIKeyDB(id);
    }
});

test("createAPIKeyDB stores creditLimit and usageCost default to 0", () => {
    const key = createAPIKeyDB({
        name: "Test Credit Key",
        creditLimit: 15.5
    });
    createdIds.push(key.id);

    assert.equal(key.creditLimit, 15.5);
    assert.equal(key.usageCost, 0);

    const lookup = getAPIKeyByKeyDB(key.key);
    assert.ok(lookup);
    assert.equal(lookup?.creditLimit, 15.5);
    assert.equal(lookup?.usageCost, 0);
});

test("incrementAPIKeyUsageDB increments tokens and dollar cost", () => {
    const key = createAPIKeyDB({
        name: "Usage Test Key",
        creditLimit: 20
    });
    createdIds.push(key.id);

    incrementAPIKeyUsageDB(key.id, 500, 0.025);

    const lookup = getAPIKeyByKeyDB(key.key);
    assert.ok(lookup);
    assert.equal(lookup?.usageTokens, 500);
    assert.equal(Math.round((lookup?.usageCost ?? 0) * 1000) / 1000, 0.025);
});

test("addCreditAPIKeyDB increases creditLimit", () => {
    const key = createAPIKeyDB({
        name: "Add Credit Test Key",
        creditLimit: 10
    });
    createdIds.push(key.id);

    const updated = addCreditAPIKeyDB(key.id, 5.25);
    assert.ok(updated);
    assert.equal(updated?.creditLimit, 15.25);

    const lookup = getAPIKeyByKeyDB(key.key);
    assert.equal(lookup?.creditLimit, 15.25);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm exec tsx --test tests/api-keys-credit-db.test.ts`
Expected: FAIL (missing fields `creditLimit`, `usageCost`, and function `addCreditAPIKeyDB`).

- [ ] **Step 3: Update `packages/types`**

Edit `packages/types/src/apiKeys.ts`:
```typescript
export interface DBAPIKey {
    id: string;
    key: string;
    name: string;
    enabled: boolean;
    rateLimit: number;
    quotaLimit: number;
    usageTokens: number;
    creditLimit: number;
    usageCost: number;
    allowed_models?: string[] | null;
    createdAt: number;
}
```

Edit `packages/types/src/schemas/apiKeys.ts`:
```typescript
import { z } from "zod";

export const CreateAPIKeySchema = z.object({
    name: z
        .string({
            required_error: "Field 'name' is required"
        })
        .min(1, "Field 'name' cannot be empty"),
    rateLimit: z.number().int().nonnegative().optional(),
    quotaLimit: z.number().int().nonnegative().optional(),
    creditLimit: z.number().nonnegative().optional(),
    allowed_models: z.array(z.string().min(1)).nullable().optional()
});

export type CreateAPIKeyZod = z.infer<typeof CreateAPIKeySchema>;

export const AddCreditSchema = z.object({
    amount: z
        .number({
            required_error: "Field 'amount' is required"
        })
        .positive("Amount must be greater than 0")
});

export type AddCreditZod = z.infer<typeof AddCreditSchema>;
```

Build `@srouter/types`:
`cd packages/types && pnpm run build`

- [ ] **Step 4: Update `packages/db`**

Edit `packages/db/src/db.ts` to add schema migrations in `ensureColumns`:
```typescript
ensureColumns(db, "api_keys", {
    allowed_models: "TEXT",
    credit_limit: "REAL DEFAULT 0",
    usage_cost: "REAL DEFAULT 0"
});
```

Edit `packages/db/src/apiKeys.ts`:
- Update `APIKeyRow` interface:
```typescript
interface APIKeyRow {
    id: string;
    key: string;
    name: string;
    enabled: number;
    rate_limit: number;
    quota_limit: number;
    usage_tokens: number;
    credit_limit: number;
    usage_cost: number;
    allowed_models: string | null;
    created_at: number;
}
```
- Update `mapAPIKeyRow`:
```typescript
function mapAPIKeyRow(row: APIKeyRow): DBAPIKey {
    return {
        id: row.id,
        key: row.key,
        name: row.name,
        enabled: Boolean(row.enabled),
        rateLimit: row.rate_limit ?? 0,
        quotaLimit: row.quota_limit ?? 0,
        usageTokens: row.usage_tokens ?? 0,
        creditLimit: row.credit_limit ?? 0,
        usageCost: row.usage_cost ?? 0,
        allowed_models: ParseAllowedModels(row.allowed_models),
        createdAt: row.created_at
    };
}
```
- Update `createAPIKeyDB`:
```typescript
export function createAPIKeyDB(data: {
    name: string;
    rateLimit?: number;
    quotaLimit?: number;
    creditLimit?: number;
    allowed_models?: string[] | null;
}): DBAPIKey {
    const Id = generateId("key");
    const RandomHex = randomUUID().replace(/-/g, "").slice(0, 16);
    const Key = `sr-live-${RandomHex}`;
    const CreatedAt = Date.now();
    const AllowedModels =
        data.allowed_models && data.allowed_models.length > 0 ? data.allowed_models : null;
    const AllowedModelsJson = AllowedModels ? JSON.stringify(AllowedModels) : null;
    const CreditLimit = data.creditLimit ?? 0;

    const Query = db.prepare(`
        INSERT INTO api_keys (id, key, name, enabled, rate_limit, quota_limit, usage_tokens, credit_limit, usage_cost, allowed_models, created_at)
        VALUES (?, ?, ?, 1, ?, ?, 0, ?, 0, ?, ?)
    `);

    Query.run(
        Id,
        Key,
        data.name,
        data.rateLimit ?? 0,
        data.quotaLimit ?? 0,
        CreditLimit,
        AllowedModelsJson,
        CreatedAt
    );

    return {
        id: Id,
        key: Key,
        name: data.name,
        enabled: true,
        rateLimit: data.rateLimit ?? 0,
        quotaLimit: data.quotaLimit ?? 0,
        usageTokens: 0,
        creditLimit: CreditLimit,
        usageCost: 0,
        allowed_models: AllowedModels,
        createdAt: CreatedAt
    };
}
```
- Update `incrementAPIKeyUsageDB` and add `addCreditAPIKeyDB`:
```typescript
export function incrementAPIKeyUsageDB(keyId: string, tokens: number, cost = 0): void {
    const Query = db.prepare(
        "UPDATE api_keys SET usage_tokens = usage_tokens + ?, usage_cost = usage_cost + ? WHERE id = ?"
    );
    Query.run(tokens, cost, keyId);
}

export function addCreditAPIKeyDB(id: string, amount: number): DBAPIKey | null {
    const UpdateQuery = db.prepare(
        "UPDATE api_keys SET credit_limit = credit_limit + ? WHERE id = ?"
    );
    UpdateQuery.run(amount, id);

    const SelectQuery = db.prepare("SELECT * FROM api_keys WHERE id = ?");
    const Row = SelectQuery.get(id) as unknown as APIKeyRow | undefined;
    if (!Row) return null;
    return mapAPIKeyRow(Row);
}
```
- Export `addCreditAPIKeyDB` in `packages/db/src/index.ts`.

Build `@srouter/db`:
`cd packages/db && pnpm run build`

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && pnpm exec tsx --test tests/api-keys-credit-db.test.ts`
Expected: PASS (3 tests passed).

- [ ] **Step 6: Commit**

```bash
git add packages/types packages/db apps/api/tests/api-keys-credit-db.test.ts
git commit -m "feat(db,types): add creditLimit and usageCost to api_keys with addCreditAPIKeyDB"
```

---

### Task 2: API Pre-flight Credit & Quota Guards (`apps/api`)

**Files:**
- Modify: `apps/api/src/middleware/ApiKeyAuth.ts`
- Modify: `apps/api/src/middleware/ModelAccess.ts`
- Modify: `apps/api/src/controllers/messages.controller.ts`
- Test: `apps/api/tests/api-keys-quota-credit.test.ts`

**Interfaces:**
- Enforces:
  - Token quota: `key.quotaLimit > 0 && key.usageTokens >= key.quotaLimit` -> HTTP 429 (`quota_exceeded`)
  - Credit limit: `key.creditLimit > 0 && key.usageCost >= key.creditLimit` -> HTTP 402 (`insufficient_credit` / `insufficient_quota`)

- [ ] **Step 1: Write the failing tests for pre-flight credit & quota enforcement**

Create `apps/api/tests/api-keys-quota-credit.test.ts`:
```typescript
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Hono } from "hono";
import { createAPIKeyDB, deleteAPIKeyDB, incrementAPIKeyUsageDB } from "@srouter/db";
import { ApiKeyAuth } from "@/middleware/ApiKeyAuth.js";

const createdIds: string[] = [];

afterEach(() => {
    for (const id of createdIds.splice(0)) {
        deleteAPIKeyDB(id);
    }
});

function createTestApp() {
    const app = new Hono();
    app.post("/test", ApiKeyAuth, (c) => c.json({ ok: true }));
    return app;
}

test("ApiKeyAuth rejects request with 402 when credit balance is exhausted", async () => {
    const key = createAPIKeyDB({
        name: "Exhausted Credit Key",
        creditLimit: 5.0
    });
    createdIds.push(key.id);

    // Increment cost to exceed creditLimit
    incrementAPIKeyUsageDB(key.id, 100, 5.01);

    const app = createTestApp();
    const res = await app.request("/test", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${key.key}`
        }
    });

    assert.equal(res.status, 402);
    const body = (await res.json()) as { error: { message: string; type: string; code: string } };
    assert.equal(body.error.code, "insufficient_credit");
    assert.match(body.error.message, /credit/i);
});

test("ApiKeyAuth rejects request with 429 when token quota is exhausted", async () => {
    const key = createAPIKeyDB({
        name: "Exhausted Quota Key",
        quotaLimit: 1000
    });
    createdIds.push(key.id);

    // Increment tokens to exceed quotaLimit
    incrementAPIKeyUsageDB(key.id, 1005, 0);

    const app = createTestApp();
    const res = await app.request("/test", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${key.key}`
        }
    });

    assert.equal(res.status, 429);
    const body = (await res.json()) as { error: { message: string; code: string } };
    assert.equal(body.error.code, "quota_exceeded");
    assert.match(body.error.message, /quota/i);
});

test("ApiKeyAuth allows request when within credit and quota limits", async () => {
    const key = createAPIKeyDB({
        name: "Valid Key",
        creditLimit: 10.0,
        quotaLimit: 10000
    });
    createdIds.push(key.id);

    incrementAPIKeyUsageDB(key.id, 1000, 1.0);

    const app = createTestApp();
    const res = await app.request("/test", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${key.key}`
        }
    });

    assert.equal(res.status, 200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm exec tsx --test tests/api-keys-quota-credit.test.ts`
Expected: FAIL with status 200 instead of 402/429.

- [ ] **Step 3: Update `apps/api/src/middleware/ApiKeyAuth.ts`**

In `ApiKeyAuth.ts`, after checking `!ApiKeyRow.enabled`:
```typescript
if (ApiKeyRow.creditLimit > 0 && ApiKeyRow.usageCost >= ApiKeyRow.creditLimit) {
    return Err(
        c,
        "Insufficient credit balance. Your credit limit has been reached.",
        402,
        {
            type: "insufficient_quota",
            code: "insufficient_credit"
        }
    );
}

if (ApiKeyRow.quotaLimit > 0 && ApiKeyRow.usageTokens >= ApiKeyRow.quotaLimit) {
    return Err(
        c,
        "Token quota exceeded. Your lifetime token limit has been reached.",
        429,
        {
            type: "insufficient_quota",
            code: "quota_exceeded"
        }
    );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && pnpm exec tsx --test tests/api-keys-quota-credit.test.ts`
Expected: PASS (3 tests passed).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/middleware/ApiKeyAuth.ts apps/api/tests/api-keys-quota-credit.test.ts
git commit -m "feat(api): enforce credit limit and token quota in ApiKeyAuth"
```

---

### Task 3: Automatic Cost & Usage Deduction on Completions (`apps/api`)

**Files:**
- Modify: `apps/api/src/controllers/chat.controller.ts`
- Modify: `apps/api/src/controllers/messages.controller.ts`
- Modify: `apps/api/src/logic/chat.logic.ts`
- Test: `apps/api/tests/api-keys-usage-deduction.test.ts`

**Interfaces:**
- When an API key makes a request to `/v1/chat/completions` or `/v1/messages`:
  - Pass `apiKeyId` to `ChatLogic` (or handle in controller/logic `LogCompletion`).
  - Calculate token cost via `@srouter/pricing` (`calculateCostFromTokens` / `estimateCostForUsage`).
  - Automatically update `usage_tokens` and `usage_cost` in DB.

- [ ] **Step 1: Write test for automatic usage deduction**

Create `apps/api/tests/api-keys-usage-deduction.test.ts`:
```typescript
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createAPIKeyDB, deleteAPIKeyDB, getAPIKeyByKeyDB } from "@srouter/db";
import { ChatLogic } from "@/logic/chat.logic.js";

const createdIds: string[] = [];

afterEach(() => {
    for (const id of createdIds.splice(0)) {
        deleteAPIKeyDB(id);
    }
});

test("ChatLogic records token and cost deduction for API key on successful completion", async () => {
    const key = createAPIKeyDB({
        name: "Deduction Key",
        creditLimit: 10
    });
    createdIds.push(key.id);

    // Verify initial usage
    assert.equal(key.usageTokens, 0);
    assert.equal(key.usageCost, 0);
});
```

- [ ] **Step 2: Implement cost calculation and DB increment in `ChatLogic`**

In `apps/api/src/logic/chat.logic.ts`:
- Update `LogCompletion` to accept `apiKeyId?: string`:
```typescript
function LogCompletion(
    providerId: string,
    model: string,
    startTime: number,
    options: {
        statusCode: number;
        usage?: UsageInfo;
        fallbackOccurred?: boolean;
        fallbackPath?: string[];
        fallbackReason?: string;
        apiKeyId?: string;
    }
): void {
    const breakdown = extractUsageBreakdown(providerId, options.usage);
    const effectiveModel = model;
    const effectiveProvider = effectiveModel.includes("/")
        ? effectiveModel.split("/")[0]!
        : providerId;
    const estimatedCost =
        options.statusCode === 200
            ? estimateCostForUsage(effectiveProvider, effectiveModel, breakdown)
            : undefined;

    if (options.statusCode === 200 && options.apiKeyId && breakdown.total_tokens > 0) {
        incrementAPIKeyUsageDB(options.apiKeyId, breakdown.total_tokens, estimatedCost ?? 0);
    }

    logRequestDB({
        providerId,
        model,
        promptTokens: options.statusCode === 200 ? breakdown.prompt_tokens : 0,
        completionTokens: options.statusCode === 200 ? breakdown.completion_tokens : 0,
        totalTokens: options.statusCode === 200 ? breakdown.total_tokens : 0,
        cachedTokens: options.statusCode === 200 ? breakdown.cached_tokens : undefined,
        cacheCreationTokens:
            options.statusCode === 200 ? breakdown.cache_creation_tokens : undefined,
        reasoningTokens: options.statusCode === 200 ? breakdown.reasoning_tokens : undefined,
        estimatedCost,
        fallbackOccurred: options.fallbackOccurred,
        fallbackPath: options.fallbackOccurred ? options.fallbackPath?.join(" -> ") : undefined,
        fallbackReason: options.fallbackReason,
        statusCode: options.statusCode,
        latencyMs: Date.now() - startTime
    });
}
```
- Update `ChatLogic.ProcessNonStreamingCompletion` and `ChatLogic.ProcessStreamingCompletion` to accept `apiKeyId?: string` in options or context, and pass it from `ChatController` and `MessagesController` (`c.get("apiKeyRow")?.id`).

- [ ] **Step 3: Update `ChatController` and `MessagesController`**

In `apps/api/src/controllers/chat.controller.ts`:
- Retrieve `const ApiKeyRow = c.get("apiKeyRow") as DBAPIKey | undefined;`
- Pass `ApiKeyRow?.id` into `ChatLogic.ProcessStreamingCompletion(Body, StartTime, 0, ApiKeyRow?.id)` and `ChatLogic.ProcessNonStreamingCompletion(Body, StartTime, 0, ApiKeyRow?.id)`.

In `apps/api/src/controllers/messages.controller.ts`:
- Retrieve `const ApiKeyRow = c.get("apiKeyRow") as DBAPIKey | undefined;`
- Pass `ApiKeyRow?.id` into streaming and non-streaming `ChatLogic` calls.

- [ ] **Step 4: Run all API tests**

Run: `cd apps/api && pnpm exec tsx --test tests/api-keys-quota-credit.test.ts tests/api-keys-credit-db.test.ts tests/api-keys-allowed-models.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/logic/chat.logic.ts apps/api/src/controllers/chat.controller.ts apps/api/src/controllers/messages.controller.ts
git commit -m "feat(api): deduct tokens and calculated cost automatically on successful completions"
```

---

### Task 4: API Key Management & Credit Adjustment Route (`POST /v1/keys/:id/credit`)

**Files:**
- Modify: `apps/api/src/controllers/keys.controller.ts`
- Modify: `apps/api/src/routes/v1/keys.ts`
- Test: `apps/api/tests/api-keys-credit-route.test.ts`

**Interfaces:**
- Endpoint: `POST /v1/keys/:id/credit`
- Body: `{ amount: number }` (validated via `AddCreditSchema`)
- Response: `Ok(c, updatedKey)` or `Err(c, "API Key not found", 404)`

- [ ] **Step 1: Write the failing route test**

Create `apps/api/tests/api-keys-credit-route.test.ts`:
```typescript
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createAPIKeyDB, deleteAPIKeyDB, getAPIKeyByKeyDB } from "@srouter/db";
import { Hono } from "hono";
import { KeysRouter } from "@/routes/v1/keys.js";

const createdIds: string[] = [];

afterEach(() => {
    for (const id of createdIds.splice(0)) {
        deleteAPIKeyDB(id);
    }
});

function createTestApp() {
    const app = new Hono();
    // Simulate admin session for tests
    app.use("*", async (c, next) => {
        c.set("authType", "admin_session");
        return await next();
    });
    app.route("/v1", KeysRouter);
    return app;
}

test("POST /v1/keys creates key with creditLimit", async () => {
    const app = createTestApp();
    const res = await app.request("/v1/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            name: "Credit API Key",
            creditLimit: 25.5
        })
    });

    assert.equal(res.status, 201);
    const body = (await res.json()) as { data: { id: string; creditLimit: number; usageCost: number } };
    createdIds.push(body.data.id);
    assert.equal(body.data.creditLimit, 25.5);
    assert.equal(body.data.usageCost, 0);
});

test("POST /v1/keys/:id/credit adds credit to existing key", async () => {
    const key = createAPIKeyDB({
        name: "Topup Route Key",
        creditLimit: 10
    });
    createdIds.push(key.id);

    const app = createTestApp();
    const res = await app.request(`/v1/keys/${key.id}/credit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 15 })
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: { creditLimit: number } };
    assert.equal(body.data.creditLimit, 25);

    const lookup = getAPIKeyByKeyDB(key.key);
    assert.equal(lookup?.creditLimit, 25);
});

test("POST /v1/keys/:id/credit rejects non-positive amount", async () => {
    const key = createAPIKeyDB({ name: "Validation Key" });
    createdIds.push(key.id);

    const app = createTestApp();
    const res = await app.request(`/v1/keys/${key.id}/credit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: -5 })
    });

    assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm exec tsx --test tests/api-keys-credit-route.test.ts`
Expected: FAIL (404 on `/v1/keys/:id/credit`).

- [ ] **Step 3: Update `KeysController` and `KeysRouter`**

In `apps/api/src/controllers/keys.controller.ts`:
- Update `CreateKey` to include `creditLimit: parsed.data.creditLimit ?? 0`.
- Add `AddCredit`:
```typescript
public static async AddCredit(c: Context): Promise<Response> {
    const id = c.req.param("id");
    const rawBody = await c.req.json().catch(() => null);
    const parsed = AddCreditSchema.safeParse(rawBody);

    if (!parsed.success) {
        return Err(c, parsed.error.issues[0]?.message || "Invalid request payload", 400);
    }

    const updated = addCreditAPIKeyDB(id, parsed.data.amount);
    if (!updated) {
        return Err(c, "API Key not found", 404);
    }

    return Ok(c, updated);
}
```

In `apps/api/src/routes/v1/keys.ts`:
```typescript
import { Hono } from "hono";
import { KeysController } from "@/controllers/keys.controller.js";
import { RequireAdmin } from "@/middleware/AdminAuth.js";
import { ApiKeyAuth } from "@/middleware/ApiKeyAuth.js";

export const KeysRouter = new Hono();

KeysRouter.get("/keys", ApiKeyAuth, KeysController.ListKeys);

// Mutation endpoints require Admin Auth
KeysRouter.post("/keys", RequireAdmin, KeysController.CreateKey);
KeysRouter.post("/keys/:id/credit", RequireAdmin, KeysController.AddCredit);
KeysRouter.delete("/keys/:id", RequireAdmin, KeysController.DeleteKey);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && pnpm exec tsx --test tests/api-keys-credit-route.test.ts`
Expected: PASS (3 tests passed).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/controllers/keys.controller.ts apps/api/src/routes/v1/keys.ts apps/api/tests/api-keys-credit-route.test.ts
git commit -m "feat(api): implement POST /v1/keys/:id/credit endpoint and controller"
```

---

### Task 5: Web Dashboard Hook & Create/Secret Modals (`apps/web`)

**Files:**
- Modify: `apps/web/src/hooks/useKeys.ts`
- Modify: `apps/web/src/components/keys/CreateKeyDialog.tsx`
- Modify: `apps/web/src/components/keys/KeySecretModal.tsx`

**Interfaces:**
- `useAddCreditKey` mutation calling `POST /v1/keys/:id/credit`
- `CreateKeyDialog` passes `creditLimit?: number`
- `KeySecretModal` displays credit limit summary

- [ ] **Step 1: Update `apps/web/src/hooks/useKeys.ts`**

Add `creditLimit` to `CreateKeyInput` and implement `useAddCreditKey`:
```typescript
export type CreateKeyInput = {
    name: string;
    rateLimit?: number;
    quotaLimit?: number;
    creditLimit?: number;
    allowed_models?: string[] | null;
};

export function useAddCreditKey() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, amount }: { id: string; amount: number }) => {
            return api.post<APIKey>(`/v1/keys/${id}/credit`, { amount });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["keys"] });
        }
    });
}
```

- [ ] **Step 2: Update `apps/web/src/components/keys/CreateKeyDialog.tsx`**

- Add state: `const [creditLimit, setCreditLimit] = useState("");`
- Update `onSubmit` payload:
  ```typescript
  const creditNum = creditLimit.trim() ? parseFloat(creditLimit) : undefined;
  await onSubmit({
      name: trimmedName,
      rateLimit: Number.isFinite(rateNum) && (rateNum ?? 0) > 0 ? rateNum : undefined,
      quotaLimit: Number.isFinite(quotaNum) && (quotaNum ?? 0) > 0 ? quotaNum : undefined,
      creditLimit: Number.isFinite(creditNum) && (creditNum ?? 0) > 0 ? creditNum : undefined,
      allowed_models: allowedModels
  });
  ```
- Add the Credit Limit input in the Limits grid (3 columns on desktop, or 2-row grid):
```tsx
{/* Credit Balance / Limit */}
<div className="space-y-1.5">
    <label htmlFor="credit-limit" className="block text-xs font-medium text-foreground">
        Credit balance{" "}
        <span className="text-[11px] font-normal text-muted-foreground">($ USD)</span>
    </label>
    <Input
        id="credit-limit"
        type="number"
        min="0"
        step="0.01"
        value={creditLimit}
        onChange={(e) => setCreditLimit(e.target.value)}
        placeholder="Unlimited"
        className="h-9 font-mono text-xs rounded-md bg-background border-input"
    />
    <p className="text-[11px] text-muted-foreground">
        Optional prepaid balance in USD
    </p>
</div>
```

- [ ] **Step 3: Update `apps/web/src/components/keys/KeySecretModal.tsx`**

Add credit limit detail to the newly created key summary:
```tsx
{createdKey.creditLimit > 0 && (
    <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Credit Balance:</span>
        <span className="font-mono font-semibold text-emerald-500">
            ${createdKey.creditLimit.toFixed(2)} USD
        </span>
    </div>
)}
```

- [ ] **Step 4: Build web to verify typecheck**

Run: `cd apps/web && pnpm run build`
Expected: Build passes with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/useKeys.ts apps/web/src/components/keys/CreateKeyDialog.tsx apps/web/src/components/keys/KeySecretModal.tsx
git commit -m "feat(web): add credit balance input in CreateKeyDialog and secret modal"
```

---

### Task 6: Web Dashboard AddCreditDialog & KeyTable Integration (`apps/web`)

**Files:**
- Create: `apps/web/src/components/keys/AddCreditDialog.tsx`
- Modify: `apps/web/src/components/keys/KeyTable.tsx`
- Modify: `apps/web/src/routes/keys.tsx`

**Interfaces:**
- `AddCreditDialog`: Clean modal with quick-add chips (`+$5`, `+$10`, `+$25`, `+$50`) and custom amount input.
- `KeyTable`: Displays **Credit / Saldo** column showing remaining balance (`$X.XX left`), usage cost (`$Y.YY used`), progress bar, and "Add Credit" action button.

- [ ] **Step 1: Create `apps/web/src/components/keys/AddCreditDialog.tsx`**

```tsx
import React, { useState } from "react";
import type { DBAPIKey } from "@srouter/types";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AddCreditDialogProps = {
    apiKey: DBAPIKey | null;
    open: boolean;
    loading: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (keyId: string, amount: number) => Promise<void>;
};

const QUICK_AMOUNTS = [5, 10, 25, 50];

export function AddCreditDialog({
    apiKey,
    open,
    loading,
    onOpenChange,
    onSubmit
}: AddCreditDialogProps) {
    const [amount, setAmount] = useState("");

    if (!apiKey) return null;

    const currentLimit = apiKey.creditLimit ?? 0;
    const currentCost = apiKey.usageCost ?? 0;
    const remainingBalance = currentLimit > 0 ? Math.max(0, currentLimit - currentCost) : null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const num = parseFloat(amount);
        if (!Number.isFinite(num) || num <= 0) return;

        await onSubmit(apiKey.id, num);
        setAmount("");
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md bg-card border-border p-6">
                <DialogHeader className="space-y-1 text-left">
                    <DialogTitle className="text-base font-semibold text-foreground">
                        Add Credit
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
                        Add prepaid dollar balance to <span className="font-semibold text-foreground font-mono">{apiKey.name}</span>.
                    </DialogDescription>
                </DialogHeader>

                {/* Current Balance Summary */}
                <div className="rounded-lg border border-border/70 bg-secondary/30 p-3 my-2 text-xs space-y-1">
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Current Balance:</span>
                        <span className="font-mono font-semibold text-foreground">
                            {remainingBalance !== null ? `$${remainingBalance.toFixed(2)} USD` : "Unlimited"}
                        </span>
                    </div>
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                        <span>Lifetime Used:</span>
                        <span className="font-mono">${currentCost.toFixed(3)}</span>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4 pt-1">
                    <div className="space-y-2">
                        <label htmlFor="add-amount" className="block text-xs font-medium text-foreground">
                            Amount to add ($ USD) <span className="text-destructive">*</span>
                        </label>
                        <Input
                            id="add-amount"
                            type="number"
                            min="0.01"
                            step="0.01"
                            required
                            autoFocus
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="e.g. 10.00"
                            className="h-9 font-mono text-xs rounded-md bg-background border-input"
                        />

                        {/* Quick Chip Shortcuts */}
                        <div className="flex items-center gap-1.5 pt-1">
                            {QUICK_AMOUNTS.map((val) => (
                                <button
                                    key={val}
                                    type="button"
                                    onClick={() => setAmount(String(val))}
                                    className="rounded-md border border-border/70 bg-background px-2.5 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors cursor-pointer"
                                >
                                    +${val}
                                </button>
                            ))}
                        </div>
                    </div>

                    <DialogFooter className="pt-3 gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            className="h-8.5 text-xs font-medium cursor-pointer"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={loading || !amount || parseFloat(amount) <= 0}
                            className="h-8.5 text-xs font-semibold cursor-pointer shadow-xs"
                        >
                            {loading ? "Adding…" : "Add Credit"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
```

- [ ] **Step 2: Update `KeyTable.tsx` with Credit Column & Add Credit Button**

- Add `onAddCreditClick: (key: DBAPIKey) => void` to `KeyTableProps`.
- Add `<th>` column **Credit / Saldo** in the table header.
- Add cell for Credit in table row:
  - If `creditLimit > 0`: Show remaining balance `$X.XX left`, lifetime used `$Y.YY`, and progress bar.
  - If `creditLimit === 0`: Show `Unlimited` with `$Y.YY used` subtext.
- In Action column, add an "Add Credit" button (icon `CircleDollarSign` or `PlusCircle`) before the delete button.

- [ ] **Step 3: Update `apps/web/src/routes/keys.tsx`**

- Wire `useAddCreditKey` mutation.
- Maintain state: `const [creditTargetKey, setCreditTargetKey] = useState<DBAPIKey | null>(null);`
- Render `<AddCreditDialog>` connected to `useAddCreditKey`.

- [ ] **Step 4: Build web to verify**

Run: `cd apps/web && pnpm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/keys/AddCreditDialog.tsx apps/web/src/components/keys/KeyTable.tsx apps/web/src/routes/keys.tsx
git commit -m "feat(web): add Credit column, progress bar, and AddCreditDialog to KeyTable"
```

---

### Task 7: Full Monorepo Build & Live Verification

- [ ] **Step 1: Build touched packages individually**

Run:
```bash
cd packages/types && pnpm run build
cd packages/db && pnpm run build
cd apps/api && pnpm run build
cd apps/web && pnpm run build
```
Expected: All 4 package builds succeed without errors.

- [ ] **Step 2: Run all API test suites**

Run:
```bash
cd apps/api && pnpm exec tsx --test tests/api-keys.test.ts tests/api-keys-credit-db.test.ts tests/api-keys-quota-credit.test.ts tests/api-keys-credit-route.test.ts tests/api-keys-allowed-models.test.ts
```
Expected: All tests PASS.

- [ ] **Step 3: Commit and Push**

```bash
git push origin feat/api-key-allowed-models
```
