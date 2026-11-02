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

// The shell must never be gated on where the player is standing.
ui.setWorldState(false, 76);
ui.handleCommand('WAKE_UP');
assert.equal(ui.locked, true, 'WAKE_UP must be accepted from anywhere in the dump');
await new Promise((resolve) => setTimeout(resolve, 700));
assert.equal(wakes, 1, 'accepted directive should start the ending');

// Reset must cancel pending timers and reopen the shell clean.
ui.reset();
assert.equal(ui.locked, false);
ui.setWorldState(true, 1);
ui.handleCommand('wake up');
assert.equal(ui.locked, true);
ui.reset();
await new Promise((resolve) => setTimeout(resolve, 700));
assert.equal(wakes, 1, 'reset must cancel pending ending callbacks');

// Diagnostics still work and never lock the shell.
ui.handleCommand('TRACE');
assert.equal(ui.locked, false);
ui.handleCommand('STATUS');
ui.handleCommand('PS');
assert.equal(ui.locked, false);
console.log('Console shell: passed');
