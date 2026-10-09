# Midnight Minter — thiết kế

Ngày: 2026-10-09 · Trạng thái: chờ anh duyệt spec

## 1. Mục tiêu

Một app **chạy local** trên máy anh để:

1. Tạo nhiều ví Midnight chỉ bằng một nút (tự sinh seedphrase, tự xin tNIGHT, tự sinh DUST).
2. Với mỗi ví, deploy **một smart contract riêng** và mint **X token cố định** (số lượng nhập lúc mint). Mỗi ví là một loại token khác nhau (khác ID).
3. Mọi field của token đều bắt buộc và hiển thị đủ: name, symbol, decimals, số lượng, ảnh (upload IPFS).
4. Màn quản lý ví: bấm vào ví nào thì hiện token của ví đó.

Mục đích sử dụng: mint token để bán trên các sàn khác, nên token là **unshielded** (số dư công khai, sàn đọc được).

**Mạng:** mặc định trong code là preprod, nhưng **mạng dùng được hiện nay là preview** (`NETWORK=preview`, không sửa code). Đo thật: đồng bộ ví preprod chạy 40 phút rồi lỗi `Wallet.Sync` (khoảng 1,5 triệu event), lặp lại nhiều lần nên preprod tạm thời không dùng được. Trên preview mỗi ví mới cần khoảng 17–20 phút đồng bộ ban đầu (~263.000 event, ~220–250 event/giây), chạy tuần tự nên N ví mất cỡ N × 20 phút.

**Ngoài phạm vi (YAGNI):** bán/giao dịch token trên sàn, chuyển token giữa các ví, shielded token, mainnet (mainnet cần NIGHT thật và đăng ký DUST qua Cardano, mất khoảng 12 giờ), đăng nhập nhiều người dùng.

## 2. Kiến trúc

```
Trình duyệt (React + Vite, localhost:5173)
        │  REST + SSE (tiến trình)
Backend Node 22 + TypeScript (localhost:8787)
   ├─ wallet-service   tạo ví, sync, DUST, số dư
   ├─ mint-service     deploy contract + mint
   ├─ queue            hàng đợi tuần tự, lưu trạng thái trong DB
   ├─ ipfs-service     upload ảnh + metadata lên Pinata
   └─ store            SQLite, seed mã hóa
        │
   ├─ Proof server (Docker midnightntwrk/proof-server:8.0.3, cổng 6300)
   ├─ Indexer + Node RPC (Blockfrost preprod / indexer.preview.midnight.network)
   └─ Faucet (nethermind) — chỉ người dùng xin tay cho ví tổng (có captcha)
```

Thư mục: `contracts/` (Compact), `server/`, `web/`, `data/` (SQLite, git-ignore), `docs/`.

Backend chạy mọi thứ liên quan đến ví vì sync nặng và cần proof server; trình duyệt không giữ seed.

### Cấu hình mạng

Mỗi mạng là một khối cấu hình (indexer HTTP/WS, node RPC, proof server, faucet, network id). Chọn bằng biến `NETWORK`.
Khóa nằm trong `.env`, không bao giờ vào code hay git: `BLOCKFROST_PROJECT_ID`, `PINATA_JWT` (và cặp key/secret dự phòng).

### Phiên bản ghim (đã cài thử và chạy thật 2026-10-09)

Dùng `@midnightntwrk/wallet-sdk@1.2.0` (gói tổng) cùng `@midnight-ntwrk/midnight-js-*@4.1.1`. npm tự kéo về bộ khớp bảng tương thích: facade 4.1.0, `compact-runtime` 0.16.0, `ledger-v8` 8.1.0. **Không** dùng `@midnight-ntwrk/wallet-sdk-facade@4.0.1` (phụ thuộc gói `ledger-v9` chưa tồn tại, không cài được).

| Thành phần | Phiên bản |
|---|---|
| Wallet SDK | `@midnightntwrk/wallet-sdk` 1.2.0 |
| midnight-js | 4.1.1 |
| ledger-v8 / compact-runtime | 8.1.0 / 0.16.0 (do npm tự kéo) |
| Compact compiler | 0.31.1 (đã có sẵn trong WSL Ubuntu của máy anh, CLI 0.5.2) |
| Proof server | `midnightntwrk/proof-server:8.0.3` (phải khớp ledger-v8) |

**Compiler chạy trong WSL.** Lệnh `compact` trên Windows trỏ tới `C:\Windows\System32\compact.exe` (công cụ nén NTFS), không phải compiler Compact. Script biên dịch gọi `wsl -d Ubuntu -- compact compile +0.31.1 ...`. Thư mục sinh ra (`managed/`) là ES module, nên `package.json` gốc phải có `"type": "module"`.

