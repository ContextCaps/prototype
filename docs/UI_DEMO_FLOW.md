# ContextCaps — UI Demo Flow Brief

Dokumen ini adalah konteks lengkap untuk memperbaiki UI `apps/web/` tanpa mengubah aturan policy, kontrak Monad, shared types, atau endpoint Broker. Berikan dokumen ini kepada GPT bersama screenshot UI saat ini dan minta perbaikan hanya pada frontend.

## 1. Satu Kalimat Produk

> ContextCaps membuat AI menerima jawaban minimum yang diperlukan untuk menyelesaikan tugas, bukan seluruh data privat yang dimintanya.

Produk ini **bukan** dashboard blockchain generik. Yang harus paling mudah dipahami juri adalah batas kepercayaan:

```text
User memberi tujuan terbatas
        ↓
Agent meminta konteks
        ↓
Broker policy memutuskan DENY / DERIVE / SELECT / TOOL_BOUND
        ↓
Agent menerima fakta minimum atau ditolak
        ↓
User dapat mencabut semua akses kapan saja
```

Contoh tugas yang selalu dipakai pada demo:

```text
Book my Singapore trip next weekend under $700.
```

## 2. Tujuan UI

Dalam kurang dari dua menit, juri harus mengerti lima hal berikut:

1. User hanya mengizinkan **tujuan** perjalanan, bukan menyerahkan seluruh vault data.
2. Agent yang terlalu ingin tahu atau terkena prompt injection tetap tidak dapat membaca data mentah.
3. Broker dapat memberi fakta turunan yang cukup untuk menyelesaikan tugas, seperti `passport.validity = true`.
4. Sub-agent mendapatkan izin yang lebih sempit daripada parent agent.
5. Revocation menghentikan akses berikutnya, termasuk akses child capability.

## 3. Batas Scope

### Yang nyata pada flow

- Web memanggil Broker API; allow/deny tidak ditentukan oleh state frontend.
- Policy engine mengevaluasi setiap request context.
- Delegation, checkout handle, receipt, dan revocation diputuskan Broker.
- Bila Broker berjalan dengan `CHAIN_PROVIDER=monad`, lifecycle capability mengikuti Monad Testnet.
- Pada `PRINCIPAL_SIGNING=wallet`, user memakai MetaMask untuk menandatangani authorization dan revocation root capability.

### Yang mock pada demo lokal

- Broker lokal saat ini berjalan dengan `CHAIN_PROVIDER=mock`.
- Hotel booking connector adalah mock: ia menghasilkan booking reference, bukan membeli hotel sungguhan.
- Seed data adalah fixture demo, bukan data pribadi real.

Kalimat aman untuk UI/demo:

> “The policy and broker decisions are real. The hotel merchant is a demo connector, so no real payment is made.”

Jangan menyebut seluruh produk “mock” hanya karena memakai testnet atau demo booking connector.

## 4. Setup dan Mode

### Local demo saat ini

```text
Web:        http://localhost:5173/
Broker API: http://127.0.0.1:8787/api/v1
```

`GET /health` menentukan badge mode yang harus terlihat di UI:

```ts
{
  ok: true,
  provider: "mock" | "monad",
  principalSigning: "server" | "wallet",
  llmPlanner: "available" | "unavailable"
}
```

Makna mode:

| Kondisi | Arti UI |
|---|---|
| `provider: mock` | Tampilkan “Local demo” atau “Mock trust layer”. Jangan tampilkan explorer link seolah-olah itu transaksi publik. |
| `provider: monad` | Tampilkan “Monad Testnet”. Receipt/lifecycle yang memiliki hash transaksi boleh diberi explorer link. |
| `principalSigning: server` | Tombol cukup bertuliskan **Authorize task** dan **Revoke access**. Ini mode lokal/script. |
| `principalSigning: wallet` | Minta koneksi MetaMask. Tombol bertuliskan **Authorize on Monad**; UI perlu state “Confirm in wallet”, “Waiting for Monad”, lalu “Broker is verifying on-chain”. |
| `llmPlanner: unavailable` | Sembunyikan pilihan GPT dan gunakan **Scripted agent**. |
| `llmPlanner: available` | Boleh tampilkan switch **Scripted agent** / **Real AI (GPT)**. Tetap jelaskan: model memilih request, Broker yang menentukan jawaban. |

## 5. Golden Flow yang Harus Terlihat

UI sekarang memakai lima tahap vertikal. Jangan ubah urutan mental ini; boleh ubah tata letak, visual hierarchy, copy, animasi, dan micro-interaction.

