#!/usr/bin/env node
// Command Code sign-in relay.
//
// The studio only hands its key to a loopback callback, so a gateway on a
// public origin can never receive it directly. This listens on the operator's
// machine and forwards the hand-off to the gateway, which parks the key on the
// pending sign-in session the dashboard is polling.
//
// Usage: node commandcode-relay.mjs <gateway origin> [port]

import { createServer } from "node:http"

const CALLBACK_PATH = "/v1/auth/commandcode/callback"
const STUDIO_ORIGIN = "https://commandcode.ai"
const MAX_BODY_BYTES = 32 * 1024
// The studio aborts its own fetch after five seconds, so a slower forward is
// useless to it; answering early keeps the browser page honest.
const FORWARD_TIMEOUT_MS = 4500

const target = (process.argv[2] ?? "").trim().replace(/\/+$/, "")
const port = Number(process.argv[3] ?? 5959)

if (!/^https?:\/\/[^/]+/.test(target) || port < 1 || port > 65535) {
  console.error("usage: node commandcode-relay.mjs <gateway origin> [port]")
  process.exit(1)
}

function studioHeaders() {
  return {
    "Access-Control-Allow-Origin": STUDIO_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    Vary: "Origin",
  }
}

function send(response, status, body, contentType = "application/json") {
  response.writeHead(status, {
    ...studioHeaders(),
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  })
  response.end(body)
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let overflowed = false
    request.on("data", (chunk) => {
      if (overflowed) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        // Drain the rest instead of destroying the socket: the 413 still has to
        // reach the caller.
        overflowed = true
        chunks.length = 0
        reject(new Error("payload too large"))
        return
      }
      chunks.push(chunk)
    })
    request.on("end", () => {
      if (!overflowed) resolve(Buffer.concat(chunks))
    })
    request.on("error", (error) => {
      if (!overflowed) reject(error)
    })
  })
}

const server = createServer(async (request, response) => {
  const path = (request.url ?? "/").split("?")[0]

  if (request.method === "OPTIONS") {
    response.writeHead(204, studioHeaders())
    response.end()
    return
  }

  if (path === "/" && request.method === "GET") {
    send(
      response,
      200,
      `<!doctype html><meta charset="utf-8"><title>Command Code relay</title>
       <p>Relay running. Finish the sign-in in the browser tab that opened.</p>`,
      "text/html; charset=utf-8"
    )
    return
  }

  if (path !== CALLBACK_PATH) {
    send(response, 404, JSON.stringify({ success: false, error: "not found" }))
    return
  }

  if (request.method !== "POST") {
    send(response, 405, JSON.stringify({ success: false, error: "use POST" }))
    return
  }

  let body
  try {
    body = await readBody(request)
  } catch (error) {
    send(
      response,
      413,
      JSON.stringify({ success: false, error: String(error.message) })
    )
    return
  }

  try {
    const upstream = await fetch(`${target}${request.url}`, {
      method: "POST",
      headers: {
        "Content-Type": request.headers["content-type"] ?? "application/json",
      },
      body,
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    })
    const text = await upstream.text()
    send(response, upstream.status, text)
  } catch (error) {
    send(
      response,
      502,
      JSON.stringify({
        success: false,
        error: `gateway unreachable: ${error.message}`,
      })
    )
  }
})

server.on("error", (error) => {
  console.error(`relay could not listen on 127.0.0.1:${port}: ${error.message}`)
  process.exit(1)
})

server.listen(port, "127.0.0.1", () => {
  console.log(
    `Command Code relay on http://127.0.0.1:${port} -> ${target}${CALLBACK_PATH}`
  )
  console.log("Leave this running, then finish the sign-in in the browser.")
})
