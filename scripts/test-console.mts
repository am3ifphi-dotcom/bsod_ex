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

// The command must work from anywhere: the sanctuary only restores the word, it never gates it.
ui.handleCommand('WAKE_UP');
assert.equal(ui.locked, true, 'WAKE_UP must be accepted before the sanctuary is reached');
await new Promise((resolve) => setTimeout(resolve, 650));
assert.equal(wakes, 1, 'an unsynced command still triggers the ending');

ui.reset();
ui.setWorldState(true, 8);
ui.handleCommand('wake up');
assert.equal(ui.locked, true);
await new Promise((resolve) => setTimeout(resolve, 650));
assert.equal(wakes, 2, 'synced command still triggers the ending');

ui.reset();
ui.setWorldState(true, 1);
ui.handleCommand('WAKE_UP');
ui.reset();
await new Promise((resolve) => setTimeout(resolve, 650));
assert.equal(wakes, 2, 'reset must cancel pending ending callbacks');

// Diagnostics never lock the shell.
ui.handleCommand('STATUS');
assert.equal(ui.locked, false, 'diagnostics must not arm the ending');
console.log('Console progression and reset: passed');
