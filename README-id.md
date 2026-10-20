# SRouter

**Satu endpoint self-hosted untuk semua akun LLM yang sudah kamu bayar.** SRouter adalah LLM gateway yang berbicara dua bahasa API sekaligus, OpenAI dan Anthropic, jadi Claude Code, Cursor, Cline, SDK OpenAI, dan tool apa pun yang mengharapkan salah satu bentuk itu bisa diarahkan ke satu base URL tanpa mengurus satu key per provider.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Rust: edition 2024](https://img.shields.io/badge/rust-edition%202024-dea584.svg)](server/Cargo.toml)
[![Storage: SQLite](https://img.shields.io/badge/storage-SQLite-003b57.svg)](server/migrations)

[English](README.md) · **Bahasa Indonesia**

[Kenapa SRouter](#kenapa-srouter) · [Mulai cepat](#mulai-cepat) · [Menyambungkan client](#menyambungkan-client) · [Provider](#provider) · [Konfigurasi](#konfigurasi) · [API](#api) · [Dashboard](#dashboard) · [Arsitektur](#arsitektur) · [Development](#development) · [Deployment](#deployment) · [Troubleshooting](#troubleshooting) · [Keamanan](#keamanan) · [Benchmark](#benchmark) · [Status proyek](#status-proyek) · [Lisensi](#lisensi)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/benchmark-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="assets/benchmark-light.png">
  <img alt="Grafik tiga panel yang membandingkan ketiga gateway di satu host: 8.675 vs 525 vs 354 request per detik pada konkurensi 50, 15 vs 131 vs 424 MB memori idle, dan 5,5 vs 86,4 vs 123,1 ms latensi median." src="assets/benchmark-light.png" width="100%">
</picture>

Satu host, satu generator beban, tiga gateway. Metode, batasan, dan tabelnya ada di [Benchmark](#benchmark).


## Kenapa SRouter

- **Satu endpoint, dua protokol.** `/v1/chat/completions` untuk client bergaya OpenAI dan `/v1/messages` untuk yang bergaya Anthropic. Streaming, tool call, dan gambar lewat apa adanya; kegagalan provider di tengah stream datang sebagai SSE error event, bukan koneksi yang putus.
- **Akun yang sudah kamu punya.** Sembilan driver mencakup OpenCode Zen (free tier), Qoder, Cline, Grok Web, OpenAI Codex, CodeBuddy (global dan CN), Google Antigravity, dan Claude Code. Masing-masing punya alur OAuth, refresh token, dan terjemahan protokol sendiri.
- **Key milik gateway, bukan milik provider.** API key gateway (`sr-live-...`) terpisah dari kredensial provider, dan tiap key punya rate-limit, kuota token, limit kredit, allowlist model, dan flag aktif sendiri. Yang disimpan hanya hash sha256 plus prefix tampilan, jadi key yang hilang diganti, bukan dipulihkan.
- **Kamu bisa lihat apa yang terjadi.** Setiap request dicatat ke SQLite: provider, model, jumlah token, latensi, status, dan estimasi biaya, dan dashboard menggambarnya live lewat SSE. Isi prompt dan completion tidak pernah disimpan.
- **Satu binary, satu file, tanpa service tambahan.** Server Rust/Axum, penyimpanan SQLite, tanpa Postgres, tanpa Redis, tanpa queue. `docker compose up -d` sudah cukup untuk instalasi.

## Mulai cepat

### Docker

```bash
git clone https://github.com/seaavey/SRouter.git
cd SRouter
SROUTER_ADMIN_PASSWORD='pilih-yang-panjang' docker compose up -d
```

Buka <http://localhost:3000>, masuk dengan password itu, sambungkan provider di halaman **Providers**, buat key di halaman **Keys**, lalu arahkan client ke `http://localhost:3000/v1`. Container menyajikan API dan dashboard di satu port, dan menyimpan database di `~/.srouter/srouter.db` (di-mount ke `/data`).

Ganti port yang dipublikasikan dengan `SROUTER_PORT` (`SROUTER_PORT=8080 docker compose up -d`). Tanpa Compose: `docker build -t srouter .` lalu `docker run -p 3000:3000 -v ~/.srouter:/data -e SROUTER_ADMIN_PASSWORD=... srouter`.

### Dari source

Butuh toolchain Rust stable (edition 2024, artinya 1.85 ke atas; `server/rust-toolchain.toml` sudah mem-pin channel-nya).

```bash
git clone https://github.com/seaavey/SRouter.git
cd SRouter
cargo run --manifest-path server/Cargo.toml
```

Server mendengarkan di <http://127.0.0.1:3000> dan menyimpan database di `~/.srouter/srouter.db`. Supaya dashboard disajikan dari proses yang sama, build sekali lalu arahkan `WEB_DIST_PATH` ke hasilnya:

```bash
cd client && bun install && bun run build && cd ..
WEB_DIST_PATH=client/dist cargo run --manifest-path server/Cargo.toml
```

### Run pertama

1. **Buat akun admin.** Buka `/login` di dashboard, atau `POST /v1/admin/setup` yang hanya menerima koneksi loopback. Mengisi `SROUTER_ADMIN_PASSWORD` sebelum boot juga bisa, dan selama variabel itu diisi, password-nya di-reset setiap kali boot.
2. **Sambungkan provider.** Qoder, Cline, Codex, CodeBuddy, Antigravity, dan Claude memulai alur OAuth dari dashboard; Grok Web menerima cookie atau token SSO; OpenCode Zen tidak butuh akun sama sekali.
3. **Buat API key gateway.** Secret lengkapnya (`sr-live-...`) hanya ditampilkan sekali, saat dibuat.
4. **Arahkan client ke gateway.** Base URL `http://127.0.0.1:3000/v1`, key di `Authorization: Bearer <key>` atau `x-api-key: <key>`.

Request dari loopback boleh tanpa key sampai kamu menyalakan setting `require_api_key`. Apa pun yang datang lewat jaringan selalu wajib membawa key.

## Menyambungkan client

OpenAI SDK:

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:3000/v1", api_key="sr-live-key-kamu")

response = client.chat.completions.create(
    model="antigravity/gemini-3.8-flash-high",
    messages=[{"role": "user", "content": "Halo!"}],
    stream=True,
)
```

Anthropic SDK, gateway yang sama:

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "http://127.0.0.1:3000/v1",
  apiKey: "sr-live-key-kamu",
});

const message = await client.messages.create({
  model: "claude/claude-sonnet-4-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Halo dari SRouter!" }],
});
```

curl:

```bash
curl -N http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sr-live-key-kamu" \
  -d '{"model": "opencode_zen/big-pickle", "messages": [{"role": "user", "content": "Halo!"}], "stream": true}'
```

Id model memakai format `provider/model`, jadi `antigravity/gemini-3.8-flash-high` dirutekan lewat driver Antigravity. Id polos juga jalan selama hanya satu provider yang mengiklankan model itu. `GET /v1/models` menunjukkan apa yang bisa dipakai saat itu, dan header `anthropic-version` diterima di route Anthropic.

## Provider

| Driver         | Auth               | Katalog                                                               |
| -------------- | ------------------ | --------------------------------------------------------------------- |
| `opencode_zen` | tidak ada          | statis, dengan gate tool FreeTier                                     |
| `qoder`        | device flow        | live `model/list`, dua nama yang diiklankan per model                 |
| `cline`        | WorkOS device flow | live `/api/v1/models`, hanya saat koneksi aktif                       |
| `grok-web`     | cookie / SSO       | hanya saat koneksi aktif                                              |
| `codebuddy`    | OAuth              | `product.json` dari paket resmi, digabung konfigurasi enterprise live |
| `codebuddy-cn` | OAuth              | driver yang sama, endpoint CN                                         |
| `antigravity`  | Google OAuth       | katalog CloudCode statis berisi 17 id                                 |
| `claude`       | OAuth              | snapshot live `GET {base}/models`                                     |
| `openai_codex` | ChatGPT OAuth      | live `GET /backend-api/codex/models`                                  |

`GET /v1/providers/catalog` menampilkan driver yang terdaftar; `GET /v1/providers` menampilkan koneksi beserta statusnya. Endpoint custom yang kompatibel OpenAI bisa ditambah, diverifikasi, dan dihapus dari API maupun dashboard.

## Konfigurasi

Semua pengaturan berupa environment variable, dan [`server/.env.example`](server/.env.example) memuat daftar lengkapnya. Yang perlu diketahui di hari pertama:

| Variable                                                           | Default                 | Fungsi                                                                                     |
| ------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------ |
| `PORT`                                                             | `3000`                  | Listener HTTP                                                                              |
| `DATABASE_PATH`                                                    | `~/.srouter/srouter.db` | File SQLite (image Docker memakai `/data/srouter.db`)                                      |
| `WEB_DIST_PATH`                                                    | tidak diisi             | Hasil build dashboard yang disajikan di `/`; kalau kosong, `GET /` menjawab objek info API |
| `SROUTER_ADMIN_PASSWORD`                                           | tidak diisi             | Membuat akun admin saat boot, dan mereset password-nya setiap boot selama diisi            |
| `SROUTER_PUBLIC_URL`                                               | tidak diisi             | Origin publik kanonik; nilai `https://` menyalakan secure cookie                           |
| `SROUTER_CORS_ORIGINS`                                             | tidak diisi             | Allowlist origin dipisah koma (origin loopback selalu diizinkan)                           |
| `SROUTER_SECURE_COOKIES`                                           | `false`                 | Menambahkan `Secure` pada cookie sesi admin                                                |
| `SROUTER_TRUST_CF_CONNECTING_IP`                                   | `false`                 | Mempercayai `cf-connecting-ip`; hanya kalau proxy Cloudflare satu-satunya pemanggil        |
| `SROUTER_UPSTREAM_CONCURRENCY`                                     | `100`                   | Batas request bersamaan ke upstream; saat penuh dijawab `429` sebelum memanggil vendor     |
| `SROUTER_ACCESS_LOG`                                               | `off`                   | Access log per request dengan query, header, dan body yang sudah diredaksi                 |
| `SROUTER_FILE_LOG`                                                 | `false`                 | Ikut menulis `logs/srouter-server.log`, bukan hanya stdout                                 |
| `RUST_LOG`                                                         | `info`                  | Level log                                                                                  |
| `BRAVE_API_KEY`, `TAVILY_API_KEY`, `SERPER_API_KEY`, `SEARXNG_URL` | tidak diisi             | Backend pencarian opsional untuk built-in search tool                                      |

`NODE_ENV` bukan saklar: production satu-satunya mode yang bisa boot, dan `development` ditolak. PostgreSQL juga ditolak dengan cara yang sama: `DATABASE_URL` yang diisi menghentikan proses saat boot, karena SQLite satu-satunya backend yang punya skema.

## API

| Method                        | Path                                                                                   | Guard                       | Fungsi                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------- |
| `GET`                         | `/v1`, `/health`                                                                       | tidak ada                   | Info API dan health check                                                 |
| `POST`                        | `/v1/chat/completions`, `/v1/chat`, `/v1/chat/completion`                              | API key + rate limit        | Chat kompatibel OpenAI, streaming atau buffered                           |
| `POST`                        | `/v1/messages`, `/v1/messages/count_tokens`                                            | API key + rate limit        | Messages kompatibel Anthropic dan hitung token                            |
| `POST`                        | `/v1/images/generations`                                                               | API key + rate limit        | Generasi gambar                                                           |
| `GET`                         | `/v1/models`, `/v1/models/{*model}`                                                    | API key                     | Katalog dengan allowlist, favorit, dan model tersembunyi sudah diterapkan |
| `GET`                         | `/v1/models/pricing`                                                                   | API key                     | Snapshot harga models.dev                                                 |
| `GET`                         | `/v1/quota` (alias `/v1/qouta`)                                                        | Sesi admin                  | Kuota provider                                                            |
| `GET`                         | `/v1/logs`, `/v1/logs/{id}`, `/v1/logs/stats`, `/v1/logs/analytics`, `/v1/logs/events` | Sesi admin                  | Log request, agregat, dan stream SSE                                      |
| `GET`                         | `/v1/providers`, `/v1/providers/catalog`, `/v1/providers/{id}`                         | Sesi admin                  | Koneksi, katalog, dan satu provider                                       |
| `GET`                         | `/v1/settings`                                                                         | API key                     | `require_api_key`                                                         |
| `POST` `PUT` `PATCH` `DELETE` | `/v1/models/{*model}`                                                                  | Sesi admin                  | Penulisan model                                                           |
| `PATCH`                       | `/v1/providers/{id}`, `/v1/providers/{id}/round-robin`                                 | Sesi admin                  | Penyuntingan provider dan rotasi akun                                     |
| `POST` `DELETE`               | `/v1/providers`, `/v1/providers/verify`, `/v1/providers/connections/verify`            | Sesi admin                  | Provider custom dan verifikasinya                                         |
| `GET` `POST`                  | `/v1/auth/{qoder,cline,codebuddy,codebuddy-cn,grok-web,openai,antigravity,claude}/...` | Sesi admin; callback publik | Login OAuth dan callback                                                  |
| `GET` `POST` `PATCH` `DELETE` | `/v1/keys`, `/v1/keys/{id}`, `/v1/keys/{id}/credit`                                    | Sesi admin                  | API key gateway, kuota, dan kredit                                        |
| `GET` `POST` `PATCH`          | `/v1/users`, `/v1/users/{id}`, `/v1/users/{id}/token`                                  | Sesi admin                  | Akun pelanggan dan token loginnya                                         |
| `POST`                        | `/v1/portal/login`                                                                     | tidak ada; dibatasi         | Masuk konsol dengan token pelanggan                                       |
| `GET` `POST`                  | `/v1/portal/{me,logs,logout}`                                                          | Sesi pelanggan              | Bacaan konsol pelanggan dan keluar                                        |
| `POST` `PATCH`                | `/v1/settings`                                                                         | Sesi admin                  | Penulisan settings                                                        |
| `GET` `POST`                  | `/v1/admin/{status,setup,login,logout,change-password}`                                | Per handler                 | Sesi admin                                                                |
| `GET` `POST`                  | `/v1/admin/database/{export,import}`                                                   | Sesi admin                  | Transfer database                                                         |

Error memakai envelope OpenAI: `{"error": {"message", "type", "code", "param"}}`. Alias kompatibilitas `/v1/v1/...` dan tabel guard per mount ada di [`skills/srouter-server/references/http-layer.md`](skills/srouter-server/references/http-layer.md).

## Dashboard

`client/` adalah aplikasi Bun + Vite + React 19: TanStack Router dan Query, Tailwind v4, shadcn di atas Base UI, plus kit komponen `arc/` lokal.

| Layar                                  | Kondisi                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `/login`                               | masuk dan setup pertama                                                                  |
| `/`                                    | overview: analytics per rentang waktu, event SSE live, rincian model dan provider        |
| `/providers`, `/providers/$providerId` | live: modal koneksi, health check, deteksi duplikat                                      |
| `/logs`                                | live: tabel berpaginasi, tail SSE, detail request di bottom sheet                        |
| `/usage`                               | live: kuota, biaya per model, rincian per periode                                        |
| `/keys`                                | live: buat, edit, kredit, allowlist model                                                |
| `/users`                               | live: daftar, buat, ganti nama, aktif/nonaktif, terbitkan ulang token login              |
| `/portal`                              | live: konsol pelanggan; masuk dengan token, key dan log request miliknya                 |
| `/settings`                            | masih mockup statis: tombol ganti password admin dan export database belum punya handler |

```bash
cd client
bun install
bun run dev        # http://localhost:5173, mem-proxy /v1 ke server
bun run build      # file statis untuk WEB_DIST_PATH
bun run typecheck
bun run lint
```

Di sisi client belum ada test runner; `typecheck`, `lint`, dan `build` adalah pemeriksaannya.

## Arsitektur

Dua bagian dalam satu repositori, hanya berbagi TypeScript hasil generate.

| Path                   | Isinya                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `server/`              | Gateway Rust/Axum: route, middleware, driver provider, store SQLite, suite integrasi                                |
| `client/`              | Dashboard operator                                                                                                  |
| `server/src/app.rs`    | Satu-satunya tempat router dirakit; guard dipasang per mount                                                        |
| `server/src/features/` | Satu direktori per fitur: gateway, providers, catalog, logs, api_keys, admin_auth, provider_auth, database_transfer |
| `server/migrations/`   | Riwayat skema, saat ini versi 4                                                                                     |
| `server/tests/`        | Suite integrasi, masing-masing dengan database sementara dan upstream palsu                                         |
| `skills/`              | Catatan mendalam untuk kerja di server dan client                                                                   |

Alur request: router → guard per mount → handler fitur → resolusi model → driver provider → upstream, dan jawabannya mengalir balik sebagai SSE. Tipe wire menurunkan `specta::Type` di Rust, dan `cargo run --bin export_ts` merendernya ke `server/bindings.ts` dan `client/src/generated/typed.ts`; ada test yang gagal kalau salah satunya berbeda dari hasil render baru.

## Development

```bash
cargo run --manifest-path server/Cargo.toml                              # jalankan
cargo test --manifest-path server/Cargo.toml --test chat_completions     # satu suite
cargo test --manifest-path server/Cargo.toml --locked                    # semuanya
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features --locked -- -D warnings
cargo run --manifest-path server/Cargo.toml --bin export_ts              # regenerate bindings
```

`make` membungkus perintah yang sama (`make check` = fmt + clippy + test), plus `make image`, `make up`, dan `make web`.

Test tidak pernah menyentuh database aslimu atau provider sungguhan: setiap suite membuat file SQLite sementara dan upstream palsu. Dua live probe (`opencode_live.rs`, `qoder_live.rs`) butuh jaringan dan di-ignore secara default; jalankan dengan `--ignored`. CI mengulang `fmt`, `clippy`, suite, dan pemeriksaan drift bindings pada push ke `main` dan pull request ke sana, tapi tetap jalankan suite-nya sendiri sebelum push.

Pesan commit mengikuti Conventional Commits (`feat:`, `fix:`, `docs:`, ...); detailnya di [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Deployment

`Dockerfile` membangun server dan dashboard menjadi satu image di atas `gcr.io/distroless/cc-debian12:nonroot`, dengan `HOME=/data`, `DATABASE_PATH=/data/srouter.db`, dan `WEB_DIST_PATH=/web`. `docker-compose.yml` menjalankan image itu sebagai satu service `srouter` dengan volume bernama.

- **Publikasi image:** Actions -> `docker-publish` -> _Run workflow_. Sengaja manual dan tidak pernah jalan sendiri saat push atau tag.
- **Backup:** `GET /v1/admin/database/export` (sesi admin) menulis salinan portabel, dan `POST /v1/admin/database/import` memulihkannya.
- **Berhenti dengan aman:** `docker compose down` menghentikan container dan menyimpan volume. `docker compose down -v` menghapus volume yang menyimpan database SQLite, artinya seluruh kredensial provider ikut hilang.
- **Upgrade:** tarik image baru lalu restart. Migrasi berjalan saat connect, dan skema yang lebih baru dari yang dipahami binary akan ditolak, jadi downgrade butuh backup dari sebelum upgrade.

## Troubleshooting

| Gejala                                          | Penyebab                                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET /` menjawab JSON, bukan dashboard          | `WEB_DIST_PATH` kosong, atau menunjuk direktori yang tidak ada                                             |
| `.env` seolah diabaikan                         | `dotenvy` membacanya dari current working directory; jalankan dengan cwd `server/` atau export variabelnya |
| Proses keluar saat boot dan menyebut PostgreSQL | `DATABASE_URL` terisi; hapus dan pakai `DATABASE_PATH`                                                     |
| `401` dengan `code=api_key_disabled`            | Key-nya ada tapi dinonaktifkan; aktifkan dari dashboard atau `PATCH /v1/keys/{id}`                         |
| `429` pada request yang tadinya normal          | Rate-limit key, kuota tokennya, atau batas `SROUTER_UPSTREAM_CONCURRENCY`                                  |
| Tidak bisa masuk akun admin                     | Boot sekali dengan `SROUTER_ADMIN_PASSWORD` terisi; selama diisi, password-nya di-reset                    |
| Koneksi provider putus setelah beberapa saat    | Token OAuth di-refresh di background; sambungkan ulang akunnya kalau vendor mencabut grant                 |

## Keamanan

Kredensial provider tersimpan polos di dalam file SQLite, jadi perlakukan file itu seperti `.env`: hanya boleh dibaca user service, dan jangan masuk backup bersama. API key gateway disimpan sebagai hash sha256 plus prefix dan tidak bisa dipulihkan. Log request hanya menyimpan metadata, tanpa teks prompt atau completion. Untuk melaporkan kerentanan, pakai kanal privat di [`SECURITY.md`](SECURITY.md), bukan issue publik.

## Benchmark

Tiga gateway, satu host, generator beban yang sama, dijalankan bergantian: server ini, `9router@0.5.104`, dan `omniroute@3.8.51`. Masing-masing diukur di route termurah yang bisa diakses tanpa kredensial (`/health` di sini, `/api/health` di dua gateway Node), 20 detik pada konkurensi 50, dengan RSS dijumlahkan untuk seluruh pohon proses.

| | SRouter | 9Router | OmniRoute |
| --- | --- | --- | --- |
| Runtime | Rust/Axum | Next.js 16 di Node | Next.js di Node |
| Ukuran terkirim | 25,4 MB binary | 76 MB paket npm | 2,8 GB paket npm |
| Cold start | 0,06-0,12 s | 3,1-3,5 s | 9,3-12,5 s |
| RSS idle | 15-17 MB | 131 MB | 424 MB |
| RSS setelah load | 19-22 MB | 487 MB | 824 MB |
| Throughput | 8.675 req/s | 525 req/s | 354 req/s |
| p50 / p95 | 5,5 / 8,5 ms | 86 / 147 ms | 123 / 206 ms |

Bacalah ini sebagai overhead gateway, bukan kecepatan chat: tidak ada kredensial provider yang dipasang di ketiganya, jadi setiap request berhenti di gateway dan tidak pernah mencapai upstream. Route-nya juga bukan kerja yang identik, karena `/health` di sini mengembalikan body statis sementara health kedua gateway Node melewati framework web mereka. Baris katalog lebih setara: `/v1/models` menjawab 785 byte di sini, sedangkan 9Router 317 KB (824 model) dan turun ke 5,2 req/s pada konkurensi 10, sementara di sini 1.713 req/s.

Diukur 17 Oktober 2026 di satu host 4 vCPU, bergantian, dengan generator Node keep-alive 50 worker selama 20 detik per run. Harness di dalam repo (`server/src/benchmark/`) mengukur throughput gateway pada beban chat campuran dan bukan yang menghasilkan tabel ini.

## Status proyek

Repositori ini dipangkas menjadi server Rust dan dashboard pada Oktober 2026: `apps/api` Node yang jadi sumber port server, tujuh package workspace `packages/*`, CLI, dan situs dokumentasi sudah tidak ada. Kode lamanya masih bisa dibaca di branch `backup/pre-apps-api-removal` dan `backup/pre-packages-removal`.

Server mengimplementasikan kontrak yang dulu didefinisikan API Node; dashboard masih melengkapi layarnya (lihat [Dashboard](#dashboard)). Belum ada release bertag untuk crate saat ini: tag terakhir, `v0.1.8`, milik era Node.

## Lisensi

[MIT](LICENSE)

---

Kerja pakai AI agent? [`llms.txt`](llms.txt) berisi ringkasan ringkas yang mudah dibaca mesin, [`AGENTS.md`](AGENTS.md) memuat aturan kontribusi, dan [`skills/`](skills/) berisi catatan mendalamnya.
