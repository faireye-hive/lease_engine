export const APP_ID = 'lease.engine';
export const ACCOUNT_PATTERN = /^[a-z][a-z0-9.-]{2,15}$/;
export const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.]{1,15}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,8})?$/;

export function validQuantity(value) {
  return typeof value === 'string' && DECIMAL_PATTERN.test(value) && Number(value) > 0;
}
export function validAccount(value) {
  return typeof value === 'string' && ACCOUNT_PATTERN.test(value) && !value.includes('..') && !value.endsWith('.');
}
export function parseEvent(raw, actor, blockTime) {
  if (!validAccount(actor) || !raw || typeof raw !== 'object' || Array.isArray(raw) || raw.v !== 1) return null;
  if (!['request', 'interest', 'cancel'].includes(raw.type)) return null;
  if (typeof raw.id !== 'string' || !UUID_PATTERN.test(raw.id)) return null;
  const time = Date.parse(blockTime);
  if (!Number.isFinite(time)) return null;
  if (raw.type === 'request') {
    if (!SYMBOL_PATTERN.test(raw.symbol) || !SYMBOL_PATTERN.test(raw.paySymbol)) return null;
    if (!validQuantity(raw.quantity) || !validQuantity(raw.price)) return null;
    if (!Number.isInteger(raw.days) || raw.days < 1 || raw.days > 365) return null;
    if (typeof raw.note !== 'string' || raw.note.length > 240) return null;
    const expiry = Date.parse(raw.expiresAt);
    if (!Number.isFinite(expiry) || expiry < time + 60_000 || expiry > time + 61 * 86400_000) return null;
    return {type: 'request', id: raw.id, symbol: raw.symbol, quantity: raw.quantity,
      price: raw.price, paySymbol: raw.paySymbol, days: raw.days, note: raw.note.trim(),
      expiresAt: new Date(expiry).toISOString()};
  }
  if (typeof raw.requestId !== 'string' || !UUID_PATTERN.test(raw.requestId)) return null;
  if (raw.type === 'cancel') return {type: 'cancel', id: raw.id, requestId: raw.requestId};
  if (typeof raw.note !== 'string' || raw.note.trim().length < 1 || raw.note.length > 240) return null;
  return {type: 'interest', id: raw.id, requestId: raw.requestId, note: raw.note.trim()};
}

export function reduceEvents(events, now = Date.now()) {
  const requests = new Map();
  const ordered = [...events].sort((a,b) => a.blockNum - b.blockNum || a.eventOrder - b.eventOrder);
  for (const entry of ordered) {
    const {actor, payload, txId, time} = entry;
    if (payload.type === 'request') {
      if (requests.has(payload.id)) continue;
      requests.set(payload.id, { ...payload, author: actor, txId, createdAt: time,
        status: 'open', interests: [] });
    } else {
      const request = requests.get(payload.requestId);
      if (!request) continue;
      if (payload.type === 'cancel' && request.author === actor) request.status = 'cancelled';
      if (payload.type === 'interest' && request.status === 'open'
        && Date.parse(request.expiresAt) > Date.parse(time) && request.author !== actor
        && !request.interests.some(item => item.author === actor)) {
        request.interests.push({author: actor, note: payload.note, txId, createdAt: time});
      }
    }
  }
  return [...requests.values()].map(request => ({
    ...request, status: request.status === 'open' && Date.parse(request.expiresAt) <= now
      ? 'expired' : request.status
  })).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
}
