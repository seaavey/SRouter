# FreeBuff Native Provider — Design Spec

## Status

- **Status:** Draft — desain disetujui Seaavey untuk ditulis sebagai spec
- **Scope:** Full parity native di SRouter; tidak menjalankan `freebuff-proxy` sebagai service terpisah
- **Constraint:** Pure Node.js/TypeScript. TLS JA3 spoofing asli tidak ditargetkan; browser-like headers/User-Agent hanya best-effort.

## Tujuan

Menambahkan FreeBuff sebagai provider native di SRouter sehingga SRouter langsung berbicara dengan endpoint Codebuff/FreeBuff dan mempertahankan lifecycle yang dibutuhkan upstream: free session, agent run, CLI request envelope, model registry, multi-token failover, streaming, non-streaming, dan typed error handling.

Satu token FreeBuff direpresentasikan sebagai satu koneksi provider di dashboard/database. Seluruh koneksi FreeBuff dikoordinasikan oleh satu coordinator runtime agar pooling dan failover tetap konsisten.

## Non-goals

- Menjalankan binary Go `freebuff-proxy`.
- Menyediakan JA3/TLS ClientHello impersonation setara uTLS.
- Mengubah provider executor lain atau routing umum lebih dari yang diperlukan.
- Menambahkan hardcoded model yang terlihat sebagai model live; fallback registry hanya boleh dipakai sesuai parity upstream dan harus dibedakan dari hasil live.
- Menambahkan OAuth FreeBuff sebelum mekanisme token import/configuration native disepakati.

## Arsitektur

```text
SRouter API
  -> ProviderRegistry
  -> FreebuffExecutor facade
  -> FreebuffCoordinator
      -> FreebuffConnection[token A]
          -> session manager
          -> run manager
          -> upstream client
      -> FreebuffConnection[token B]
          -> session manager
          -> run manager
          -> upstream client
      -> model registry
```

Komponen provider berada di `packages/executors/src/freebuff/`:

- `executor.ts`: implementasi `AIProvider`; facade chat/model.
- `coordinator.ts`: round-robin, failover, cooldown, waiting-room selection, lease release.
- `upstream.ts`: HTTP wire protocol Codebuff/FreeBuff, auth, envelope, headers, compression, optional HTTP/SOCKS proxy.
- `session.ts`: create/poll/cache/invalidate/end dengan single-flight per token.
- `runs.ts`: START/FINISH, prewarm, rotasi, inflight drain, shutdown.
- `registry.ts`: fetch dan parse source TypeScript Codebuff menjadi mapping model→agent; refresh periodik dan previous-state retention.
- `convert.ts`: request whitelist, `developer`→`system`, tool-schema normalization, SSE sanitization, accumulator non-stream.
- `errors.ts`: typed errors dan mapping ke contract SRouter.
- `profiles.ts`: User-Agent dan browser-like header profiles tanpa klaim JA3 spoof.

Jika ukuran file atau coupling berkembang, komponen lifecycle boleh dipindahkan ke package internal khusus, tetapi boundary `AIProvider` tetap di executor.

## Request dan model contract

Public model ID memakai prefix provider SRouter dan mempertahankan nested ID upstream, misalnya:

```text
freebuff/deepseek/deepseek-v4-flash
```

Saat request dikirim upstream, hanya prefix `freebuff/` yang dihapus sehingga model menjadi:

```text
deepseek/deepseek-v4-flash
```

`listModels()` wajib live-fetch registry ketika sumber upstream tersedia. Jika refresh gagal, registry mempertahankan mapping valid sebelumnya; saat boot pertama, fallback parity boleh dipakai sebagai degraded/offline state dan tidak boleh mengarang model di luar catalog yang diketahui.

Chat harus mendukung:

- request streaming SSE dengan chunk yang valid dan terminator `[DONE]`;
- request non-streaming dengan akumulasi content, reasoning, tool calls, finish reason, dan usage;
- whitelist parameter agar field yang tidak didukung upstream tidak diteruskan;
- cancellation saat client disconnect.

## Upstream envelope

Setiap chat upstream harus mempertahankan field/header parity berikut:

- `x-freebuff-model`;
- `x-freebuff-instance-id` jika session aktif;
- `codebuff_metadata` berisi `run_id`, generated `client_id`, dan instance id/session metadata;
- `provider.data_collection = deny`;
- `stream = true` ke upstream;
- stop sentinel `cb_easp` bila client tidak memberi stop sendiri;
- rotating User-Agent/browser headers best-effort.

Token upstream hanya boleh berasal dari konfigurasi provider/database dan tidak boleh masuk log, error body, dump, atau response.

## Session dan run lifecycle

Per koneksi/token:

- session dibuat lazy atau diprewarm sesuai parity yang aman terhadap quota;
- session active dipakai sampai expiry margin;
- queued session menghasilkan waiting-room error dengan retry delay;
- ended/superseded/expired/session-invalid di-invalidate dan dibuat ulang;
- concurrent refresh dibuat single-flight;
- agent run di-START saat diperlukan, dipelihara, dirotasi sesuai interval, lalu di-FINISH setelah inflight lease selesai;
- shutdown menghentikan scheduler, menolak pekerjaan baru, FINISH run, END session, dan memakai deadline terbatas;
- timer background harus `.unref()` agar tidak menahan proses test/shutdown.

