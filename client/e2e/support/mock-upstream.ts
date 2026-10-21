// A local OpenAI-compatible upstream. The E2E gateway sends real
// `/v1/chat/completions` calls here, so the overview page renders traffic that
// travelled the production request path instead of a hand-written log row.
import { SERVED_MODELS, TRAFFIC, type UsageFixture } from "./data"

interface ChatRequest {
  model?: string
  stream?: boolean
}

interface UsageReply {
  usage: UsageFixture
  model: string
}

/** Per-model cursor into the fixture sequence. */
const cursors = new Map<string, number>()

function nextUsage(requested: string): UsageReply {
  const bare = requested.split("/").pop() ?? requested
  const entry = TRAFFIC.find((candidate) => candidate.model === bare)
  if (!entry) {
    return {
      model: bare,
      usage: { prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0 },
    }
  }

  const cursor = cursors.get(entry.model) ?? 0
  const fixture = entry.calls[Math.min(cursor, entry.calls.length - 1)]
  cursors.set(entry.model, cursor + 1)

  return { model: entry.model, usage: fixture }
}

function completionBody({ model, usage }: UsageReply) {
  const cached = usage.cached_tokens
  return {
    id: "chatcmpl-e2e",
    object: "chat.completion",
    created: 0,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "ok" },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.prompt_tokens + usage.completion_tokens,
      prompt_tokens_details: { cached_tokens: cached },
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  }
}

function streamBody({ model, usage }: UsageReply) {
  const chunk = {
    id: "chatcmpl-e2e",
    object: "chat.completion.chunk",
    created: 0,
    model,
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: "ok" },
        finish_reason: null,
      },
    ],
  }
  const final = {
    ...chunk,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: {
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.prompt_tokens + usage.completion_tokens,
      prompt_tokens_details: { cached_tokens: usage.cached_tokens },
    },
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const frame of [chunk, final]) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"))
      controller.close()
    },
  })

  return new Response(stream, {
    headers: { "content-type": "text/event-stream" },
  })
}

/** Starts the mock upstream on `port` and returns its stop handle. */
export function startMockUpstream(port: number) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      const url = new URL(request.url)

      if (request.method === "GET" && url.pathname === "/v1/models") {
        return Response.json({
          object: "list",
          data: SERVED_MODELS.map((id) => ({
            id,
            object: "model",
            owned_by: "e2e",
          })),
        })
      }

      if (
        request.method === "POST" &&
        url.pathname === "/v1/chat/completions"
      ) {
        const body = (await request.json()) as ChatRequest
        const reply = nextUsage(body.model ?? "")
        return body.stream
          ? streamBody(reply)
          : Response.json(completionBody(reply))
      }

      return new Response("not found", { status: 404 })
    },
  })

  return server
}
