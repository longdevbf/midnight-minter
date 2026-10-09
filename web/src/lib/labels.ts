import type { TokenStatus, WalletStatus } from '../../../server/src/types';

export const STATUS_LABEL: Record<WalletStatus, string> = {
  created: 'Mới tạo',
  funding: 'Đang cấp tNIGHT',
  syncing: 'Đang đồng bộ',
  dust_pending: 'Đang sinh DUST',
  ready: 'Sẵn sàng',
  failed: 'Lỗi',
};

export const TOKEN_STATUS_LABEL: Record<TokenStatus, string> = {
  queued: 'Đang chờ',
  deploying: 'Đang deploy contract',
  minting: 'Đang mint',
  done: 'Hoàn tất',
  failed: 'Lỗi',
};

export type Tone = 'ok' | 'bad' | 'busy';

export function statusTone(status: WalletStatus | TokenStatus): Tone {
  if (status === 'ready' || status === 'done') return 'ok';
  if (status === 'failed') return 'bad';
  return 'busy';
}
