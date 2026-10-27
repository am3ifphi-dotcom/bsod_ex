/**
 * アセットの URL。Vite の base を前置する（Node でのテスト時は '/'）。
 */
const BASE = import.meta.env?.BASE_URL ?? '/';
export const asset = (p) => `${BASE}${String(p).replace(/^\/+/, '')}`;
