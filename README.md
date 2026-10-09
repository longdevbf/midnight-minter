# Midnight Minter

App chạy local để tạo nhiều ví Midnight, cấp tNIGHT và DUST, rồi mint token riêng cho từng ví (mỗi ví một contract, một loại token), có đủ name, symbol, decimals, số lượng và ảnh IPFS.

## Mạng nào dùng được

- **`NETWORK=preview` là mạng đang chạy được.** Mỗi ví mới cần khoảng **17–20 phút** đồng bộ ban đầu (~263.000 event, ~220–250 event/giây). Các ví được xử lý tuần tự, nên N ví mất cỡ **N × 20 phút**.
- **Preprod hiện không dùng được**: đo thật, đồng bộ ví chạy 40 phút (~1,5 triệu event) rồi lỗi `Wallet.Sync`, lặp lại nhiều lần. Code vẫn mặc định `preprod`, nên `.env.example` đặt sẵn `NETWORK=preview`.
- Trạng thái **"Đang đồng bộ"** nghĩa là ví đang tải toàn bộ lịch sử từ indexer; việc này chưa xong thì chưa cấp DUST hay mint được. Cứ để app chạy, đừng bấm Thử lại liên tục.
- Đồng bộ **chưa được lưu lại**: tắt/khởi động lại app, hoặc ví bị đóng khi vượt `MAX_OPEN_WALLETS`, thì lần mở lại phải đồng bộ lại từ đầu (~20 phút). Tính năng lưu state ví mới là kế hoạch, chưa có.

## Yêu cầu

- **Node 22+**, Docker Desktop
- **WSL 2** với distro **Ubuntu** (tên chính xác) có Compact CLI với compiler 0.31.1
- JWT của Pinata để upload ảnh lên IPFS
- Token Blockfrost chỉ cần khi dùng preprod; preview không cần

## Cài đặt

```bash
npm install
copy .env.example .env     # PowerShell/cmd; Unix: cp .env.example .env
```

Điền `PINATA_JWT` trong `.env` (xem bảng dưới), rồi:

```bash
npm run contract:build   # biên dịch contract qua WSL Ubuntu
npm run proof:up         # chạy proof server (Docker, 127.0.0.1:6300)
npm start                # build giao diện & chạy backend ở 127.0.0.1:8787
```

Phát triển: `npm run dev:server` (127.0.0.1:8787) + `npm run dev:web` (127.0.0.1:5173).

### Đổi cổng proof server

Compose đọc `PROOF_SERVER_PORT` (mặc định 6300). Trên một số máy Windows, `wslrelay` đã chiếm cổng 6300: `docker compose up` báo "Ports are not available", hoặc tệ hơn là một proof server cũ khác phiên bản đang trả lời ở 6300. Khi đó dùng cổng trống:

```powershell
$env:PROOF_SERVER_PORT="6301"; npm run proof:up
```

rồi đặt `PROOF_SERVER_URL=http://localhost:6301` trong `.env`.

## Biến môi trường

| Biến | Mặc định | Mô tả |
|------|----------|-------|
| `NETWORK` | `preprod` (`.env.example`: `preview`) | `preprod` hoặc `preview` (xem mục "Mạng nào dùng được") |
| `BLOCKFROST_PROJECT_ID` | — | Token Blockfrost (bắt buộc trên preprod) |
| `PINATA_JWT` | — | JWT Pinata (bắt buộc) |
| `PROOF_SERVER_URL` | `http://localhost:6300` | URL proof server |
| `PORT` | `8787` | Backend port |
| `DATA_DIR` | `data` | Thư mục lưu dữ liệu |
| `IPFS_GATEWAY` | `https://gateway.pinata.cloud/ipfs/` | IPFS gateway URL |
| `FUND_AMOUNT` | `100` | tNIGHT cấp cho mỗi ví con (6 decimals = 100 × 10^6 units) |
| `MAX_OPEN_WALLETS` | `6` | Số ví giữ mở trong SDK cùng lúc, nguyên số 1–20. Ví bị đóng khi vượt số này; mở lại phải đồng bộ lại đầy đủ (~20 phút trên preview) |

## Cách dùng

1. Đặt mật khẩu chủ (mã hóa seedphrase của mọi ví; không khôi phục nếu quên)
2. Tạo **ví tổng**, xin tNIGHT ở faucet (captcha nên không tự động được); app tự phát hiện tiền về
3. Tạo ví con: app tự cấp tNIGHT từ ví tổng, đồng bộ (~20 phút/ví) và đăng ký DUST
4. Tab **Mint token**: nhập thông tin, chọn ảnh, bấm Mint
5. Tab **Ví**: bấm để xem token của ví đó
6. **Xuất toàn bộ seedphrase**: nhập lại mật khẩu chủ, app tải về một file JSON. File này chứa **tất cả seedphrase**: cất ở nơi offline rồi xóa khỏi máy.

