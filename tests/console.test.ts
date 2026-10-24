import { describe, expect, it, vi } from 'vitest';
import { GameConsole } from '../src/narrative/Console';

function make() {
  const onWakeUp = vi.fn();
  const playError = vi.fn();
  const playOk = vi.fn();
  const c = new GameConsole({
    areaName: 'arrival',
    wakeKnown: false,
    visitedAreas: [],
    onWakeUp,
    playError,
    playOk,
  });
  return { c, onWakeUp, playError, playOk };
}

describe('in-world console', () => {
  it('accepts WAKE_UP written with underscores, spaces or any case', () => {
    for (const input of ['WAKE_UP', 'wake_up', 'Wake_Up', '  wake__up  ', 'WAKE UP', 'wake-up', 'WAKEUP']) {
      const { c, onWakeUp } = make();
      const lines = c.submit(input);
      expect(onWakeUp, input).toHaveBeenCalledTimes(1);
      expect(lines.some((l) => l.cls === 'ok')).toBe(true);
    }
  });

  it('does not accept near-misses (the puzzle is not bypassed)', () => {
    for (const input of ['wake', 'up', 'wakeup?', 'wake me up', 'hello', 'sudo wake_up', 'wake_up_now']) {
      const { c, onWakeUp } = make();
      c.submit(input);
      expect(onWakeUp, input).not.toHaveBeenCalled();
    }
  });

  it('answers everything in-fiction and never throws', () => {
    const { c } = make();
    for (const input of ['help', 'status', 'ls', 'cat', 'cat notes.txt', 'cat nope', 'whoami', 'ping', 'echo hi', 'scan', 'log', 'clear', 'exit', 'reboot', '', '   ', 'λ', '🙂']) {
      expect(() => c.submit(input)).not.toThrow();
      const lines = c.submit(input);
      expect(Array.isArray(lines)).toBe(true);
      for (const l of lines) expect(typeof l.text).toBe('string');
    }
  });

  it('does not spell out the answer in ordinary help output', () => {
    const { c } = make();
    const text = c.submit('help').map((l) => l.text).join('\n').toUpperCase();
    expect(text).not.toContain('WAKE_UP');
  });

  it('hints at the monolith without giving the exact command', () => {
    const { c } = make();
    const status = c.submit('status').map((l) => l.text).join('\n');
    expect(status.toLowerCase()).toContain('exit');
    const scan = c.submit('scan').map((l) => l.text).join('\n');
    expect(scan.toLowerCase()).toContain('structure');
    expect(scan.toUpperCase()).not.toContain('WAKE_UP');
  });

  it('resets for replay', () => {
    const { c, onWakeUp } = make();
    c.submit('wake up');
    c.reset();
    expect(onWakeUp).toHaveBeenCalledTimes(1);
    c.submit('wake up');
    expect(onWakeUp).toHaveBeenCalledTimes(2);
  });
});
