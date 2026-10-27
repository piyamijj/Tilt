// Kupon / VIP durumu. localStorage'da saklanır, yenileme ve APK yeniden açılışında korunur.

const KEY = 'tilt.vip.code';
const CODES = new Set(['POLAT', 'LUTFI']);

export function normalizeCoupon(raw) {
  return String(raw ?? '')
    .trim()
    .toLocaleUpperCase('en-US')
    .replace(/İ/g, 'I');
}

export function redeemCoupon(raw) {
  const code = normalizeCoupon(raw);
  if (!CODES.has(code)) return null;
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* depolama yoksa sessizlikle geç */
  }
  return code;
}

export function getVipCode() {
  try {
    const code = normalizeCoupon(localStorage.getItem(KEY));
    return CODES.has(code) ? code : null;
  } catch {
    return null;
  }
}

export function isVip() {
  return getVipCode() !== null;
}

export function clearVip() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* yoksay */
  }
}
