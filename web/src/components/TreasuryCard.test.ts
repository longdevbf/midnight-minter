import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PublicWallet } from '../../../server/src/types';
import { TreasuryCard } from './TreasuryCard';

const FAUCET = 'https://faucet.example/';
const noop = () => undefined;

function treasury(over: Partial<PublicWallet>): PublicWallet {
  return {
    id: 't1', label: 'Ví tổng', kind: 'treasury', network: 'preview', unshieldedAddress: 'mn_addr_preview1' + 'q'.repeat(50),
    status: 'ready', failedStep: null, message: null, nightBalance: '5000000', dustBalance: '0', createdAt: 0, tokenCount: 0,
    ...over,
  };
}

const render = (t: PublicWallet) =>
  renderToStaticMarkup(
    createElement(TreasuryCard, { treasury: t, faucetUrl: FAUCET, fundAmount: '100000000', onChanged: noop, onSelect: noop, onError: noop }),
  );

describe('TreasuryCard: link faucet và nút chép địa chỉ luôn hiện để nạp thêm', () => {
  for (const [name, over] of [
    ['ready', { status: 'ready' }],
    ['failed', { status: 'failed', failedStep: 'dust_pending', message: 'lỗi' }],
    ['syncing', { status: 'syncing' }],
    ['funding (chờ faucet)', { status: 'funding' }],
  ] as const) {
    it(`trạng thái ${name}`, () => {
      const html = render(treasury(over as Partial<PublicWallet>));
      expect(html).toContain(`href="${FAUCET}"`);
      expect(html).toContain('aria-label="Chép địa chỉ ví tổng"');
    });
  }

  it('lời nhắc "App tự phát hiện khi tiền về" chỉ hiện khi đang chờ faucet', () => {
    expect(render(treasury({ status: 'funding' }))).toContain('App tự phát hiện khi tiền về');
    expect(render(treasury({ status: 'ready' }))).not.toContain('App tự phát hiện khi tiền về');
  });
});