### Tahap 1 — Authorize the task

**Aksi user:** menekan tombol authorize untuk tugas Singapore di bawah $700.

**Makna:** user menciptakan satu capability untuk Travel Agent. Capability selalu purpose-bound, agent-bound, dan time-bound.

**Preview yang harus terlihat sebelum authorize:**

| Agent may receive | Agent must never receive |
|---|---|
| Passport eligibility / validity | Raw passport number, image, DOB |
| Available travel window | Full calendar and meeting titles |
| Hotel preferences | Salary |
| Opaque checkout handles | Raw payment credential |

**Hasil sukses:** tampilkan capability status `ACTIVE`, capability ID yang dipendekkan, purpose, destination, budget, dan bila ada transaction proof.

**Pesan yang harus ditanamkan:**

> “This authorizes a purpose, not a data dump.”

### Tahap 2 — Agent activity

**Aksi user:** klik **Run Travel Agent**.

Scripted agent memang sengaja meminta lebih dari yang diperlukan agar proteksi dapat didemokan. Ini bukan bug.

Urutan event yang ideal untuk timeline:

| Urutan | Permintaan / event | Keputusan | Penjelasan singkat untuk UI |
|---:|---|---|---|
| 1 | `passport.raw` | `DENY`, `RAW_DISCLOSURE_FORBIDDEN` | Agent asked for the record; the task only needs eligibility. |
| 2 | `passport.validity` + trip parameters | `DERIVE`, `ALLOW_DERIVED` | Tampilkan hanya `Valid for this trip: yes`. |
| 3 | `calendar.raw` | `DENY`, `RAW_DISCLOSURE_FORBIDDEN` | Do not expose meeting details. |
| 4 | `calendar.availability` | `DERIVE`, `ALLOW_DERIVED` | Tampilkan only available window, not calendar content. |
| 5 | Agent membaca public/untrusted page | Untrusted-content event | Beri warning label: page content is data, not instructions. |
| 6 | Prompt injection mencoba meminta `salary.raw` | `DENY`, `OUT_OF_SCOPE` | “The request is unrelated to booking a trip.” |

**Visual hierarchy untuk setiap row:**

```text
[Travel Agent] requested  passport.raw
BLOCKED  ·  Raw disclosure forbidden
Why? The authorized task needs an answer, not the document.
```

Untuk allow:

```text
[Travel Agent] requested  passport.validity
DERIVED  ·  Valid for this trip: yes
Only the derived answer was released.
```

Jangan gunakan istilah seperti “model was hacked” atau memberi kesan prompt injection berhasil. Justru yang harus terlihat adalah **model boleh salah, tetapi policy boundary tetap menahan dampaknya**.

### Tahap 3 — Delegate and check out

Bagian ini terdiri dari dua pesan yang berbeda tetapi saling berhubungan.

#### 3A. Delegation attenuation

Travel Agent membuat child capability untuk Hotel Agent.

```text
Travel Agent (root capability)
├─ passport validity      · DERIVE · not delegable
├─ calendar availability  · DERIVE · delegable
├─ hotel preferences      · SELECT · delegable
├─ legal name             · TOOL_BOUND · not delegable
└─ payment handle         · TOOL_BOUND · not delegable

Hotel Agent (child capability)
├─ calendar availability  · DERIVE
└─ hotel preferences      · SELECT
```

UI harus menunjukkan bahwa child tidak menerima passport, identity, salary, atau payment permission. Gunakan diagram parent → child sederhana; jangan jadikan graph blockchain yang padat.

#### 3B. Tool-bound checkout

Saat booking, Travel Agent meminta dua handle:

```text
profile.legal_name  → opaque handle
payment.handle      → opaque handle
```

Agent melihat token seperti `tbh_…`, bukan nama atau payment token. Broker mengirim secret langsung ke approved booking connector. Connector hanya mengembalikan data allowlisted:

```text
Booking status: CONFIRMED
Booking reference: CC-DEMO-001
Hotel / date / amount: safe booking data
```

**Aturan visual:**

- Handle boleh ditampilkan dalam bentuk pendek.
- Nama asli, token pembayaran, passport number, salary, raw calendar, atau detail request rahasia tidak boleh pernah masuk UI.
- Jangan menyebut handle sebagai “encrypted credit card”; sebut **protected booking credential** atau **opaque handle**.

### Tahap 4 — Revoke access

**Aksi user:** klik **Revoke access**.

**Hasil yang harus tampak:**

