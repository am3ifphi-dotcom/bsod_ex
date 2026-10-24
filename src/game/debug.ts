/**
 * デバッグ手段(通常プレイでは無効)とベンチマーク
 * ?debug=1 でフェーズジャンプ、?benchmark=1 で計測走査
 */
export interface DebugInfo {
  enabled: boolean;
  benchmark: boolean;
}

export function parseDebugFlags(): DebugInfo {
  const params = new URLSearchParams(window.location.search);
  return {
    enabled: params.get('debug') === '1' || params.has('debug'),
    benchmark: params.get('benchmark') === '1',
  };
}

export type PhaseJump =
  | 'room'
  | 'bsod'
  | 'void'
  | 'console'
  | 'collapse'
  | 'fall'
  | 'return';

export const PHASE_KEYS: Record<string, PhaseJump> = {
  Digit1: 'room',
  Digit2: 'bsod',
  Digit3: 'void',
  Digit4: 'console',
  Digit5: 'collapse',
  Digit6: 'fall',
  Digit7: 'return',
};