## Pooling dan error handling

Coordinator memilih koneksi enabled secara round-robin dan failover linear.

- `401`: cooldown token 30 menit, lanjut token berikutnya.
- `429` quota: cooldown sampai `retryAfter/resetAt`, lalu surfacing 429 bila seluruh token exhausted.
- temporary ban: cooldown sampai `resumesAt`, surfacing 403 bila seluruh token banned.
- waiting room: coba token lain; jika semuanya queued, pilih posisi terbaik dan surfacing 503 + Retry-After.
- session/run invalid: invalidate komponen terkait dan retry maksimal sekali.
- error lain: lanjut failover; jika seluruh token gagal, surfacing error upstream yang aman.

## Persistence dan wiring SRouter

Provider config memakai `providerId = "freebuff"`, `protocol = "openai"`, dan satu `accessToken` per koneksi. `baseUrl` default mengarah ke upstream Codebuff/FreeBuff yang digunakan client native, bukan localhost proxy.

Perubahan wiring yang dibutuhkan:

1. export `FreebuffExecutor` dari `packages/executors/src/index.ts`;
2. tambah case spesifik `freebuff` sebelum generic `protocol === "openai"` di `apps/api/src/services/registry.ts`;
3. tambah token-import/config path FreeBuff yang menyimpan satu token per koneksi dan langsung mendaftarkan runtime instance;
4. tambah catalog/provider definition serta model filtering dengan public `freebuff/<nested-id>`;
5. pastikan delete/disable membersihkan runtime coordinator, bukan hanya row SQLite;
6. jika metadata runtime/config tambahan dibutuhkan, gunakan field persisted khusus yang sudah disediakan codebase, bukan menyamarkan auth mode di `customHeaders`;
7. jangan memakai `any` atau `unknown` di area yang dilindungi `.agents/AGENTS.md`.

Tidak ada perubahan database yang dibutuhkan bila satu token dapat direpresentasikan oleh kolom `access_token`, `base_url`, dan metadata provider yang sudah ada. Migration hanya ditambahkan bila implementasi menemukan kebutuhan persisted yang konkret.

## Security dan operasional

- Default listen/API behavior SRouter tetap berlaku.
- FreeBuff token tidak boleh dikirim sebagai client API key ke upstream secara salah; executor menambahkan Bearer token hanya pada outbound Codebuff request.
- Debug dump harus opt-in, directory-bound, dan redacted.
- Base URL harus divalidasi agar tidak mengarah ke target yang tidak diinginkan oleh konfigurasi user.
- TLS best-effort tidak boleh menggunakan `rejectUnauthorized=false` sebagai shortcut.
- Error yang dikembalikan ke client harus menghapus credential dan membatasi ukuran body upstream.

## Verification criteria

- TypeScript compile bersih pada package yang berubah dan `apps/api`.
- Unit test converter: whitelist, role, schema, SSE, tool call accumulator.
- Unit test session: single-flight, queued, expiry, invalidate, end.
- Unit test runs: concurrent acquire, rotation, release/drain, cooldown, shutdown.
- Unit test coordinator: round-robin, auth failover, waiting-room best selection, all-token error.
- Mock upstream test memverifikasi URL, method, headers, envelope, model nested, dan stream.
- `listModels()` healthy mengembalikan hasil live; failure tidak mengembalikan fabricated live list.
- Smoke test SRouter `/v1/models`, non-stream chat, stream chat, disable/delete koneksi, dan shutdown.
- Live verification dengan token FreeBuff asli dilakukan hanya setelah user menyediakan credential secara aman; credential tidak ditulis ke repository.

## Risiko dan mitigasi

- **Upstream undocumented berubah:** typed classifier + previous registry state + fixture tests; live test wajib setelah implementasi.
- **Quota/session admission terbakar oleh prewarm:** prewarm dibuat best-effort dan tidak melakukan POST session berkala tanpa kebutuhan.
- **Nested model ID salah dipotong:** helper prefix stripping diuji eksplisit.
- **State runtime tertinggal setelah delete/disable:** coordinator memiliki register/unregister/update lifecycle dan diuji dari DB sampai registry.
- **TLS JA3 berbeda dari Go proxy:** dokumentasikan sebagai batasan pure Node, gunakan header/profile best-effort, jangan klaim parity penuh pada fingerprint layer.
- **Timer menggantungkan test:** semua scheduler/timer memakai `.unref()` dan shutdown eksplisit.

## Keputusan terbuka yang bukan blocker desain

- Nama route UI/token import final mengikuti pola provider existing.
- Interval refresh/rotation dapat diekspos sebagai konfigurasi provider setelah baseline parity lulus.
- Apakah fallback model boot ditampilkan di UI atau hanya dipakai internal ditentukan saat implementation plan berdasarkan contract `listModels()` SRouter.

## Acceptance

Desain ini disetujui Seaavey pada 2026-08-12 untuk dilanjutkan ke implementation plan. Implementasi belum dimulai pada spec ini.
