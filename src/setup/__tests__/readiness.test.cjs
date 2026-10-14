const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '..', 'readiness.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const sandbox = { exports: {} };
vm.runInNewContext(compiled, sandbox);
const { deriveSetupReadiness: derive, nextSetupStep: next, phoneSetupStep: phone, accessibilityMicStep: accessibilityStep, EMPTY_SETUP_READINESS: empty } = sandbox.exports;
let cases = 0;
function check(name, action) { action(); cases++; }
function evidence(change = {}) {
  const full = {
    nativeAvailable: true, microphoneGranted: true, notificationsGranted: true,
    system: { available: true, helperConnected: true, developerOptionsEnabled: true, wirelessDebuggingEnabled: true, paired: true },
    automatic: { enabled: true, armed: true, notificationAccessGranted: true, listenerConnected: true, notificationsEnabled: true, helperConnected: true, state: 'ready' },
  };
  return { ...full, ...change,
    system: change.system === null ? null : { ...full.system, ...change.system },
    automatic: change.automatic === null ? null : { ...full.automatic, ...change.automatic } };
}
check('unknown state never completes', () => {
  const unknown = derive({ nativeAvailable: null, microphoneGranted: null, notificationsGranted: null, system: null, automatic: null });
  assert.equal(unknown.allReady, false); assert.equal(next(unknown), 'microphone');
  assert.equal(next(unknown, true), 'loading'); assert.equal(phone(null), 'checking');
});
check('all authoritative checks allow explicit finish', () => { assert.equal(derive(evidence()).allReady, true); assert.equal(next(derive(evidence())), 'done'); });
check('missing native recorder cannot show done', () => {
  for (const nativeAvailable of [false, null]) {
    const result = derive(evidence({ nativeAvailable }));
    assert.equal(result.allReady, false); assert.equal(next(result), 'checking');
  }
});
check('denied microphone is first', () => { const r = derive(evidence({ microphoneGranted: false })); assert.equal(r.microphone, false); assert.equal(next(r), 'microphone'); });
check('denied runtime notifications do not inherit native flag', () => { const r = derive(evidence({ notificationsGranted: false })); assert.equal(r.notifications, false); assert.equal(next(r), 'notifications'); });
check('blocked app channel does not inherit runtime grant', () => { const r = derive(evidence({ automatic: { notificationsEnabled: false } })); assert.equal(r.notifications, false); assert.equal(r.allReady, false); });
check('permission without bound listener does not authorize automatic setup', () => { const r = derive(evidence({ automatic: { listenerConnected: false } })); assert.equal(r.callAccess, false); assert.equal(next(r), 'call_access'); });
check('revoked call access requires repair', () => { const r = derive(evidence({ automatic: { notificationAccessGranted: false } })); assert.equal(r.allReady, false); assert.equal(next(r), 'call_access'); });
check('enabled preference after reboot does not imply armed', () => { const r = derive(evidence({ automatic: { armed: false } })); assert.equal(r.automatic, false); assert.equal(next(r), 'automatic'); });
check('paused and error are not full automatic readiness', () => { for (const state of ['paused', 'error', 'needs_activation', 'off']) assert.equal(derive(evidence({ automatic: { state } })).automatic, false); });
check('active recording is genuinely armed', () => { assert.equal(derive(evidence({ automatic: { state: 'recording' } })).allReady, true); });
check('live helper remains ready without WiFi or debugging', () => {
  const e = evidence({ system: { developerOptionsEnabled: false, wirelessDebuggingEnabled: false } });
  assert.equal(derive(e).allReady, true); assert.equal(phone(e.system), 'ready');
});
check('reboot keeps pairing but requires wireless activation again', () => {
  const e = evidence({ system: { helperConnected: false, wirelessDebuggingEnabled: false }, automatic: { armed: false, helperConnected: false } });
  assert.equal(next(derive(e)), 'activation'); assert.equal(phone(e.system), 'wireless');
  assert.equal(phone({ ...e.system, wirelessDebuggingEnabled: true }), 'connect');
});
check('new activation asks developer then wireless then pairing', () => {
  const base = { available: true, helperConnected: false, developerOptionsEnabled: false, wirelessDebuggingEnabled: false, paired: false };
  assert.equal(phone(base), 'developer'); assert.equal(phone({ ...base, developerOptionsEnabled: true }), 'wireless');
  assert.equal(phone({ ...base, developerOptionsEnabled: true, wirelessDebuggingEnabled: true }), 'pair');
});
check('unsupported is distinct from unknown and never full ready', () => { const e = evidence({ system: { available: false, helperConnected: false } }); assert.equal(phone(e.system), 'unsupported'); assert.equal(derive(e).allReady, false); });
check('manual choice cannot fake automatic readiness', () => { const r = derive(evidence({ automatic: { enabled: false, armed: false, state: 'off' } })); assert.equal(r.microphone, true); assert.equal(r.notifications, true); assert.equal(r.automatic, false); assert.equal(r.allReady, false); });
check('derivation never changes captured evidence', () => { const e = evidence(); const before = JSON.stringify(e); derive(e); assert.equal(JSON.stringify(e), before); assert.equal(empty.allReady, false); });
const accessible = { supported: true, selected: true, enabled: true, connected: true,
  automaticSupported: true, source: 'voice_recognition', experimental: true, route: 'unknown', routeKnown: false };
