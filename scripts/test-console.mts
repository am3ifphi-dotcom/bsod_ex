import assert from 'node:assert/strict';

class ElementStub {
  className = '';
  textContent = '';
  innerHTML = '';
  value = '';
  disabled = false;
  scrollTop = 0;
  scrollHeight = 0;
  children: ElementStub[] = [];
  classList = { add() {}, remove() {} };
  addEventListener() {}
  setAttribute() {}
  appendChild(child: ElementStub) { this.children.push(child); }
  focus() {}
  blur() {}
}
const elements = new Map<string, ElementStub>();
(globalThis as any).document = {
  getElementById(id: string) {
    if (!elements.has(id)) elements.set(id, new ElementStub());
    return elements.get(id);
  },
  createElement: () => new ElementStub(),
};
(globalThis as any).window = globalThis;
(globalThis as any).requestAnimationFrame = (fn: () => void) => fn();
const { ConsoleUI } = await import('../src/ui/ConsoleUI.ts');
const ui: any = new ConsoleUI({ playOneShot() {}, playKeystroke() {} } as any);
let wakes = 0;
ui.onWakeUpCommand = () => wakes++;

// The recovery shell must work before any landmark is approached.
ui.handleCommand('WAKE_UP');
assert.equal(ui.locked, true, 'WAKE_UP must be available from the current location');
await new Promise((resolve) => setTimeout(resolve, 650));
assert.equal(wakes, 1, 'portable WAKE_UP should trigger the ending');

// Reset must still cancel any queued ending callbacks.
ui.reset();
ui.handleCommand('WAKE_UP');
ui.reset();
await new Promise((resolve) => setTimeout(resolve, 650));
assert.equal(wakes, 1, 'reset must cancel pending ending callbacks');
console.log('Portable console access and reset: passed');
