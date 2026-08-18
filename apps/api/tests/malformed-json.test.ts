import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { chatRoute } from "../src/routes/v1/chat.js";
import { messagesRoute } from "../src/routes/v1/messages.js";
import { HTTPException } from "hono/http-exception";

const app = new Hono();

app.onError((err, c) => {
    if (err instanceof HTTPException) {
        return c.json(
            {
                error: {
                    message: err.message || "Invalid request",
                    type: "invalid_request_error",
                    code: err.status === 400 ? "invalid_request" : undefined
                }
            },
            err.status
        );
    }
    if (err instanceof SyntaxError && "message" in err && (err as Error).message.includes("JSON")) {
        return c.json(
            {
                error: {
                    message: "Malformed JSON in request body",
                    type: "invalid_request_error",
                    code: "invalid_json"
                }
            },
            400
        );
    }
    return c.json(
        {
            error: {
                message: err.message || "Internal Server Error",
                type: "internal_error"
            }
        },
        500
    );
});

app.route("/v1", chatRoute);
app.route("/v1", messagesRoute);

test("POST /v1/chat/completions returns 400 on malformed JSON payload without unhandled exception", async () => {
    const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ malformed json: true "
    });

    assert.equal(res.status, 400);
    const json = (await res.json()) as { error: { message: string; type: string; code?: string } };
    assert.equal(json.error.type, "invalid_request_error");
    assert.match(json.error.message, /Malformed JSON/i);
});

test("POST /v1/chat/completions returns 400 on empty request body", async () => {
    const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: ""
    });

    assert.equal(res.status, 400);
    const json = (await res.json()) as { error: { message: string; type: string; code?: string } };
    assert.equal(json.error.type, "invalid_request_error");
});
