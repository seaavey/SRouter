# SRouter landing page

Product landing page for [SRouter](https://github.com/seaavey/SRouter), a local-first AI gateway for coding tools and applications.

## Run with Docker

Run these commands from the SRouter repository root:

```bash
docker compose -f apps/docs/docker-compose.yml up --build -d
```

Open <http://localhost:4321>.

The public landing page is <https://srouter.web.id>.

## Run through a Cloudflare Tunnel

The active deployment uses the permanent hostname <https://srouter.web.id>. It routes through the existing Cloudflare Tunnel to the local landing-page container at `http://localhost:4321`.

Start the local landing-page container:

```bash
docker compose -f apps/docs/docker-compose.yml up --build -d
```

The system Cloudflare Tunnel serves `srouter.web.id` after its ingress points to the landing-page container.

The zone is configured with HTTPS redirect, minimum TLS 1.2, HSTS without subdomain inheritance, Brotli/Gzip compression, and a static-asset cache rule. HTML and sitemap responses remain revalidatable so new landing-page deploys are visible without waiting for a long edge TTL.

Machine-readable product information is available at <https://srouter.web.id/llms.txt>.

For a temporary preview URL, use the optional Quick Tunnel profile. It does not require an account token or a committed credential:

```bash
docker compose -f apps/docs/docker-compose.yml --profile tunnel up --build -d
docker compose -f apps/docs/docker-compose.yml logs -f cloudflared
```

Copy the `https://...trycloudflare.com` URL printed by `cloudflared`. The URL is temporary and can change whenever the container is recreated.

For a separate stable hostname managed by Docker, create a Cloudflare Tunnel in the dashboard, configure its public hostname to point to `http://docs:80`, then save the tunnel token in a local `.env` file:

```dotenv
CLOUDFLARE_TUNNEL_TOKEN=replace-with-your-tunnel-token
```

Start the named tunnel profile:

```bash
docker compose -f apps/docs/docker-compose.yml --profile named-tunnel up --build -d
```

The token is read at runtime and is ignored by Git. The existing SRouter tunnel configuration is not modified by this landing-page project.

Stop the site with:

```bash
docker compose -f apps/docs/docker-compose.yml down
```

## Run without Docker

Requirements: Node.js 22 or later and pnpm 11.

Run from the SRouter repository root:

```bash
pnpm --filter docs dev
```

Open <http://localhost:4321>.

## Build and preview

```bash
pnpm --filter docs check
pnpm --filter docs build
pnpm --filter docs preview
```

The site is a static Astro landing page served by Nginx in the production container. SEO metadata, Open Graph, JSON-LD, sitemap, and landing-page content are built for the SRouter product rather than a documentation index.