### Tự thử lại và Thử lại

- Lỗi tạm thời ở bước **đồng bộ** và **sinh DUST** được app tự thử lại tối đa 2 lần, cách nhau 60 giây.
- **Cấp tNIGHT, deploy và mint không bao giờ tự thử lại** (tránh chuyển tiền hai lần hoặc deploy trùng contract): bấm **Thử lại**.
- Lỗi nghiệp vụ không tự thử lại: ví tổng thiếu tNIGHT, chưa có DUST, hết thời gian chờ.
- Timeout: lệnh gọi chuỗi 30 phút, bước DUST 45 phút, đồng bộ 60 phút. Nếu deploy bị timeout, giao dịch vẫn có thể được xác nhận và tốn DUST; kiểm tra ví trước khi bấm Thử lại (sẽ deploy contract mới).

## Bảo mật

- Mật khẩu chủ: mã hóa seedphrase bằng AES-256-GCM + scrypt
- Thư mục `data/` và tệp `.env` chứa bí mật: **không commit, không chia sẻ**
- App chỉ lắng nghe `127.0.0.1`; proof server cũng chỉ bind `127.0.0.1`
- Backend chỉ nhận request có Host là `localhost`, `127.0.0.1` hoặc `[::1]`; request ghi mang Origin lạ bị từ chối (chống DNS rebinding/CSRF)
- Log console được che khóa Blockfrost và Pinata JWT (thay bằng `***`). Vẫn nên tránh chia sẻ log: chữ do Node ghi thẳng ra stderr khi crash **không** được che
- Nếu từng lộ khóa Blockfrost/Pinata (dán log, chụp màn hình...), hãy tạo khóa mới

## Giới hạn đã biết

- **Faucet**: có captcha, phải xin tNIGHT cho ví tổng bằng tay. Nạp faucet vào ví tổng giữa lúc app crash và lúc thử lại có thể che mất khoản đã trừ, dẫn tới chuyển tiền cấp vốn lần thứ hai
- **Mint một lần**: mỗi contract (mỗi ví) chỉ mint được một loại token, một lần
- **Giao dịch mint** hiển thị "Đã mint trước đó" nếu mint đã xảy ra ở lần chạy trước
- **Metadata**: nằm trong ledger của contract, chưa phát event MIP-0018; Lace và sàn có thể chưa hiển thị dù metadata đầy đủ
- **Đồng bộ ví** chưa lưu lại giữa các lần chạy (xem "Mạng nào dùng được")
- **Token thử nghiệm**: trên preprod/preview chỉ để thử, chưa có giá trị thật
- **Thư mục `midnight-level-db/`**: lưu trữ riêng tư của SDK Midnight; đã trong `.gitignore`

## Chạy test

```bash
npm run contract:build      # bắt buộc trước khi chạy npm test (test cần contract đã biên dịch)
npm test                    # unit + integration (không cần mạng)
npm run test:live           # e2e trên mạng thật (cần SPIKE_MNEMONIC + setup)
```

### Script `scripts/live-wallet.ts`

Công cụ thủ công làm việc với một ví thật (dùng mạng theo `.env`):

```bash
npx tsx --env-file=.env scripts/live-wallet.ts create                       # sinh ví mới, in địa chỉ + mnemonic (cố ý)
npx tsx --env-file=.env scripts/live-wallet.ts balance                      # đồng bộ rồi in số dư NIGHT/DUST
npx tsx --env-file=.env scripts/live-wallet.ts dust                         # đăng ký DUST
npx tsx --env-file=.env scripts/live-wallet.ts send <địa-chỉ> <số-tNIGHT>   # chuyển tNIGHT
```

Seed chỉ đưa qua biến môi trường `SPIKE_MNEMONIC`, không truyền qua tham số dòng lệnh. Các lệnh trừ `create` đều cần đồng bộ ví (~20 phút trên preview).

### Test e2e (test:live): side effects và điều kiện

- Gửi `FUND_AMOUNT` tNIGHT từ ví tổng sang ví con bỏ đi (seed chỉ ở trong bộ nhớ) → **không khôi phục được**
- Cần: `SPIKE_MNEMONIC` của ví tổng đã có tNIGHT + DUST; proof server đang chạy; `npm run contract:build`; `.env` có `PINATA_JWT` (và `BLOCKFROST_PROJECT_ID` nếu preprod)

```bash
# PowerShell:
$env:SPIKE_MNEMONIC="word1 word2 ... word24"; npm run test:live
# Bash:
SPIKE_MNEMONIC="word1 word2 ... word24" npm run test:live
```

Test bị skip nếu không đặt `SPIKE_MNEMONIC`. Mỗi lần chạy có thể mất 1–2 giờ (đồng bộ nhiều ví).
