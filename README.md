# Midnight Minter

App chạy local để tạo nhiều ví Midnight, cấp tNIGHT và DUST, rồi mint token riêng cho từng ví (mỗi ví một contract, một loại token), có đủ name, symbol, decimals, số lượng và ảnh IPFS.

## Yêu cầu

- **Node 22+**, Docker Desktop
- **WSL 2** với distro **Ubuntu** (tên chính xác) có Compact CLI với compiler 0.31.1
- Token Blockfrost cho Midnight Preprod (hoặc `NETWORK=preview`, không cần token)
- JWT của Pinata để upload ảnh lên IPFS

## Cài đặt

```bash
npm install
```

Trên Windows (cmd/PowerShell):
```cmd
copy .env.example .env
```

Trên Unix/macOS (bash/zsh):
```bash
cp .env.example .env
```

Điền biến môi trường (xem bảng dưới), rồi:

```bash
npm run contract:build   # biên dịch contract qua WSL Ubuntu
npm run proof:up         # chạy proof server (Docker, port 6300)
npm start                # build giao diện & chạy backend ở 127.0.0.1:8787
```

Phát triển: `npm run dev:server` (backend 127.0.0.1:8787) + `npm run dev:web` (UI 127.0.0.1:5173).

## Biến môi trường

| Biến | Mặc định | Mô tả |
|------|----------|-------|
| `NETWORK` | `preprod` | `preprod` hoặc `preview` |
| `BLOCKFROST_PROJECT_ID` | — | Token Blockfrost (bắt buộc trên preprod) |
| `PINATA_JWT` | — | JWT Pinata (bắt buộc) |
| `PROOF_SERVER_URL` | `http://localhost:6300` | URL proof server |
| `PORT` | `8787` | Backend port |
| `DATA_DIR` | `data` | Thư mục lưu dữ liệu |
| `IPFS_GATEWAY` | `https://gateway.pinata.cloud/ipfs/` | IPFS gateway URL |
| `FUND_AMOUNT` | `100` | tNIGHT cấp cho mỗi ví con (6 decimals = 100 × 10^6 units) |

## Cách dùng

1. Đặt mật khẩu chủ (mã hóa seedphrase của mọi ví; không khôi phục nếu quên)
2. Tạo **ví tổng**, xin tNIGHT ở faucet (captcha nên không tự động được)
3. Tạo ví con: app tự cấp tNIGHT từ ví tổng, đồng bộ và đăng ký DUST
4. Tab **Mint token**: nhập thông tin, chọn ảnh, bấm Mint
5. Tab **Ví**: bấm để xem token của ví đó

## Bảo mật

- Mật khẩu chủ: mã hóa seedphrase bằng AES-256-GCM + scrypt
- Thư mục `data/` và tệp `.env` chứa bí mật: **không commit, không chia sẻ**
- App chỉ lắng nghe `127.0.0.1` (chỉ máy local); proof server cũng chỉ bind `127.0.0.1:6300`
- **Cảnh báo**: RPC library ghi toàn bộ RPC URL (bao gồm Blockfrost `project_id`) vào console; không chia sẻ server logs public

## Giới hạn đã biết

- **Faucet**: có captcha, phải xin tNIGHT cho ví tổng bằng tay
- **Mint một lần**: mỗi contract (mỗi ví) chỉ mint được một loại token, một lần
- **mintTxId đã mint**: hiển thị "Đã mint trước đó" nếu mint đã xảy ra từ lần chạy trước (txid cached)
- **Timeout chuỗi**: 30 phút cho lệnh gọi (finalization, findDeployedContract); 60 phút đồng bộ (balances(true)). Nếu deploy timeout, kiểm tra ví trước bấm Thử lại
- **Metadata**: nằm trong ledger của contract, chưa phát event MIP-0018; Lace và sàn có thể chưa hiển thị dù metadata đầy đủ
- **Token thử nghiệm**: trên preprod/preview chỉ để thử, chưa có giá trị thật
- **Thư mục `midnight-level-db/`**: lưu trữ riêng tư của SDK Midnight; đã trong `.gitignore`

## Chạy test

```bash
npm test                    # unit + integration (không cần mạng)
npm run test:live           # e2e trên mạng thật (cần SPIKE_MNEMONIC + setup)
```

### Test e2e (test:live) — Side effects & Prerequisites

**Side effects** (mất tài nguyên):
- Gửi `FUND_AMOUNT` tNIGHT (mặc định 100) từ treasury wallet sang ví con bỏ đi (seed chỉ lưu in-memory) → **không khôi phục được**

**Prerequisites**:
1. Ví tổng có mnemonic (SPIKE_MNEMONIC env var) chứa tNIGHT + DUST sẵn
2. Docker chạy proof server: `npm run proof:up` (nếu port 6300 bị dùng, chạy khác port + set `PROOF_SERVER_URL`)
3. Contract đã biên dịch: `npm run contract:build`
4. `.env` có `BLOCKFROST_PROJECT_ID` (preprod) và `PINATA_JWT`

**Chạy**:
```bash
# PowerShell:
$env:SPIKE_MNEMONIC="word1 word2 ... word24"; npm run test:live

# Bash:
SPIKE_MNEMONIC="word1 word2 ... word24" npm run test:live
```

Test skip nếu `SPIKE_MNEMONIC` không đặt. Mỗi lần chạy có thể mất 1–2 giờ (đồng bộ nhiều ví trên preprod).
