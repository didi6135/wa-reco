'use strict';
// Production-transpiled bridge, provider and hook checks. No device/provider access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { core } = require('../../i18n/__tests__/load-core.cjs')();
const compile = relative => ts.transpileModule(fs.readFileSync(path.resolve(__dirname, relative), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function appState(initial = 'active') {
  const listeners = new Map();
  return { currentState: initial,
    addEventListener(name, callback) { const set = listeners.get(name) || new Set(); set.add(callback); listeners.set(name, set); return { remove: () => set.delete(callback) }; },
    emit(name, state) { if (name === 'change') this.currentState = state; for (const cb of [...listeners.get(name) || []]) cb(state); },
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0) };
}
function bridgeHarness(native, platform = { OS: 'android', Version: 36 }) {
  const exported = {};
  vm.runInNewContext(compile('../../services/NativeRecorder.ts'), { exports: exported, module: { exports: exported }, require(name) {
    if (name === 'react-native') return { NativeModules: { CallRecorder: native }, Platform: platform };
    if (name === '../i18n/core') return core;
    throw Error(`Unexpected bridge import ${name}`);
  } });
  return exported;
}
function providerHarness(controls = {}) {
  const calls = [], slots = [];
  let cursor = 0;
  const state = appState(controls.background ? 'background' : 'active');
  const recorder = { isRecording: false, elapsedMs: 0, level: 0, usbConnected: false, source: 'microphone',
    outputLevel: 0, microphoneLevel: 0, isSilenced: false, silentForMs: 0, audioMode: 0, error: null, ...controls.recorder };
  const automatic = { mode: 'system', enabled: true, armed: false, notificationAccessGranted: true,
    notificationsEnabled: true, listenerConnected: true, helperConnected: false, state: 'needs_activation', error: null, ...controls.automatic };
  const system = { available: true, paired: true, wirelessDebuggingEnabled: false, helperConnected: false,
    connecting: false, error: null, offlineRecovery: { supported: true, enabled: true,
      secureSettingsGranted: true, nearbyWifiGranted: true, running: false, stage: 'idle' }, ...controls.system };
  const native = {
    getAutoRecordingStatus: async () => ({ ...automatic }),
    getStatus: async () => ({ ...recorder }),
    getSystemAccessStatus: async () => ({ ...system }),
    connectSystemRecorderOffline: async () => { calls.push('activate'); if (controls.activation) await controls.activation.promise;
      system.helperConnected = true; recorder.usbConnected = true; },
    connectSystemRecorder: async () => { calls.push('ordinary-activate');
      system.helperConnected = true; recorder.usbConnected = true; },
    cancelOfflineRecovery: async () => calls.push('cancel'),
    resumeAutoRecordingAfterRestart: async () => { calls.push('guarded-arm'); if (controls.armFailure) throw controls.armFailure;
      assert.equal(automatic.enabled, true); assert.equal(automatic.mode, 'system'); automatic.armed = true; },
    setAutoRecordingEnabled: async value => { calls.push(['manual-auto', value]); automatic.enabled = value; },
    ...controls.native,
  };
  const bridge = bridgeHarness(native);
  const react = { createContext: () => ({ Provider: 'Provider' }), createElement: (type, props) => ({ type, props }),
    useState(initial) { const index = cursor++; slots[index] ??= { value: initial }; return [slots[index].value, value => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; }]; },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useCallback: value => value, useEffect() {} };
  const exported = {};
  vm.runInNewContext(compile('../../context/RecordingContext.tsx'), { exports: exported, module: { exports: exported },
    setTimeout, clearTimeout, setInterval, clearInterval, require(name) {
      if (name === 'react') return react;
      if (name === 'react-native') return { AppState: state, Platform: { OS: 'android', Version: 36 },
        PermissionsAndroid: { PERMISSIONS: { POST_NOTIFICATIONS: 'notifications' }, check: async () => controls.notifications !== false } };
      if (name === '../i18n/core') return core;
      if (name === '../services/NativeRecorder') return bridge;
      if (name === '@react-native-async-storage/async-storage') return { getItem: async () => null };
      if (name === '../utils/permissions') return { checkPermissions: async () => controls.microphone !== false,
        requestPermissions: async () => { calls.push('request-microphone'); return true; },
        requestNotificationPermission: async () => { calls.push('request-notifications'); return true; } };
      throw Error(`Unexpected provider import ${name}`);
    } });
  return { calls, state, automatic, recorder, system, native,
    render() { cursor = 0; return exported.RecordingProvider({ children: null }).props.value; } };
}
function hookHarness(controls = {}) {
  const calls = [], slots = [], effects = [], timers = new Map();
  const state = controls.state || appState();
  let cursor = 0, timerId = 0, ready = controls.ready ?? true;
  let context = { isBusy: false, resumeAutoRecordingAfterRestart: async () => calls.push('resume'), ...controls.context };
  const native = { consumeRestartResumeRequest: async () => { calls.push('probe'); return controls.requested ?? false; },
    resumeAutoRecordingAfterRestart: async () => {}, ...controls.native };
  const bridge = bridgeHarness(native);
  const react = {
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useEffect(effect, deps) { const index = cursor++; const old = slots[index];
      if (old && old.deps.every((value, i) => value === deps[i])) return;
      old?.cleanup?.(); slots[index] = { deps }; effects.push(() => { slots[index].cleanup = effect(); }); },
  };
  const exported = {};
  vm.runInNewContext(compile('../useRestartResume.ts'), { exports: exported, module: { exports: exported },
    setInterval(callback) { const id = ++timerId; timers.set(id, callback); return id; }, clearInterval: id => timers.delete(id),
    require(name) {
      if (name === 'react') return react;
      if (name === 'react-native') return { AppState: state };
      if (name === '../context/RecordingContext') return { useRecording: () => context };
      if (name === '../services/NativeRecorder') return bridge;
      throw Error(`Unexpected hook import ${name}`);
    } });
  const openSetup = () => calls.push('Setup');
  return { calls, state, native, timers,
    render(next = {}) { ready = next.ready ?? ready; context = { ...context, ...next.context }; cursor = 0;
      exported.useRestartResume(ready, openSetup); while (effects.length) effects.shift()(); },
    tick() { for (const callback of [...timers.values()]) callback(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
let passed = 0;
async function check(name, action) { await action(); passed++; }
async function main() {
  await check('bridge missing native and non Android are inert', async () => {
    for (const [native, platform] of [[undefined, { OS: 'android' }], [{}, { OS: 'android' }],
      [{ consumeRestartResumeRequest: async () => true }, { OS: 'android' }], [{}, { OS: 'ios' }]])
      assert.equal(await bridgeHarness(native, platform).NativeRecorder.consumeRestartResumeRequest(), false);
  });
  await check('bridge accepts literal true only', async () => {
    for (const value of [undefined, null, 1, 'true', {}, false, true]) {
      const native = { consumeRestartResumeRequest: async () => value, resumeAutoRecordingAfterRestart: async () => {} };
      assert.equal(await bridgeHarness(native).NativeRecorder.consumeRestartResumeRequest(), value === true);
    }
  });
  await check('ordinary launch and subsequent read-only probes never resume', async () => {
    const h = hookHarness(); h.render(); await flush(); h.tick(); await flush();
    assert.deepEqual(h.calls, ['probe', 'probe']); h.unmount(); assert.equal(h.state.listenerCount(), 0);
  });
  await check('setup/navigation load defers genuine tap; idle foreground consumes once', async () => {
    let pending = true;
    const h = hookHarness({ ready: false, native: { consumeRestartResumeRequest: async () => { const result = pending; pending = false; return result; } } });
    h.render(); await flush(); assert.deepEqual(h.calls, []);
    h.render({ ready: true }); await flush(); h.tick(); await flush();
    assert.deepEqual(h.calls, ['Setup', 'resume']); h.unmount();
  });
  await check('warm active notification after initial false opens Setup and resumes', async () => {
    const h = hookHarness(); h.render(); await flush();
    let pending = true; h.native.consumeRestartResumeRequest = async () => { const result = pending; pending = false; return result; };
    h.tick(); await flush(); h.tick(); await flush();
    assert.deepEqual(h.calls, ['probe', 'Setup', 'resume']); h.unmount();
  });
  await check('busy blocks probe until idle and cannot trigger ordinary launch', async () => {
    const h = hookHarness({ context: { isBusy: true } }); h.render(); await flush(); assert.deepEqual(h.calls, []);
    h.render({ context: { isBusy: false } }); await flush(); assert.deepEqual(h.calls, ['probe']); h.unmount();
  });
  await check('busy transition before action settles keeps future warm tap observable', async () => {
    const wait = deferred(); let pending = true;
    const h = hookHarness({ native: { consumeRestartResumeRequest: async () => { const result = pending; pending = false; return result; } },
      context: { resumeAutoRecordingAfterRestart: async () => { h.calls.push('resume'); await wait.promise; } } });
    h.render(); await flush(); assert.deepEqual(h.calls, ['Setup', 'resume']);
    h.render({ context: { isBusy: true } }); h.render({ context: { isBusy: false } });
    assert.equal(h.timers.size, 1); wait.resolve(); await flush(); pending = true;
    h.tick(); await flush(); assert.deepEqual(h.calls, ['Setup', 'resume', 'Setup', 'resume']); h.unmount();
  });
  await check('overlapping interval/event probes consume at most one request', async () => {
    const wait = deferred(); const h = hookHarness({ native: { consumeRestartResumeRequest: () => { h.calls.push('probe'); return wait.promise; } } });
    h.render(); h.tick(); h.state.emit('focus'); assert.deepEqual(h.calls, ['probe']);
    wait.resolve(true); await flush(); assert.deepEqual(h.calls, ['probe', 'Setup', 'resume']); h.unmount();
  });
  await check('background then foreground before pending promise settles invalidates tap', async () => {
    const wait = deferred(); const h = hookHarness({ native: { consumeRestartResumeRequest: () => wait.promise } });
    h.render(); h.state.emit('change', 'background'); assert.equal(h.timers.size, 0); h.state.emit('change', 'active');
    wait.resolve(true); await flush(); assert.deepEqual(h.calls, []); h.unmount();
  });
  await check('blur and unmount invalidate pending consume with no late navigation', async () => {
    for (const kind of ['blur', 'unmount']) { const wait = deferred(); const h = hookHarness({ native: { consumeRestartResumeRequest: () => wait.promise } });
      h.render(); if (kind === 'blur') { h.state.emit('blur'); h.state.emit('focus'); } else h.unmount();
      wait.resolve(true); await flush(); assert.deepEqual(h.calls, []); h.unmount(); }
  });
  await check('native consume failure and restoration failure never retry an action', async () => {
    const failedProbe = hookHarness({ native: { consumeRestartResumeRequest: async () => { throw Error('closed'); } } });
    failedProbe.render(); await flush(); failedProbe.tick(); await flush(); assert.deepEqual(failedProbe.calls, []); failedProbe.unmount();
    let pending = true; const h = hookHarness({ native: { consumeRestartResumeRequest: async () => { const result = pending; pending = false; return result; } },
      context: { resumeAutoRecordingAfterRestart: async () => { h.calls.push('resume-failed'); throw Error('repair'); } } });
    h.render(); await flush(); h.state.emit('change', 'background'); h.state.emit('change', 'active'); h.tick(); await flush();
    assert.deepEqual(h.calls, ['Setup', 'resume-failed']); h.unmount();
  });
  for (const language of ['he', 'en']) {
    core.activateLanguage(language);
    await check(`${language}: prior enabled prepared helper restores via guarded native arm without requesting grants`, async () => {
      const h = providerHarness(); await h.render().resumeAutoRecordingAfterRestart();
      assert.deepEqual(h.calls, ['activate', 'guarded-arm']); assert.equal(h.automatic.armed, true); assert.equal(h.state.listenerCount(), 0);
    });
    await check(`${language}: live helper needs neither recovery preparation nor WiFi`, async () => {
      const h = providerHarness({ system: { helperConnected: true, offlineRecovery: undefined }, recorder: { usbConnected: true } });
      await h.render().resumeAutoRecordingAfterRestart(); assert.deepEqual(h.calls, ['guarded-arm']);
    });
    await check(`${language}: ordinary paired activation remains available without offline preparation`, async () => {
      const h = providerHarness({ system: { wirelessDebuggingEnabled: true, offlineRecovery: undefined } });
      await h.render().resumeAutoRecordingAfterRestart();
      assert.deepEqual(h.calls, ['ordinary-activate', 'guarded-arm']);
    });
    await check(`${language}: disabled or already armed cannot restore`, async () => {
      for (const automatic of [{ enabled: false }, { armed: true }]) { const h = providerHarness({ automatic });
        await h.render().resumeAutoRecordingAfterRestart(); assert.deepEqual(h.calls, []); }
    });
    await check(`${language}: missing grants, active call, capture, wrong route or unprepared recovery fail visibly`, async () => {
      for (const controls of [{ microphone: false }, { notifications: false }, { automatic: { notificationsEnabled: false } },
        { automatic: { notificationAccessGranted: false } }, { automatic: { mode: 'accessibilityMic' } },
        { recorder: { audioMode: 3 } }, { recorder: { isRecording: true } }, { system: { offlineRecovery: undefined } }]) {
        const h = providerHarness(controls); await assert.rejects(h.render().resumeAutoRecordingAfterRestart());
        assert.deepEqual(h.calls, []); assert.ok(h.render().error); assert.equal(h.state.listenerCount(), 0);
      }
    });
    await check(`${language}: deferred helper followed by disable or mode change never arms`, async () => {
      for (const change of [h => { h.automatic.enabled = false; }, h => { h.automatic.mode = 'accessibilityMic'; }]) {
        const activation = deferred(), h = providerHarness({ activation }); const pending = h.render().resumeAutoRecordingAfterRestart();
        const outcome = pending.catch(() => undefined); await flush(); assert.deepEqual(h.calls, ['activate']); change(h); activation.resolve(); await outcome;
        assert.deepEqual(h.calls, ['activate']); assert.equal(h.automatic.armed, false);
      }
    });
    await check(`${language}: cancel after deferred helper revokes late arm`, async () => {
      const activation = deferred(), h = providerHarness({ activation }); const value = h.render();
      const pending = value.resumeAutoRecordingAfterRestart(); const rejected = assert.rejects(pending);
      await flush(); await value.cancelOfflineRecovery(); activation.resolve(); await rejected;
      assert.deepEqual(h.calls, ['activate', 'cancel']); assert.equal(h.automatic.armed, false);
    });
    await check(`${language}: any foreground loss remains canceled even after returning active`, async () => {
      for (const event of ['change', 'blur']) {
        const activation = deferred(), h = providerHarness({ activation }); const pending = h.render().resumeAutoRecordingAfterRestart();
        const rejected = assert.rejects(pending); await flush(); h.state.emit(event, 'background'); h.state.emit('change', 'active'); h.state.emit('focus');
        activation.resolve(); await rejected; assert.deepEqual(h.calls, ['activate']);
      }
    });
    await check(`${language}: call/permission changed during helper restoration prevents late arm`, async () => {
      for (const change of [h => { h.recorder.audioMode = 3; }, h => { h.recorder.isRecording = true; }, h => { h.automatic.notificationsEnabled = false; }]) {
        const activation = deferred(), h = providerHarness({ activation }); const pending = h.render().resumeAutoRecordingAfterRestart();
        const rejected = assert.rejects(pending); await flush(); change(h); activation.resolve(); await rejected; assert.deepEqual(h.calls, ['activate']);
      }
    });
    await check(`${language}: revoked native authority fails visibly without manual enable fallback`, async () => {
      for (const code of ['RESTART_RESUME_UNAVAILABLE', 'RESTART_RESUME_REVOKED']) {
        const h = providerHarness({ armFailure: Object.assign(Error('private native detail'), { code }) });
        await assert.rejects(h.render().resumeAutoRecordingAfterRestart(), error => error.code === code && error.message === core.t('activationCancelled'));
        assert.deepEqual(h.calls, ['activate', 'guarded-arm']); assert.equal(h.render().error, core.t('activationCancelled'));
      }
    });
    await check(`${language}: concurrent resume is refused while first action owns busy`, async () => {
      const activation = deferred(), h = providerHarness({ activation }), value = h.render(); const pending = value.resumeAutoRecordingAfterRestart();
      await flush(); await assert.rejects(value.resumeAutoRecordingAfterRestart()); activation.resolve(); await pending;
      assert.deepEqual(h.calls, ['activate', 'guarded-arm']);
    });
  }
  console.log(`restart resume: ${passed} checks passed`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