```text
Root capability:  ACTIVE  →  REVOKED
Hotel Agent child: ACTIVE  →  REVOKED (inherited)
```

Setelah revocation sukses, tampilkan tombol **Try request after revoke** atau **Retry after revoke**.

**Hasil retry yang wajib:**

```text
BLOCKED
CAPABILITY_REVOKED
Access was revoked by the user.
```

Ini adalah klimaks demo. Buat transisi status ini sangat jelas dan cukup dramatis, tetapi bukan animasi yang menghalangi pemahaman.

### Tahap 5 — Audit and proof

Receipt adalah bukti keputusan tanpa membocorkan data privat.

Untuk setiap row audit, tampilkan ringkas:

```text
time · agent · resource · decision · human-readable reason · View proof
```

`View proof` boleh expandable dan menampilkan:

- receipt ID;
- capability ID;
- resource and operation;
- reason code;
- request hash;
- result commitment;
- anchor transaction link bila provider adalah Monad dan hash tersedia.

Jelaskan dengan copy pendek:

> “Proof contains hashes and commitments, never the passport, calendar, salary, or payment token.”

## 6. Bahasa yang Dipakai UI

Gunakan bahasa natural terlebih dahulu; tampilkan reason code teknis sebagai informasi sekunder.

| Kode / mode | Copy utama yang direkomendasikan |
|---|---|
| `DENY` | **Blocked** |
| `RAW_DISCLOSURE_FORBIDDEN` | Raw personal data is never released. |
| `OUT_OF_SCOPE` | This request is outside the authorized trip. |
| `DERIVE` | **Derived answer** |
| `SELECT` | **Approved preferences** |
| `TOOL_BOUND` | **Protected tool credential** |
| `CAPABILITY_REVOKED` | Access was revoked by the user. |
| `DELEGATION_NOT_ALLOWED` | The child agent cannot receive that permission. |
| `DERIVATION_QUOTA_EXCEEDED` | Too many distinct questions for this private fact. |

Tampilkan mode dan reason code tetap apa adanya untuk proof/audit, tetapi jangan membuat pengguna harus memahami kode untuk mengerti hasilnya.

## 7. API Contract yang Relevan untuk UI

Frontend adalah principal-side client. Ia **tidak** memanggil endpoint agent berikut secara langsung:

```text
/context/request
/delegations
/tools/:toolId/invoke
```

Session token root tidak boleh disimpan di browser. Broker menjalankan agent server-side melalui `POST /agent/runs`.

| Interaksi UI | Endpoint | Dampak UI |
|---|---|---|
| Check mode | `GET /health` | Badge broker, wallet mode, pilihan GPT. |
| Authorize | `POST /mandates` | Server mode langsung `ACTIVE`; wallet mode mengembalikan `AWAITING_SIGNATURE`. |
| Confirm wallet authorization | `POST /mandates/:id/confirm` | Jangan unlock activity sampai Broker mengonfirmasi state chain. |
| Run flow | `POST /agent/runs` | Render trace persis dari respons Broker. |
| Read proof/state | `GET /capabilities/:id`, `GET /audit?mandateId=…` | Render capability, child capability, dan receipts. |
| Prepare wallet revoke | `POST /capabilities/:id/revoke/prepare` | Mintalah user menandatangani transaksi. |
| Confirm revoke | `POST /capabilities/:id/revoke` | Refresh state root + child + audit. |
| Retry after revoke | `POST /agent/runs` dengan `scenario: "retry"` | Tampilkan `CAPABILITY_REVOKED`. |
| Reset | `POST /demo/reset` | Bersihkan state UI. |

## 8. State, Loading, dan Error

### State progresif

Sebelum user authorize, Tahap 2–4 tetap tampak tetapi terkunci. Jangan hilangkan; beri penjelasan aksi yang dibutuhkan untuk membuka tahap tersebut.

```text
No mandate → activity locked
Authorized → activity can run
Run complete → delegation, checkout, revoke unlocked
Revoked → retry action unlocked
```

### Loading yang perlu jelas

- Authorize: `Authorizing…`
- LLM: `Model thinking…`
- Scripted flow: `Agent working…`
- Wallet: `Confirm in your wallet…` → `Waiting for Monad…` → `Broker is verifying on-chain…`
- Revoke: `Revoking…`
- Reset: `Resetting…`

### Error yang perlu manusia pahami