## 3. Vòng đời ví

Trạng thái ví lưu trong DB, mỗi bước chạy lại độc lập được:

`created → funding → syncing → dust_pending → ready` (hoặc `failed(step, lỗi)`)

1. **created:** sinh mnemonic BIP-39 24 từ, seed 64 byte (`mnemonicToSeed`), tính 3 khóa (unshielded, shielded, dust) theo `m/44'/2400'/account'/role/index`. Seed 64 byte cho cùng địa chỉ với Lace/1AM khi nhập cùng mnemonic.
2. **funding:** **ví tổng chuyển tNIGHT cho ví con** (mặc định 100 tNIGHT, chỉnh được), chờ số dư NIGHT > 0.

**Ví tổng (treasury) và faucet.** Faucet của Midnight bắt buộc token captcha Cloudflare Turnstile (header `X-Captcha-Token`), nên app **không gọi faucet tự động và không vượt captcha**. Thay vào đó:
- Ví tổng là một ví thường, đánh dấu `kind = treasury`.
- Anh xin faucet bằng tay vào địa chỉ ví tổng (app hiển thị địa chỉ, nút sao chép và liên kết mở trang faucet); mỗi lần được 1000 tNIGHT. App tự phát hiện tiền về.
- Từ đó, mọi ví con được cấp tNIGHT tự động bằng giao dịch chuyển từ ví tổng. 1000 tNIGHT đủ cho khoảng 10 ví con ở mức 100 tNIGHT mỗi ví; cần thêm thì xin faucet lần nữa.
- Ví tổng cũng đăng ký DUST như ví thường để trả phí chuyển.
3. **syncing:** chờ ví sync. Preprod hiện không đồng bộ nổi (lỗi `Wallet.Sync` sau ~40 phút), nên dùng preview; ở đó mỗi ví mới mất ~20 phút. Bước bootstrap riêng chưa làm.
4. **dust_pending:** chờ DUST sinh đủ để trả phí đăng ký, rồi `registerNightUtxosForDustGeneration` → `finalizeRecipe` → `submitTransaction`, chờ DUST > 0.
5. **ready.**

Mỗi bước lỗi có nút **Thử lại đúng bước đó**. Tạo N ví thì vào hàng đợi và chạy tuần tự. Nếu ví tổng không đủ tNIGHT thì ví con chuyển `failed(funding)` kèm hướng dẫn xin thêm faucet cho ví tổng, rồi bấm thử lại.

**Seed:** mã hóa AES-256-GCM, khóa sinh từ mật khẩu chủ bằng scrypt. Mật khẩu chủ nhập khi mở app, giữ trong bộ nhớ của tiến trình. Có chức năng xem/xuất seedphrase (yêu cầu nhập lại mật khẩu) và xuất toàn bộ để backup.

## 4. Contract (Compact), mỗi ví một bản

Ngôn ngữ: Compact (pragma 0.23, theo bản tutorial token unshielded), biên dịch bằng toolchain 0.31.x.

**Ledger (đọc công khai):**
`owner: Bytes<32>`, `token_color: Bytes<32>`, `name`, `symbol`, `decimals`, `image_uri`, `image_sha256`, `minted: Boolean`.

**Constructor** nhận khóa chủ và toàn bộ metadata, ghi vào ledger. Nhờ vậy token không thể thiếu field.

**Circuit `mint(sk, amount)`:**
- chỉ chủ gọi được (kiểm tra băm khóa);
- chỉ mint **một lần** (`assert(!minted)`), đúng yêu cầu "X cố định";
- `mintUnshieldedToken(domain, amount, recipient)` với recipient là địa chỉ unshielded của ví;
- ghi `token_color`, đặt `minted = true`.

**Domain separator:** nhãn cố định `minter:token:v1` (không kèm symbol). Tính duy nhất của màu token đến từ địa chỉ contract: mỗi ví một contract nên màu token khác nhau.

**Metadata:** toàn bộ field (name, symbol, decimals, image URI, SHA-256 ảnh, số lượng đã mint, màu token) nằm trong ledger công khai của contract; giao diện đọc trực tiếp từ đó. **Phát event theo chuẩn MIP-0018** (để indexer/sàn tự đọc, mỗi giá trị tối đa 219 byte) **để làm sau**: chuẩn còn là bản nháp và em chưa đọc được API module tham chiếu (repo `midnight-experiments/mip-0018`), nên không đưa vào bản đầu để khỏi code theo phỏng đoán.

## 5. Luồng Mint

**Form mẫu (mọi field bắt buộc, chặn ở giao diện và backend):**

