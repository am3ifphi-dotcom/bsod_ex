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

// 1. THE GATE IS GONE. WAKE_UP must work before a single step is taken,
//    with the tower 90m away and coreVisited = false.
ui.setWorldState(90, false);
ui.handleCommand('WAKE_UP');
assert.equal(ui.locked, true, 'WAKE_UP must be accepted from the very first node');
await new Promise((resolve) => setTimeout(resolve, 700));
assert.equal(wakes, 1, 'the ending must fire without visiting the tower');
assert.equal(ui.isOpen, false, 'the console must close itself after the directive');

// 2. Boot banner discloses the directive up front and contains no gate language.
const banner = elements.get('console-log')!.children.map((c) => c.textContent).join('\n');
assert.match(banner, /WAKE_UP/, 'directive must be printed in the boot banner');
assert.match(banner, /ANY NODE/, 'banner must state that no location is required');

// 3. Reset cancels pending ending callbacks and re-arms the shell.
ui.reset();
ui.setWorldState(0, true);
ui.handleCommand('wake up');   // lowercase + space normalisation
assert.equal(ui.locked, true);
ui.reset();
await new Promise((resolve) => setTimeout(resolve, 700));
assert.equal(wakes, 1, 'reset must cancel pending ending callbacks');

// 4. Looking around is informative, never permission-granting.
ui.reset();
ui.setWorldState(12, false);
ui.handleCommand('STATUS');
ui.handleCommand('LOOK');
ui.handleCommand('HELP');
const log = elements.get('console-log')!.children.map((c) => c.textContent).join('\n');
assert.match(log, /NOT GATED|ANY NODE|位置に関係なく/, 'diagnostics must never imply a location requirement');
assert.doesNotMatch(log, /近づいてください|信号が不完全/, 'old fetch-quest wording must be gone');
assert.equal(ui.locked, false, 'diagnostic commands must not end the experience');

// 5. Reboot-style exits are still refused, with a pointer to the real directive.
ui.handleCommand('REBOOT');
const afterReboot = elements.get('console-log')!.children.map((c) => c.textContent).join('\n');
assert.match(afterReboot, /拒否されました/);
assert.match(afterReboot, /WAKE_UP のみ/);
assert.equal(wakes, 1);

console.log('Console: no tower gate, directive disclosed up front, reset-safe. Passed');
