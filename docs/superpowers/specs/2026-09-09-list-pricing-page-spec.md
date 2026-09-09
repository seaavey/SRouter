# Spec: List Pricing Page (`/pricing`)

## 1. Overview
Fitur halaman **"List Pricing"** pada SRouter Web Dashboard (`apps/web/src/routes/pricing.tsx`) menampilkan katalog harga token model AI (input, output, cached read, reasoning) beserta limit token (context, max output), modalitas I/O (`text`, `image`, `video`, `audio`, `pdf`), dan kapabilitas (`reasoning`, `tool_call`, `attachment`, `open_weights`, `structured_output`). Sumber dataset berasal dari compact pricing catalog (`packages/pricing/pricing.jsonc`).

## 2. Technical Decisions & Architecture
- **Source of Truth**: `loadModelsDevData()` pada `@srouter/pricing` membaca `pricing.jsonc`.
- **Backend Route**: `GET /v1/pricing/models` di bawah router Hono (`apps/api/src/routes/v1/pricing.ts`), dilindungi middleware `ApiKeyAuth`.
- **Server Caching**:
  - Module-level memoization di `PricingLogic` Node.js process. Parsing file JSONC hanya dilakukan 1x saat inisialisasi / cold start, atau saat query parameter `?refresh=true` diberikan.
  - HTTP header: `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`.
- **Client Caching (TanStack Query)**:
  - `queryKey: ["pricing", "models"]`
  - `staleTime: 1000 * 60 * 60` (1 jam)
  - `gcTime: 1000 * 60 * 60 * 24` (24 jam)
  - `refetchOnWindowFocus: false`, `refetchOnReconnect: false`, `refetchOnMount: false`
  - Tombol manual **Refresh** di toolbar untuk revalidasi on-demand via `queryClient.invalidateQueries`.
- **Frontend UI & Styling**:
  - Mengikuti `DESIGN.md` SRouter: Developer Terminal / Industrial Clean, JetBrains Mono font, anti-slop / badge diet (micro-icons dengan tooltip, bukan pill badge tebal berwarna-warni).
  - Navigasi sidebar: ditambahkan di grup Workspace dengan ikon `Coins`.
  - Filter: Search (ID/Name), Provider/Family, Modality (Text, Image, Video, Audio), Capabilities (Reasoning, Tool Calling, Open Weights).

## 3. Modality & Capability Icons Mapping
Menggunakan icons dari `lucide-react`:
- **Text**: `FileText`
- **Image**: `Image`
- **Video**: `Video`
- **Audio**: `Mic` (input) / `Volume2` (output)
- **PDF**: `FileSpreadsheet` / `FileCode`
- **Reasoning**: `Brain`
- **Tool Calling**: `Wrench`
- **Structured Output**: `Code`
- **Open Weights**: `LockOpen`
- **Attachment**: `Paperclip`

Setiap icon dibungkus dalam Base UI / Radix Tooltip (`components/ui/tooltip.tsx`) yang menampilkan label kontekstual saat di-hover.

## 4. Verification Plan
- Unit tests: `cd apps/api && pnpm exec tsx --test tests/pricing-route.test.ts`
- Frontend build check: `cd apps/web && pnpm run build`
- API smoke check: `curl http://localhost:3000/v1/pricing/models`