| Field | Quy tắc |
|---|---|
| Name | 1–64 ký tự |
| Symbol | 1–12 ký tự, chữ/số in hoa |
| Decimals | số nguyên 0–18 |
| Số lượng X | số nguyên dương, tối đa Uint<64> |
| Ảnh | PNG/JPG/WEBP, giới hạn dung lượng, có xem trước |

**Chọn nhiều ví:** name và symbol sinh theo mẫu có `{n}` (ví dụ `Papa Coin #{n}` / `PAPA{n}`), hiển thị bảng xem trước và sửa tay được từng ví. Decimals, số lượng X và ảnh dùng chung cho cả lô. Nhập CSV bị bỏ khỏi bản đầu (bảng sửa tay đã đủ dùng).

**Mỗi ví chạy tuần tự trong hàng đợi (các ví không chạy song song):**

1. Upload ảnh lên IPFS qua Pinata (JWT trong `.env`), tính SHA-256; URL = `ipfs://CID` kèm gateway HTTPS để hiển thị.
2. Deploy contract (ví trả phí bằng DUST của mình).
3. Chờ xác nhận, gọi `mint`.
4. Đọc lại ledger và số dư để xác minh, lưu token vào DB.

Mỗi bước ghi trạng thái, địa chỉ contract, màu token và tx hash; tắt app giữa chừng thì tiếp tục từ bước dở.

Ví không đủ DUST thì bị chặn trước khi chạy, kèm lý do.

## 6. Giao diện

- **Bố cục 2 cột.** Trái: danh sách ví (địa chỉ rút gọn, trạng thái, NIGHT, DUST, số token) với nút "Tạo ví" và "Tạo N ví". Phải: chi tiết ví đang chọn.
- **Chi tiết ví:** địa chỉ đầy đủ có nút sao chép, xem seedphrase (cần mật khẩu), số dư NIGHT/DUST và **danh sách token của ví đó** (ảnh, name, symbol, decimals, số lượng, màu token, địa chỉ contract, liên kết tx). Token thiếu field nào thì đánh dấu rõ, không để trống im lặng.
- **Tab Mint:** form mẫu, bảng chọn ví, bảng tiến trình theo từng ví và từng bước.
- Tiến trình cập nhật trực tiếp qua SSE. Có giao diện sáng/tối, dùng tốt ở màn hình laptop.
- Lúc làm UI sẽ áp dụng skill thiết kế giao diện để không ra mẫu mặc định.

## 7. Lỗi và kiểm thử

**Lỗi:** mọi bước có timeout và thử lại có giới hạn. Lỗi hiện cho người dùng bằng tiếng Việt kèm bước đang lỗi. Lỗi tạm (mạng, indexer) tự thử lại; lỗi nghiệp vụ (thiếu DUST, metadata sai) dừng và báo.

**Kiểm thử:**
- Unit: mã hóa/giải mã seed, validate metadata, sinh name/symbol, đổi trạng thái ví.
- Contract: kiểm thử circuit bằng bộ mô phỏng của Compact (chỉ chủ mint được, mint hai lần bị từ chối, metadata đọc lại đúng).
- End-to-end trên mạng thật: tạo ví → tNIGHT → DUST → upload ảnh → deploy → mint → đọc lại trên giao diện. Nghiệm thu bằng một ví thật mint thành công.

## 8. Rủi ro đã biết

| Rủi ro | Cách xử lý |
|---|---|
| Sync ví preprod lỗi `Wallet.Sync` sau ~40 phút (đã đo) | Dùng `NETWORK=preview`. Chi phí còn lại: ~20 phút đồng bộ mỗi ví mới, và ví bị đóng/khởi động lại app phải đồng bộ lại (lưu state ví để tránh việc này mới là kế hoạch, chưa có) |
| Faucet có captcha và giới hạn tần suất | Không tự động hóa faucet; xin tay một lần cho ví tổng rồi app chia cho ví con |
| Phiên bản SDK lệch nhau | Đã ghim bộ cài thử được (mục 2); khóa bằng `package-lock.json` |
| Sàn khác không hiển thị đủ field | Ngoài tầm kiểm soát; metadata vẫn nằm trên chuỗi theo MIP-0018 |
| tNIGHT không có giá trị | Token trên preprod/preview chỉ để thử nghiệm, chưa bán được tiền thật; chuyển mainnet là một giai đoạn riêng |

## 9. Bảo mật

- `.env` và `data/` bị git-ignore. Khóa Blockfrost và Pinata chỉ nằm trong `.env`, không đưa vào frontend.
- Backend chỉ lắng nghe `127.0.0.1`.
- Khóa Pinata và Blockfrost đã được dán vào cuộc trò chuyện; nên xoay (tạo lại) khi chuyển sang dùng thật.
