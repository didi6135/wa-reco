'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const output = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../connectionFlow.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: output });
const { setupConnectionFlow: flow, setupInitialRoute: initialRoute, setupActionAllowed: allowed } = output;
let passed = 0;
function check(name, work) { work(); passed++; }
check('fresh system installation goes directly to existing permissions and pairing', () => {
  const input = { loading: false, mode: 'system' }; const before = JSON.stringify(input);
  assert.equal(flow(input), 'system'); assert.equal(JSON.stringify(input), before);
});
check('saved experimental selection requires explicit restoration regardless service capability', () => {
  assert.equal(flow({ loading: false, mode: 'accessibilityMic' }), 'restore');
});
check('loading and malformed mode evidence cannot advance', () => {
  assert.equal(flow({ loading: true, mode: 'accessibilityMic' }), 'loading');
  assert.equal(flow({ loading: false, mode: undefined }), 'checking');
  assert.equal(flow({ loading: false, mode: 'invalid' }), 'checking');
});
check('completed paired system installs start at Home', () => assert.equal(initialRoute(true, 'system'), 'Home'));
check('fresh and completed legacy selections start at Setup', () => {
  assert.equal(initialRoute(false, 'system'), 'Setup');
  assert.equal(initialRoute(false, 'accessibilityMic'), 'Setup');
  assert.equal(initialRoute(true, 'accessibilityMic'), 'Setup');
  assert.equal(initialRoute(true, 'invalid'), 'Setup');
});
const current = { mounted: true, focused: true, active: true, generation: 2, expectedGeneration: 2,
  busy: false, recording: false, audioMode: 0, connecting: false, recovering: false };
check('fresh visible idle action is allowed', () => assert.equal(allowed(current), true));
check('busy capture call and preparation cannot restore mode or arm', () => {
  for (const input of [{ busy: true }, { recording: true }, { audioMode: 1 }, { audioMode: 2 }, { audioMode: 3 },
    { connecting: true }, { recovering: true }]) assert.equal(allowed({ ...current, ...input }), false);
});
check('consent cannot revive across blur background unmount or generation cancellation', () => {
  for (const input of [{ focused: false }, { active: false }, { mounted: false }, { generation: 3 }]) assert.equal(allowed({ ...current, ...input }), false);
});
check('read-only refresh can inspect an active call without changing recording', () => {
  assert.equal(allowed({ ...current, recording: true, audioMode: 3, connecting: true }, false), true);
  assert.equal(allowed({ ...current, focused: false }, false), false);
});
console.log(`connection flow: ${passed} checks passed`);
