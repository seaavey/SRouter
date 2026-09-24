# Desain: Migrasi API SRouter ke Rust/Axum

**Status:** Siap ditinjau
**Issue:** [#151 — rewrite(api): migrate SRouter API from Node/Hono to Rust + Axum](https://github.com/seaavey/SRouter/issues/151)

## Tujuan

Ganti seluruh implementasi runtime `apps/api` dari Node.js/Hono ke binary Rust/Axum dengan parity pada kontrak dan perilaku API yang ada. API Rust menjadi sumber kebenaran untuk model API dan OpenAPI, tidak menggunakan kode atau data dari `packages/*`, dan tidak memerlukan runtime Node.js di image produksi.

## Cakupan

Termasuk dalam #151:

- Semua route dan perilaku API yang saat ini dilayani `apps/api`.
- Provider routing, executors, protocol translation, authentication/OAuth, persistence, pricing/quota, streaming, observability, tunnel, serta background/startup tasks yang diperlukan API.
- Kontrak OpenAPI yang dihasilkan dari model Rust dan tipe API TypeScript yang dihasilkan untuk consumer web.
- Docker, CI, dokumentasi migrasi API, parity tests, dan benchmark yang diperlukan untuk cutover.
- Implementasi Node/Hono API dihapus setelah parity dan cutover diverifikasi.

Di luar cakupan #151:

- Rewrite UI React/Vite, CLI, atau website/docs ke Rust.
- Penghapusan direktori `packages/*` dari repository. Direktori tersebut tetap dibutuhkan consumer lain dan baru dapat dihapus setelah migrasi consumer pada issue terpisah.
- Perubahan kontrak API publik yang tidak diperlukan untuk parity.

## Constraint sumber `packages/*`

Implementasi Rust tidak boleh membaca, menyalin, mengimpor, membangun, atau menjalankan data/kode dari `packages/*`. Larangan ini berlaku untuk:

- Dependency/path pada Cargo, source Rust, `build.rs`, build scripts, runtime, dan input codegen.
- Schema/database seed, provider catalog, pricing data, protocol definitions, atau artefak lain yang disalin dari file package.
- Generated OpenAPI maupun generated TypeScript API types.

Kontrak migrasi dibuat dari route/controller/service `apps/api`, tes `apps/api/tests`, dokumentasi di luar `packages/*`, dan observasi HTTP API. Node/Hono boleh dijalankan sementara sebagai black-box oracle untuk membandingkan respons, tetapi outputnya bukan input runtime atau seed untuk Rust. Setiap data katalog/pricing yang dibutuhkan API Rust harus memiliki sumber independen yang dicatat atau didefinisikan baru sebagai data milik Rust. Jika parity mensyaratkan data yang sumber independennya belum tersedia, implementasi domain tersebut berhenti untuk meminta keputusan; data package tidak menjadi fallback.

Pemeriksaan akhir mencakup pencarian referensi package pada file Rust/Cargo/build/codegen dan pemeriksaan dependency graph Rust. `apps/api` harus tetap dapat dibangun tanpa membaca `packages/*`.

## Perilaku API yang harus dipertahankan

### Listener dan routing

- Listener utama menggunakan `PORT` dengan default `3000`.
- Listener OAuth lokal menggunakan `OAUTH_PORT` dengan default `1455` dan `OAUTH_HOST` dengan default `0.0.0.0`; listener ini tidak dimulai saat `SROUTER_PUBLIC_URL` mengarahkan callback ke listener publik.
- Listener OAuth mempertahankan route callback dan proxy lokal untuk chat, messages, dan models.
- Main listener mempertahankan `/health`, discovery `/v1`, seluruh route dashboard/API, dan compatibility routes `/v1/v1` untuk chat, messages, dan models.
- Jika direktori web dist yang dipilih oleh `WEB_DIST_PATH` tersedia, server melayani static assets dan SPA fallback. Dalam mode API-only, root tetap memberikan informasi API.
- Route domains mencakup admin, auth, chat completions, Anthropic messages, database import/export, images, keys, logs/analytics, models, pricing, providers/favorites, quota termasuk alias kompatibilitas yang ada, settings/fallbacks, dan tunnel.

### Middleware, error, dan keamanan

- Pertahankan security/version headers, CORS allowlist, CSRF origin guard untuk mutasi cookie-authenticated, body limits, API-key/admin-session auth, rate limiting, dan validasi request.
- Error JSON mempertahankan envelope yang kompatibel, status code, dan error codes yang digunakan consumer.
- Terapkan SSRF protections pada upstream URL/fetch yang relevan.
- SSE harus mempertahankan framing, urutan event, headers, error behavior, cancellation, dan streaming tanpa buffering seluruh respons.

### Database dan transfer

- Default SQLite path tetap `~/.srouter/srouter.db`; `DATABASE_PATH` tetap override; PostgreSQL melalui `DATABASE_URL` tetap didukung.
- Docker memakai `/app/data/srouter.db` pada volume persisten.
- Rust memiliki migrasi dan query sendiri dengan SQLx. Schema compatibility diuji terhadap perilaku service lama menggunakan database uji yang dibuat/diakses melalui black-box API atau fixture sintetis, bukan dengan membaca schema source `packages/*`.
- Sebelum menulis query/migrasi SQLx, tetapkan kontrak schema kompatibilitas dari sumber yang diizinkan. Jika field/relasi yang diperlukan tidak dapat dipastikan tanpa membaca `packages/*`, hentikan pekerjaan persistence dan minta keputusan; jangan menebak schema atau menyalin source terlarang.
- Transfer database tetap admin-session-only, membatasi satu multipart file pada field `database`, mengalirkan upload ke file temporer, dan membatasi upload maksimum 25 MiB. Permission direktori temporer `0700`, file `0600`, cleanup, backup/recovery, cookie reauth, serta status/error transfer dipertahankan.
- Tes selalu menggunakan database temporer. Tes tidak boleh membaca `~/.srouter/srouter.db` atau memakai `DATABASE_URL` produksi.

### Startup dan integrasi

- Startup mengikuti dependency order yang ada: inisialisasi schema PostgreSQL sebelum operasi yang memerlukannya, bootstrap admin, autostart tunnel dengan penanganan error terisolasi, lalu provider registry.
- Pertahankan token-refresh sweeper dan warmup model registry.
- Pertahankan konfigurasi yang digunakan deployment untuk port, storage, admin bootstrap, CORS, URL publik, dan lokasi web dist.

## Arsitektur target

`apps/api` menjadi Cargo package mandiri. Rust binary menggunakan Axum/Tokio untuk HTTP/async, Reqwest untuk upstream, Serde untuk model, SQLx untuk SQLite/PostgreSQL, Tower/Tower HTTP untuk middleware, Tracing untuk logging, Utoipa untuk OpenAPI, dan rustls untuk TLS jika diperlukan.

Batas modul Rust mengikuti tanggung jawab API: konfigurasi/application state/error, routes/handlers, auth, provider registry dan executors, translator, domain services, database, pricing/quota, streaming, dan telemetry. Model publik request/response didefinisikan di Rust. Alur kontrak:

```text
Rust models + Utoipa
        -> OpenAPI yang deterministik
        -> generator TypeScript dari OpenAPI tersebut
        -> `apps/api/generated/api.ts`
        -> web imports via `@srouter/api-contract`
```

Generator TypeScript tidak memakai `packages/*` sebagai input. Generated contract berada di root server `apps/api/generated/`; web mengonsumsinya melalui alias TypeScript/Vite `@srouter/api-contract`. Perubahan web dibatasi pada alias dan consumer API-generated types yang diperlukan; desain dan implementasi UI tidak di-rewrite.

Selama migrasi, source Node/Hono tetap tersedia sebagai oracle dan jalur rollback, tetapi Rust dijalankan sebagai service terpisah saat parity test/staging. Setelah gate cutover terpenuhi, produksi menjalankan Rust API binary. Node boleh tetap dipakai pada build stage untuk membangun aset web; image runtime API tidak membawa atau menjalankan Node.

Root pnpm workspace dan `packages/*` tidak dihapus dalam issue ini karena aplikasi web, CLI, dan docs belum menjadi Rust. CI mempertahankan checks aplikasi TypeScript yang tersisa dan menambah format, lint, test, OpenAPI drift, serta build checks untuk Rust API.

## Strategi migrasi

1. **Freeze kontrak:** inventaris route/method/auth, request/response, headers, errors, SSE, OAuth listener, compatibility paths, dan efek persistence. Hubungkan tiap area dengan parity-test case dari source/tests API di luar `packages/*`.
2. **Rust foundation:** tambahkan Cargo package, config, state, error mapping, observability, listener utama/OAuth, health route, dan guard otomatis no-package.
3. **Persistence dan security:** implementasikan SQLx migrations/repositories, startup lifecycle, admin/auth sessions, API keys, CORS/CSRF, body limits, rate limits, dan audit behavior dengan database temporer.
4. **Dashboard/domain routes:** pindahkan admin, keys, settings/fallbacks, providers/favorites, models, pricing, quota, logs/analytics, tunnel, dan database transfer sebagai vertical slices.
5. **Gateway routes:** pindahkan provider OAuth/token refresh, provider executors, OpenAI/Anthropic request mapping, images, chat/messages, tool interception, pricing/usage accounting, retries/fallbacks, dan SSE.
6. **Contract/deployment:** generate OpenAPI dan TypeScript API types dari Rust; update consumer API web seperlunya; ubah CI dan Docker sehingga runtime production tidak menyertakan Node.
7. **Parity/cutover:** jalankan parity matrix dan benchmark pada environment yang sama, uji staging dengan backup/rollback, cutover ke Rust, lalu hapus source/dependencies Hono API setelah verifikasi.

Setiap vertical slice memiliki tes Rust dan parity case sebelum dependensi Hono untuk area itu dipensiunkan. Tidak ada big-bang cutover sebelum acceptance gates selesai.

## Acceptance criteria

- [ ] Semua route dan perilaku `apps/api` yang tercakup kontrak memiliki implementasi Rust/Axum.
- [ ] Compatibility `/v1/v1/*`, kedua listener, OAuth callbacks, static web serving, dan konfigurasi deployment tetap berjalan.
- [ ] Chat/messages dan image paths mempertahankan streaming/SSE dan perilaku OpenAI/Anthropic yang kompatibel.
- [ ] Auth, provider routing, DB behavior, logging, dan startup tasks lulus parity checks.
- [ ] SQLite dan PostgreSQL behavior diuji; database lama dapat digunakan atau ditransisikan tanpa kehilangan data.
- [ ] OpenAPI dapat dihasilkan deterministik dari Rust; generated web types lolos drift check.
- [ ] Source/build/runtime/codegen Rust tidak membaca atau memakai data dari `packages/*`; Rust build berjalan mandiri.
- [ ] Production API image menjalankan binary Rust tanpa Node runtime; web assets tetap dapat disajikan.
- [ ] CI mencakup Rust format/lint/tests, OpenAPI drift, dan checks untuk aplikasi TS yang tetap berada dalam repo.
- [ ] Benchmark Node-vs-Rust direkam pada kondisi sebanding untuk startup, idle/active memory, CPU/throughput yang relevan, dan ukuran production image.
- [ ] Migration, storage compatibility, deployment, staging verification, dan rollback didokumentasikan sebelum cutover.
- [ ] Source/API dependencies Node/Hono dihapus hanya setelah parity dan production verification; direktori `packages/*` tidak dihapus dalam #151.

## Risiko dan mitigasi

- **Kontrak tersembunyi:** beberapa perilaku tidak tampak di daftar route. Mitigasi: freeze contract dari tests dan black-box response sebelum mulai port; jangan menganggap endpoint parity dari status `200` saja.
- **Database compatibility:** schema lama tidak boleh disalin dari `packages/*`, tetapi file database pengguna tetap harus aman. Mitigasi: SQLx migrations milik Rust, synthetic DB tests, round-trip export/import melalui API, backup, staging, dan rollback gate.
- **Static catalog/pricing:** data package tidak boleh menjadi input. Mitigasi: identifikasi provenance independen sebelum port; minta keputusan eksplisit jika sumber independen tidak dapat menjaga compatibility.
- **Streaming/proxy regressions:** buffering, cancellation, headers, dan timeout berbeda antar runtime. Mitigasi: parity tests pada byte/event stream dan fake upstream, lalu benchmark dan soak test staging.
- **Ukuran migrasi:** API berisi beberapa subsystem besar. Mitigasi: Rust/Node berdampingan, vertical slice, test gate per area, dan cutover terakhir.
