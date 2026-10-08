# Security policy

SRouter is a self-hosted gateway that holds the provider credentials you connect to it. A compromise of the host or the database is worth more to an attacker here than a typical bug in a project this size. This page covers where the sensitive data sits, what counts as a vulnerability, and how to tell the maintainer about one.

## Where credentials live

Provider credentials (API keys, OAuth access and refresh tokens, account metadata) sit as JSON in the `credentials` column of the `providers` table, inside the SQLite file, in the clear. The file is not encrypted at rest, so treat it the way you treat an `.env` file: keep it on a host you control, keep it out of shared backups, and keep the directory readable only by the service user.

Gateway API keys cannot be recovered from the database. `api_keys` stores a lowercase sha256 hash plus a display prefix, so the full secret exists only in the response that created it.

The admin password is a salted scrypt hash in the `scrypt$N$r$p$salt$hash` format. Admin sessions are a seven-day `HttpOnly`, `SameSite=Lax` cookie, and the `Secure` flag follows `SROUTER_SECURE_COOKIES` or an `https://` `SROUTER_PUBLIC_URL`.

Request logs record metadata: provider, model, token counts, status code, latency, estimated cost, client address, user agent, and an error message when a request fails. Prompt and completion text are not stored.

Traffic leaves the process only for the providers you configure. Logging goes to stdout, or to `logs/srouter-server.log` when `SROUTER_FILE_LOG=true`. There is no telemetry endpoint and no third-party analytics.

## What counts as a vulnerability

In scope:

- A request that reaches a provider or a stored credential without passing the API key check: an auth bypass, a route mounted outside the middleware chain, a handler that skips the allowlist.
- Server-side request forgery through the custom-provider or verify routes, including a redirect that escapes target validation.
- Reading or changing the database, another client's logs, or the admin session through the API.
- A crash or a resource leak a remote request can trigger: unbounded bodies, streams that never close, a panic that takes the process down.
- Injection through model ids, provider ids, aliases, or headers.

Out of scope:

- Bugs in the upstream providers. Report those to the provider, and tell the maintainer only if SRouter's handling makes the impact worse.
- Vulnerabilities in dependencies. Report them upstream. A note is welcome when SRouter's own use of the dependency is what makes it exploitable.
- An installation with no admin password, reachable by people you do not trust. That is a deployment choice, not a defect.
- Anything that needs local filesystem access to the database or the process. Whoever can read the SQLite file already has the credentials in it.

## Reporting a vulnerability

Email `security@srouter.web.id`. Please do not open a public issue: the gateway ships to whoever clones it, and there is no window to fix anything once the details are public.

GitHub's private vulnerability reporting is turned off on this repository, so email is the channel that works.

A useful report says what an attacker gains, and includes the smallest set of steps or a proof of concept that reproduces it. A patch is welcome but not required.

## What to expect

This is a single-maintainer project with no support contract, so there is no response-time promise and no bug bounty. Fixes land on `main` and go out in the next tagged release. There are no backport branches, so run the latest release or `main` itself. Say in your report whether you want credit in the fix or would rather stay anonymous.

## Running it safely

- Terminate TLS in front of the gateway. It serves plain HTTP on `PORT`.
- Set `SROUTER_ADMIN_PASSWORD` before the first boot, or complete setup from loopback before the port is reachable from anywhere else.
- Non-loopback clients always need a valid API key. The `require_api_key` setting is what makes loopback clients present one too, so turn it on if other users share the machine.
- Keep `SROUTER_CORS_ORIGINS` to the origins you actually use.
- Keep the database on a private volume or a directory only the service user can read, and move exports the way you would move a keystore. They carry the same credentials, in the clear.
