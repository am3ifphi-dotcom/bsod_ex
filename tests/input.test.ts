// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Input } from '../src/core/Input';

/**
 * Pointer Lock is not always available (an iframe without allow="pointer-lock", a browser
 * policy, a remote desktop). The game must stay playable in that case, so Input keeps a
 * lock-free look mode. These tests pin that behaviour down.
 */

function move(dx: number, dy = 0): void {
  const ev = new MouseEvent('mousemove', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'movementX', { value: dx });
  Object.defineProperty(ev, 'movementY', { value: dy });
  window.dispatchEvent(ev);
}

let container: HTMLDivElement;
let input: Input;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  input = new Input(container);
});

describe('input look fallback', () => {
  it('ignores mouse movement when there is neither a lock nor the fallback', () => {
    move(40);
    expect(input.lookActive).toBe(false);
    expect(input.takeMouseDelta()).toEqual({ x: 0, y: 0 });
  });

  it('accumulates movement in the lock-free fallback', () => {
    input.setFreeLook(true);
    expect(input.lookActive).toBe(true);
    move(12, -4);
    move(3, 6);
    expect(input.takeMouseDelta()).toEqual({ x: 15, y: 2 });
    // consuming drains it
    expect(input.takeMouseDelta()).toEqual({ x: 0, y: 0 });
  });

  it('stops reading the mouse while a modal (console/menu) blocks input', () => {
    input.setFreeLook(true);
    const release = input.block();
    move(30);
    expect(input.takeMouseDelta()).toEqual({ x: 0, y: 0 });
    expect(input.isActive()).toBe(false);
    release();
    expect(input.isActive()).toBe(true);
    move(8);
    expect(input.takeMouseDelta()).toEqual({ x: 8, y: 0 });
  });

  it('rejects the giant spikes some systems emit when a lock is acquired', () => {
    input.setFreeLook(true);
    move(900, 0);
    expect(input.takeMouseDelta()).toEqual({ x: 0, y: 0 });
    move(400, 0);
    expect(input.takeMouseDelta()).toEqual({ x: 400, y: 0 });
  });

  it('does not ask for a pointer lock once the fallback is active', () => {
    input.setFreeLook(true);
    const spy = vi.fn();
    (container as unknown as { requestPointerLock: () => void }).requestPointerLock = spy;
    input.requestPointerLock();
    expect(spy).not.toHaveBeenCalled();
  });

  it('falls back cleanly when the browser rejects pointer lock', () => {
    const spy = vi.fn(() => { throw new Error('denied'); });
    (container as unknown as { requestPointerLock: () => void }).requestPointerLock = spy;
    const onError = vi.fn();
    input.onLockError = onError;
    input.requestPointerLock();
    expect(spy).toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
    expect(input.lockSupported).toBe(false);
  });
});
