// Boots the isolated stack the E2E suite runs against: a throwaway SQLite file,
// a mock OpenAI-compatible upstream, real gateway traffic through the production
// request path, and a saved admin session for the browser context.
//
// Run by Playwright's `webServer`; the process stays alive until Playwright
// stops it, so it prints `e2e stack ready` only once every fixture is in place.
import { Database } from "bun:sqlite"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import {
  ADMIN_PASSWORD,
  callTotal,
  PROVIDER_ID,
  PROVIDER_PREFIX,
  TRAFFIC,
  UPSTREAM_API_KEY,
} from "./data"
import { startMockUpstream } from "./mock-upstream"

const here = import.meta.dir
const clientRoot = resolve(here, "../..")
const repoRoot = resolve(clientRoot, "..")
const workDir = join(clientRoot, "e2e", ".tmp")
const databasePath = join(workDir, "e2e.db")
const homeDir = join(workDir, "home")
const storageStatePath = join(workDir, "storage-state.json")
const distDir = join(clientRoot, "dist")
const serverBinary = join(
  repoRoot,
  "server",
  "target",
  "debug",
  "srouter-server"
)

const port = Number(process.env.E2E_PORT ?? 3100)
const upstreamPort = Number(process.env.E2E_UPSTREAM_PORT ?? 4100)
const baseURL = `http://127.0.0.1:${port}`
const sessionCookie = "srouter_admin_session"

function log(message: string) {
  console.log(`e2e stack: ${message}`)
}

function run(command: string[], cwd: string) {
  log(`running ${command.join(" ")}`)
  const result = Bun.spawnSync({
    cmd: command,
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  })

  if (result.exitCode !== 0) {
    throw new Error(`${command.join(" ")} exited with ${result.exitCode}`)
  }
}

function resetWorkDir() {
  rmSync(workDir, { recursive: true, force: true })
  mkdirSync(homeDir, { recursive: true })
}

function build() {
  if (process.env.E2E_SKIP_BUILD === "1") {
    log("skipping builds (E2E_SKIP_BUILD=1)")
    return
  }

  run(["bun", "run", "build"], clientRoot)
  // The debug profile keeps an incremental rebuild in seconds; the suite is
  // request-bound, not CPU-bound, so the optimised binary buys nothing here.
  run(["cargo", "build", "--locked"], join(repoRoot, "server"))
}

function serverEnv() {
  return {
    ...process.env,
    PORT: String(port),
    DATABASE_PATH: databasePath,
    HOME: homeDir,
    SROUTER_ADMIN_PASSWORD: ADMIN_PASSWORD,
    SROUTER_PUBLIC_URL: baseURL,
    WEB_DIST_PATH: distDir,
    SROUTER_ACCESS_LOG: "off",
    RUST_LOG: "error",
  }
}

async function waitForHealth(deadlineMs = 30_000) {
  const started = Date.now()
  while (Date.now() - started < deadlineMs) {
    try {
      const response = await fetch(`${baseURL}/health`)
      if (response.ok) {
        return
      }
    } catch {
      // Not listening yet; the boot takes a moment after the process starts.
    }
    await Bun.sleep(150)
  }

  throw new Error(`gateway did not answer /health within ${deadlineMs}ms`)
}

async function bootServer() {
  const server = Bun.spawn({
    cmd: [serverBinary],
    cwd: workDir,
    env: serverEnv(),
    stdout: "ignore",
    stderr: "inherit",
  })

  await waitForHealth()
  return server
}

async function stopServer(server: ReturnType<typeof Bun.spawn>) {
  server.kill("SIGTERM")
  await server.exited
}

/**
 * The gateway refuses a user-registered upstream on a loopback address (the
 * SSRF guard), so the mock provider is written straight into the throwaway
 * database. It is a fixture row, not a bypass: every request afterwards travels
 * the real gateway path, and the registry reads the row on boot.
 */
function seedProvider() {
  const database = new Database(databasePath)
  database.run(
    `INSERT INTO providers
       (id, provider_id, name, alias, category, protocol, base_url, enabled, credentials, meta, created_at)
     VALUES (?, ?, ?, ?, 'custom_provider', 'openai', ?, 1, ?, '{}', ?)`,
    [
      PROVIDER_ID,
      PROVIDER_ID,
      "E2E Mock",
      PROVIDER_PREFIX,
      `http://127.0.0.1:${upstreamPort}/v1`,
      JSON.stringify({ api_key: UPSTREAM_API_KEY }),
      Date.now(),
    ]
  )
  database.close()
}