- Broker offline: “Cannot reach the ContextCaps broker. Is it running?”
- Wallet belum terhubung: “Connect your wallet first.”
- Wallet tidak ada: “Install MetaMask to authorize on Monad.”
- LLM tidak aktif: jangan tunjukkan pilihan GPT.
- API error: tampilkan pesan ringkas tanpa memunculkan request body, session token, atau secret.

## 9. Visual Direction

### Prioritas

```text
clear task story
visible trust boundary
decision contrast: blocked vs minimum disclosure
progressive disclosure of technical proof
fast, reliable demo interaction
```

### Hindari

```text
generic blockchain admin dashboard
wallet / wallet balance UI yang tidak penting
many tabs or a complex graph
raw JSON as the primary content
wall of security jargon
red errors for ordinary locked future steps
fake frontend-only decision states
```

### Gaya yang dianjurkan

- Satu halaman guided story dengan milestone/stepper yang jelas.
- Hijau atau teal untuk disclosure minimum yang diizinkan.
- Merah/rose untuk blocked/revoked, dengan reason yang singkat.
- Violet/indigo netral untuk capability dan proof.
- Gunakan chips agent: **Travel Agent** dan **Hotel Agent**.
- Fokuskan perhatian pada row `passport.raw` blocked, `passport.validity` derived, `salary.raw` blocked, checkout handle, lalu revocation/retry.
- Di mobile, pertahankan urutan tahap, bukan grid padat.
- Semua state penting harus terbaca tanpa bergantung pada warna saja.

## 10. Acceptance Checklist untuk Perbaikan UI

Perbaikan UI selesai bila semua hal ini benar:

- [ ] Dalam lima detik, user memahami tugas trip dan janji privasi produk.
- [ ] User dapat melihat secara eksplisit perbedaan raw data dan derived answer.
- [ ] `passport.raw`, `calendar.raw`, dan `salary.raw` tampil sebagai blocked dari trace Broker.
- [ ] `passport.validity` dan `calendar.availability` tampil sebagai minimum disclosure, bukan data mentah.
- [ ] Delegation Travel Agent → Hotel Agent memperlihatkan permission child yang lebih sempit.
- [ ] Checkout menunjukkan opaque handles dan booking confirmation, tanpa secret.
- [ ] Revocation menunjukkan root dan child menjadi revoked.
- [ ] Retry setelah revoke terlihat gagal dengan `CAPABILITY_REVOKED`.
- [ ] Audit/proof bisa dibuka tanpa memenuhi halaman utama dengan hash.
- [ ] Mode mock versus Monad tidak menyesatkan user.
- [ ] Tidak ada decision security yang dibuat dari state frontend.
- [ ] Layout responsif dan keyboard-accessible.

## 11. Narasi Demo 90 Detik

Gunakan narasi ini saat merekam atau mempresentasikan:

1. **0–15 detik:** “I authorize a travel task, not my entire private profile.”
2. **15–30 detik:** “The agent asks for my raw passport. ContextCaps blocks it because the task needs eligibility, not the document.”
3. **30–45 detik:** “It asks the narrower question instead. The broker releases only that the passport is valid and a travel window is available.”
4. **45–60 detik:** “An untrusted page tries to make the agent request salary data. The broker blocks that request as outside the task.”
5. **60–75 detik:** “The hotel sub-agent receives only calendar availability and hotel preferences. It never gets passport or payment permission.”
6. **75–90 detik:** “Checkout receives opaque handles, not credentials. I can revoke the root capability, and the next request from both agents fails immediately.”

Penutup:

> “Give AI agents the answer they need, not the data they asked for.”

## 12. Prompt Siap Pakai untuk GPT UI

Salin prompt berikut bersama dokumen ini dan screenshot UI saat ini:

```text
You are improving the React/Vite frontend for ContextCaps. Read the attached UI demo flow brief as the source of truth. Improve only files under apps/web/ unless a frontend type import genuinely requires another file.

Do not change broker APIs, capability semantics, shared types, policy decisions, contract behavior, or security reason codes. The UI must render real broker responses and must never fake allow/deny/revoke state in frontend state.

Redesign the existing one-page demo for a judge who has never seen ContextCaps. Preserve the five-step story: authorize task, agent activity, delegation and tool-bound checkout, revoke and retry, audit proof. Make blocked raw-data requests and allowed minimum disclosures immediately understandable. Keep proof technical details progressive/expandable. Do not display secrets, session tokens, raw passport/calendar/salary/payment data, or generic blockchain-dashboard clutter.

Return a concrete implementation plan first, then implement the UI changes. Keep it responsive, keyboard-accessible, and compatible with mock mode and Monad wallet mode.
```
