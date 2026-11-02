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
// No tower gate: WAKE_UP executes from anywhere in the glitch world.
ui.setWorldState(false, 55);
ui.handleCommand('WAKE_UP');
assert.equal(ui.locked, true, 'WAKE_UP must work anywhere (no sanctuary gate)');
await new Promise((resolve) => setTimeout(resolve, 650));
assert.equal(wakes, 1, 'WAKE_UP should trigger the ending from far away');
ui.reset();
ui.setWorldState(true, 1);
ui.handleCommand('wake up');
assert.equal(ui.locked, true);
await new Promise((resolve) => setTimeout(resolve, 650));
assert.equal(wakes, 2, 'lowercase + space WAKE_UP still triggers the ending');
ui.reset();
ui.setWorldState(false, 40);
ui.handleCommand('WAKE_UP');
ui.reset();
await new Promise((resolve) => setTimeout(resolve, 650));
assert.equal(wakes, 2, 'reset must cancel pending ending callbacks');
console.log('Console progression and reset: passed');
