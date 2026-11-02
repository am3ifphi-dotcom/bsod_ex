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
let scans = 0;
let glitches = 0;
ui.onWakeUpCommand = () => wakes++;
ui.onScanCommand = () => scans++;
ui.onGlitchCommand = () => glitches++;

// 1. Interactive SCAN and GLITCH commands work immediately from spawn (far from tower!)
ui.setWorldState(false, 88, { x: 0, y: 1.7, z: 32 });
ui.handleCommand('scan');
ui.handleCommand('glitch');
assert.equal(scans, 1, 'SCAN should fire 3D scan pulse anywhere');
assert.equal(glitches, 1, 'GLITCH should fire anomaly surge anywhere');

// 2. WAKE_UP works immediately from spawn WITHOUT walking to the tower!
ui.handleCommand('wake up');
assert.equal(ui.locked, true, 'WAKE_UP must execute immediately without requiring tower unlock');
await new Promise((resolve) => setTimeout(resolve, 620));
assert.equal(wakes, 1, 'WAKE_UP should trigger collapse from any world coordinate');

// 3. Reset cancels pending ending callbacks cleanly
ui.reset();
ui.setWorldState(false, 88, { x: 12, y: 1.7, z: 18 });
ui.handleCommand('WAKE_UP');
ui.reset();
await new Promise((resolve) => setTimeout(resolve, 620));
assert.equal(wakes, 1, 'reset must cancel pending ending callbacks');

console.log('Unrestricted Ring-0 console commands & reset: passed');
