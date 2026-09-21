---
layout: ../../../layouts/DocsLayout.astro
title: Errors and limits
description: Understand validation errors, rate limits, body limits, and upstream failures.
section: Reference
---

## Error shape

API responses use the response helpers in `apps/api/src/utils/response.ts`. Validation failures from Zod and route-specific guards should be returned as structured errors rather than thrown strings.

```json
{
    "error": {
        "message": "A readable explanation",
        "type": "invalid_request_error",
        "code": "invalid_payload"
    }
}
```

The exact status and code depend on the boundary that rejected the request. Do not infer provider failure from a client-side validation error.

## Common boundaries

| Boundary                       | Typical result                     | Source               |
| ------------------------------ | ---------------------------------- | -------------------- |
| Missing or invalid virtual key | Unauthorized response              | `ApiKeyAuth.ts`      |
| Model not allowed for key      | Model access error                 | `ModelAccess.ts`     |
| Request too frequent           | Rate-limit response                | `RateLimit.ts`       |
| Body too large                 | Request rejected before controller | `BodyLimit.ts`       |
| Invalid JSON/schema            | `invalid_request_error`            | `Validation.ts`      |
| Disallowed browser origin      | CSRF/origin rejection              | `CsrfOrigin.ts`      |
| Provider failure               | Upstream error, retry, or fallback | `fallback.policy.ts` |

## Retry guidance

Clients may retry transient upstream failures, but should not blindly retry invalid payloads, missing credentials, model access failures, or a request that has already streamed partial output. When a combo is configured, fallback policy may perform the provider retry inside the gateway.
