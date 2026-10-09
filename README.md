# Midnight Minter

App chạy local để tạo nhiều ví Midnight, cấp tNIGHT và DUST, rồi mint token riêng cho từng ví (mỗi ví một contract, một loại token), có đủ name, symbol, decimals, số lượng và ảnh IPFS.

## Yêu cầu

- Node 22+, Docker Desktop, WSL 2 (Ubuntu) có Compact compiler 0.31.1
- Token Blockfrost cho Midnight Preprod (hoặc `NETWORK=preview`, không cần token)
- JWT của Pinata để upload ảnh lên IPFS

## Cài đặt

```bash
npm install
copy .env.example .env     # Windows: cmd/PowerShell
# cp .env.example .env     # Unix/macOS
```

Điền `BLOCKFROST_PROJECT_ID` (preprod) hoặc để trống (preview) và `PINATA_JWT`, rồi:

```bash
npm run contract:build   # biên dịch contract qua WSL
npm run proof:up         # chạy proof server (Docker, cổng 6300)
npm start                # build giao diện và chạy ở http://127.0.0.1:8787
```

Phát triển: `npm run dev:server` (server ở cổng 8787) và `npm run dev:web` (giao diện ở cổng 5173).

## Cách dùng

1. Đặt mật khẩu chủ (mã hóa seedphrase của mọi ví; không khôi phục nếu quên)
2. Tạo **ví tổng**, xin tNIGHT ở faucet (captcha nên không tự động được)
3. Tạo ví con: app tự cấp tNIGHT từ ví tổng, đồng bộ và đăng ký DUST
4. Tab **Mint token**: nhập thông tin, chọn ảnh, bấm Mint
5. Tab **Ví**: bấm để xem token của ví đó

## Bảo mật

- Mật khẩu chủ: mã hóa seedphrase bằng AES-256-GCM + scrypt
- Thư mục `data/` và tệp `.env` chứa bí mật: **không commit, không chia sẻ**
- App chỉ lắng nghe `127.0.0.1` (chỉ máy local)

## Giới hạn đã biết

- **Faucet**: có captcha, phải xin tNIGHT cho ví tổng bằng tay
- **Mint một lần**: mỗi contract (mỗi ví) chỉ mint được một loại token, một lần
- **mintTxId đã mint**: hiển thị "Đã mint trước đó" nếu mint đã xảy ra từ lần chạy trước (txid cached)
- **Timeout chuỗi**: 30 phút cho lệnh gọi (finalization, findDeployedContract); 60 phút đồng bộ (balances(true)). Nếu deploy timeout, kiểm tra ví trước bấm Thử lại
- **Metadata**: nằm trong ledger của contract, chưa phát event MIP-0018; Lace và sàn có thể chưa hiển thị dù metadata đầy đủ
- **Token thử nghiệm**: trên preprod/preview chỉ để thử, chưa có giá trị thật
- **Lệnh `compact` trên Windows**: là công cụ nén NTFS; compiler Compact thật chỉ chạy trong WSL (script `contract:build` đã xử lý)

## Chạy test

```bash
npm test              # unit + integration test (không cần mạng)
npm run test:live     # e2e test trên mạng thật (cần biến SPIKE_MNEMONIC)
```

Biến `SPIKE_MNEMONIC` (đặt trong terminal, **không ghi vào file**):

```bash
# PowerShell: 
$env:SPIKE_MNEMONIC="word1 word2 ... word24"; npm run test:live

# Bash:
SPIKE_MNEMONIC="word1 word2 ... word24" npm run test:live
```

Test skip nếu `SPIKE_MNEMONIC` không đặt. Mỗi lần chạy test:live có thể mất vài chục phút (đồng bộ nhiều ví trên preprod).