async function adminSession() {
  const response = await fetch(`${baseURL}/v1/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseURL },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  })

  if (!response.ok) {
    throw new Error(`admin login failed with ${response.status}`)
  }

  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(";")[0])
    .find((pair) => pair.startsWith(`${sessionCookie}=`))

  if (!cookie) {
    throw new Error("admin login answered without the session cookie")
  }

  return cookie
}

async function createGatewayKey(cookie: string) {
  const response = await fetch(`${baseURL}/v1/keys`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseURL, cookie },
    body: JSON.stringify({ name: "e2e" }),
  })

  if (!response.ok) {
    throw new Error(`key creation failed with ${response.status}`)
  }

  const body = (await response.json()) as { key?: string }
  if (!body.key) {
    throw new Error("key creation answered without the secret")
  }

  return body.key
}

async function sendTraffic(secret: string) {
  const requests: Promise<void>[] = []

  for (const entry of TRAFFIC) {
    // The mock upstream answers the nth call for a model with the nth fixture,
    // so the loop only needs the count, not the values.
    for (let index = 0; index < entry.calls.length; index += 1) {
      requests.push(
        (async () => {
          const response = await fetch(`${baseURL}/v1/chat/completions`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${secret}`,
            },
            body: JSON.stringify({
              model: `${PROVIDER_PREFIX}/${entry.model}`,
              messages: [{ role: "user", content: "ping" }],
            }),
          })

          if (!response.ok) {
            const detail = await response.text()
            throw new Error(
              `completion for ${entry.model} failed with ${response.status}: ${detail}`
            )
          }

          const payload = (await response.json()) as {
            usage?: { total_tokens?: number }
          }
          if (!payload.usage?.total_tokens) {
            throw new Error(`completion for ${entry.model} carried no usage`)
          }
        })()
      )
    }
  }

  await Promise.all(requests)
  log(`sent ${requests.length} gateway requests`)
}

/**
 * The burst above lands every row in the same hour bucket, which draws as one
 * spike at the right edge of the plot. The rows stay the real requests the
 * gateway logged; only their clocks are spread across the hourly buckets the
 * fixture names, so every range has a shape to draw. Totals do not change.
 */
function spreadTraffic() {
  const database = new Database(databasePath)
  const now = Date.now()
  const hour = 3_600_000
  let dated = 0

  for (const entry of TRAFFIC) {
    for (const call of entry.calls) {
      // `total_tokens` is unique across the fixture, so it addresses exactly
      // the row this call produced. A miss here means the fixture drifted.
      const result = database.run(
        "UPDATE request_logs SET created_at = ? WHERE total_tokens = ? AND status_code = 200",
        [now - call.hours_ago * hour, callTotal(call)]
      )
      if (result.changes !== 1) {
        throw new Error(
          `could not date the ${entry.model} request with ${callTotal(call)} tokens`
        )
      }
      dated += 1
    }
  }

  database.close()
  log(`dated ${dated} requests across their hourly buckets`)
}

function writeStorageState(cookie: string) {
  const [, value] = cookie.split("=")
  writeFileSync(
    storageStatePath,
    JSON.stringify(
      {
        cookies: [
          {
            name: sessionCookie,
            value,
            domain: "127.0.0.1",
            path: "/",
            expires: -1,
            httpOnly: true,
            secure: false,
            sameSite: "Lax",
          },
        ],
        origins: [],
      },
      null,
      2
    )
  )
}

async function main() {
  resetWorkDir()
  build()

  const upstream = startMockUpstream(upstreamPort)
  log(`mock upstream on http://127.0.0.1:${upstreamPort}`)

  // First boot is only there to run the migrations on a fresh file; the
  // provider row has to exist before the registry reads it on the real boot.
  const bootstrap = await bootServer()
  await stopServer(bootstrap)
  seedProvider()
  log("seeded the mock custom provider")

  const server = await bootServer()
  const cookie = await adminSession()
  const secret = await createGatewayKey(cookie)
  await sendTraffic(secret)
  spreadTraffic()
  writeStorageState(cookie)
  log("admin session saved")

  const shutdown = () => {
    server.kill("SIGTERM")
    upstream.stop(true)
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  log(`ready on ${baseURL}`)
}

main().catch((error) => {
  console.error(
    `e2e stack failed: ${error instanceof Error ? error.message : error}`
  )
  process.exit(1)
})
