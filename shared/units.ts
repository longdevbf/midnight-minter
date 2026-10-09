export const NIGHT_DECIMALS = 6;
export const DUST_DECIMALS = 15;

export function formatUnits(raw: string | bigint, decimals: number): string {
  const value = typeof raw === 'bigint' ? raw : BigInt(raw);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fracStr = decimals === 0 ? '' : frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${wholeStr}${fracStr ? `.${fracStr}` : ''}`;
}

export function shortAddr(address: string, head = 14, tail = 8): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}