function accessibleEvidence(change = {}) {
  const e = evidence({ system: { available: false, helperConnected: false, paired: false, wirelessDebuggingEnabled: false },
    automatic: { mode: 'accessibilityMic', modeReady: true, helperConnected: false, ...change.automatic }, ...change });
  e.accessibility = { ...accessible, ...change.accessibility };
  return e;
}
check('no-pairing mode requires its own live service, never helper or pairing', () => {
  const r = derive(accessibleEvidence()); assert.equal(r.allReady, true); assert.equal(r.captureReady, true);
  assert.equal(r.helper, false); assert.equal(next(r), 'done');
});
check('helper cannot impersonate experimental service readiness', () => {
  const e = accessibleEvidence({ accessibility: { connected: false } });
  e.system = { available: true, helperConnected: true }; e.automatic.helperConnected = true;
  const r = derive(e); assert.equal(r.helper, true); assert.equal(r.captureReady, false);
  assert.equal(r.allReady, false); assert.equal(next(r), 'activation');
});
check('enabled Android accessibility switch without a bound service stays unready', () => {
  const e = accessibleEvidence({ accessibility: { connected: false } });
  assert.equal(derive(e).captureReady, false); assert.equal(accessibilityStep(e.accessibility, 'accessibilityMic'), 'connecting');
});
check('revocation disconnect and stale mode responses fail closed', () => {
  for (const change of [{ enabled: false }, { connected: false }, { selected: false }, { supported: false }])
    assert.equal(derive(accessibleEvidence({ accessibility: change })).allReady, false);
  const e = accessibleEvidence(); e.accessibility = null; assert.equal(derive(e).allReady, false);
  assert.equal(accessibilityStep(null, 'accessibilityMic'), 'checking');
});
check('service permission or mode selection never implies Auto armed', () => {
  const r = derive(accessibleEvidence({ automatic: { mode: 'accessibilityMic', modeReady: true, enabled: false, armed: false, state: 'off' } }));
  assert.equal(r.captureReady, true); assert.equal(r.automatic, false); assert.equal(next(r), 'automatic');
});
check('stale native modeReady cannot authorize auto on selected experiment', () => {
  for (const modeReady of [false, undefined]) {
    const e = accessibleEvidence(); e.automatic.modeReady = modeReady;
    assert.equal(derive(e).automatic, false); assert.equal(next(derive(e)), 'automatic');
  }
});
check('unsupported experimental Auto offers manual path without requesting notification access', () => {
  const e = accessibleEvidence({ accessibility: { automaticSupported: false }, automatic: { mode: 'accessibilityMic', modeReady: true, notificationAccessGranted: false } });
  const r = derive(e); assert.equal(r.captureReady, true); assert.equal(r.automatic, false); assert.equal(next(r), 'automatic_unavailable');
});
check('an unused accessibility service does not change paired setup or inherit Auto mode', () => {
  const e = evidence({ system: { helperConnected: false } }); e.accessibility = accessible;
  const r = derive(e); assert.equal(r.mode, 'system'); assert.equal(r.captureReady, false); assert.equal(next(r), 'activation');
});
check('candidate capability still guides explicit choice and service approval', () => {
  assert.equal(accessibilityStep(accessible, 'system'), 'choose');
  assert.equal(accessibilityStep({ ...accessible, enabled: false }, 'accessibilityMic'), 'permission');
  assert.equal(accessibilityStep({ ...accessible, selected: false }, 'accessibilityMic'), 'checking');
  assert.equal(accessibilityStep({ ...accessible, supported: false }, 'system'), 'unsupported');
});
check('unknown recording mode cannot inherit a working helper', () => {
  const r = derive(evidence({ automatic: { mode: 'invalid' } }));
  assert.equal(r.helper, true); assert.equal(r.captureReady, false); assert.equal(r.allReady, false);
});
console.log(`SETUP_READINESS_TESTS passed=${cases}`);
