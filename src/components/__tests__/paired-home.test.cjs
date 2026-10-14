'use strict';
// Production Home TSX actions with synthetic React/context. No device or audio operations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { core } = require('../../i18n/__tests__/load-core.cjs')();
const compiled = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../../screens/HomeScreen.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function harness(overrides = {}) {
  let cursor = 0, listener, focusEntry, unmounted = false, lateWrites = 0;
  const slots = [], effects = [], calls = [], alerts = [];
  const appState = { currentState: 'active', addEventListener(name, callback) { listener = callback; return { remove() { listener = null; } }; } };
  const recording = { isBusy: false, isRecording: false, error: null, recordingTime: '00:00',
    status: { source: 'microphone', audioMode: 0, isSilenced: false, silentForMs: 0, level: 0, usbConnected: true },
    autoRecordingStatus: { mode: 'system', enabled: false },
    systemAccessStatus: { available: true, helperConnected: true, paired: true, wirelessDebuggingEnabled: true, connecting: false },
    requestPermissions: async () => { calls.push('permission'); return true; },
    startRecording: async source => calls.push(['capture', source]),
    stopRecording: async () => { calls.push('stop'); return { status: 'captured', captureSource: 'microphone' }; },
    ...overrides };
  const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) { const index = cursor++; slots[index] ??= { value: initial }; return [slots[index].value,
      next => { if (unmounted) lateWrites++; slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useCallback: action => action,
    useEffect(action) { const index = cursor++; if (!slots[index]) { slots[index] = {}; effects.push(() => { slots[index].cleanup = action(); }); } },
  };
  const exported = {};
  vm.runInNewContext(compiled, { exports: exported, module: { exports: exported }, require(name) {
    if (name === 'react') return react;
    if (name === 'react-native') return { ...Object.fromEntries(['View', 'Text', 'TouchableOpacity', 'ScrollView'].map(key => [key, key])),
      AppState: appState, StyleSheet: { create: value => value }, Alert: { alert: (...args) => alerts.push(args) } };
    if (name === '@react-navigation/native') return { useNavigation: () => ({ navigate: route => calls.push(['navigate', route]) }),
      useFocusEffect(action) { if (!focusEntry) focusEntry = { action, cleanup: action() }; } };
    if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0 }) };
    if (name === '../context/RecordingContext') return { useRecording: () => recording };
    if (name === '../i18n') return { ...core, useLocalizedStyles: value => core.directionalStyles(value, core.getLanguage()) };
    if (name === '../components/RecordButton') return { __esModule: true, default: 'RecordButton' };
    if (name === '../components/AutoRecordingCard') return { __esModule: true, default: 'AutoRecordingCard' };
    if (name === '../components/OfflineRecoveryCard') return { __esModule: true, default: 'OfflineRecoveryCard' };
    if (name === '../components/Visuals') return { WaveMark: 'WaveMark', BottomNav: 'BottomNav' };
    if (name === '../theme') return { colors: {}, ui: Object.fromEntries(['screen', 'content', 'label', 'title', 'subtitle', 'body', 'card', 'warning'].map(key => [key, {}])) };
    throw Error(`Unexpected Home import ${name}`);
  } });
  return { calls, alerts, recording, lateWrites: () => lateWrites,
    render() { cursor = 0; const tree = exported.default(); while (effects.length) effects.shift()(); return tree; },
    blur() { focusEntry.cleanup?.(); focusEntry.cleanup = null; }, focus() { focusEntry.cleanup = focusEntry.action(); },
    background() { appState.currentState = 'background'; listener?.('background'); }, foreground() { appState.currentState = 'active'; listener?.('active'); },
    unmount() { unmounted = true; for (const slot of slots) slot.cleanup?.(); focusEntry.cleanup?.(); },
  };
}
function nodes(node) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(nodes); return [node, ...nodes(node.children)]; }
function text(node) { if (node == null || typeof node === 'boolean') return ''; if (typeof node === 'string') return node; if (typeof node === 'number') return String(node); if (Array.isArray(node)) return node.map(text).join(' '); return node.children.map(text).join(node.type === 'Text' ? '' : ' '); }
function radio(tree, key) { return nodes(tree).find(node => node.type === 'TouchableOpacity' && node.props.accessibilityRole === 'radio' && text(node) === core.t(key)); }
function record(tree) { return nodes(tree).find(node => node.type === 'RecordButton'); }
let passed = 0;
async function check(work) { await work(); passed++; }
async function main() {
  for (const language of ['he', 'en']) {
    core.activateLanguage(language);
    await check(async () => {
      const host = harness(), tree = host.render();
      const automatic = nodes(tree).find(node => node.type === 'AutoRecordingCard');
      assert.equal(automatic.props.compact, true); automatic.props.onShowDetails();
      assert.deepEqual(host.calls, [['navigate', 'Setup']]); host.calls.length = 0;
      assert.equal(radio(tree, 'copy245').props.accessibilityState.selected, true);
      assert.ok(text(tree).includes(core.t('ordinaryMicCallHint'))); assert.deepEqual(host.calls, []); assert.deepEqual(host.alerts, []);
      record(tree).props.onPress(); assert.equal(host.alerts[0][0], core.t('copy236'));
      assert.equal(host.alerts[0][2][0].style, 'cancel'); assert.deepEqual(host.calls, []);
      host.alerts[0][2][1].onPress(); await flush(); assert.deepEqual(host.calls, ['permission', ['capture', 'microphone']]);
    });
    await check(async () => {
      const host = harness(); radio(host.render(), 'copy246').props.onPress(); const tree = host.render();
      assert.equal(radio(tree, 'copy246').props.accessibilityState.selected, true);
      assert.ok(!text(tree).includes(core.t('accessibilityMicLimits'))); assert.equal(host.calls.length, 0);
      record(tree).props.onPress(); assert.equal(host.alerts[0][0], core.t('copy235')); assert.deepEqual(host.calls, []);
      host.alerts[0][2][1].onPress(); host.alerts[0][2][1].onPress(); await flush();
      assert.deepEqual(host.calls, ['permission', ['capture', 'usb']]);
    });
    await check(async () => {
      const host = harness({ autoRecordingStatus: { mode: 'accessibilityMic', enabled: true } });
      radio(host.render(), 'copy246').props.onPress(); assert.deepEqual(host.calls, [['navigate', 'Setup']]);
      const tree = host.render(); assert.equal(record(tree).props.disabled, true);
      assert.ok(text(tree).includes(core.t('pairedSetupRestoreTitle'))); assert.ok(!text(tree).includes(core.t('copy241')));
      assert.equal(host.alerts.length, 0); assert.ok(!host.calls.includes('permission'));
      record(tree).props.onPress(); await flush(); assert.ok(!host.calls.some(call => call[0] === 'capture'));
    });
    await check(async () => {
      const host = harness({ autoRecordingStatus: { mode: 'accessibilityMic' } });
      record(host.render()).props.onPress(); host.alerts[0][2][1].onPress(); await flush();
      assert.deepEqual(host.calls, ['permission', ['capture', 'microphone']]);
    });
    await check(async () => {
      const host = harness(); radio(host.render(), 'copy246').props.onPress(); record(host.render()).props.onPress();
      host.recording.autoRecordingStatus = { mode: 'accessibilityMic' }; host.render();
      host.alerts[0][2][1].onPress(); await flush(); assert.deepEqual(host.calls, [['navigate', 'Setup']]);
    });
    await check(async () => {
      for (const change of [host => { host.blur(); host.focus(); }, host => { host.background(); host.foreground(); }, host => host.unmount(),
        host => { host.recording.isBusy = true; host.render(); }, host => { radio(host.render(), 'copy245').props.onPress(); host.render(); }]) {
        const host = harness(); radio(host.render(), 'copy246').props.onPress(); record(host.render()).props.onPress();
        change(host); host.alerts[0][2][1].onPress(); await flush(); assert.deepEqual(host.calls, []); assert.equal(host.lateWrites(), 0);
      }
    });
    await check(async () => {
      const pending = deferred(), host = harness({ requestPermissions: () => { host.calls.push('permission'); return pending.promise; } });
      radio(host.render(), 'copy246').props.onPress(); record(host.render()).props.onPress(); host.alerts[0][2][1].onPress();
      host.recording.autoRecordingStatus = { mode: 'accessibilityMic' }; host.render(); pending.resolve(true); await flush();
      assert.deepEqual(host.calls, ['permission', ['navigate', 'Setup']]);
    });
    await check(async () => {
      const host = harness({ startRecording: async () => { throw new Error(core.t('pairedSetupRestoreHelp')); } });
      radio(host.render(), 'copy246').props.onPress(); record(host.render()).props.onPress(); host.alerts[0][2][1].onPress(); await flush();
      assert.deepEqual(host.calls, ['permission', ['navigate', 'Setup']]); assert.equal(host.alerts.length, 1);
    });
    await check(async () => {
      const host = harness({ isRecording: true, autoRecordingStatus: { mode: 'accessibilityMic' },
        status: { source: 'accessibilityMic', audioMode: 3, level: 0 },
        stopRecording: async () => { host.calls.push('stop'); return { status: 'captured', captureSource: 'accessibilityMic' }; } });
      const tree = host.render(); assert.equal(record(tree).props.disabled, false); radio(tree, 'copy245').props.onPress();
      record(tree).props.onPress(); await flush(); assert.deepEqual(host.calls, ['stop']);
      assert.ok(host.alerts[0][1].includes(core.t('accessibilityMicSaved')));
    });
    await check(() => {
      const host = harness({ systemAccessStatus: { available: true, paired: false, helperConnected: false, connecting: false },
        status: { source: 'microphone', audioMode: 0, usbConnected: false } });
      radio(host.render(), 'copy246').props.onPress(); const tree = host.render(); assert.equal(record(tree).props.disabled, true);
      record(tree).props.onPress(); assert.deepEqual(host.calls, []); assert.deepEqual(host.alerts, []);
    });
    await check(async () => {
      const host = harness({ systemAccessStatus: { available: true, paired: true, helperConnected: false,
        wirelessDebuggingEnabled: false, connecting: false, offlineRecovery: { supported: true, enabled: true,
          secureSettingsGranted: true, nearbyWifiGranted: true, running: false } },
        status: { source: 'microphone', audioMode: 0, usbConnected: false } });
      radio(host.render(), 'copy246').props.onPress(); const tree = host.render();
      assert.equal(record(tree).props.disabled, false); assert.deepEqual(host.calls, []);
      assert.ok(!text(tree).includes(core.t('copy241'))); // Prepared is not yet connected.
      record(tree).props.onPress(); host.alerts[0][2][1].onPress(); await flush();
      assert.deepEqual(host.calls, ['permission', ['capture', 'usb']]);
    });
    await check(() => {
      for (const missing of ['supported', 'enabled', 'secureSettingsGranted', 'nearbyWifiGranted']) {
        const offline = { supported: true, enabled: true, secureSettingsGranted: true, nearbyWifiGranted: true, running: false,
          [missing]: false };
        const host = harness({ systemAccessStatus: { available: true, paired: true, helperConnected: false,
          wirelessDebuggingEnabled: false, connecting: false, offlineRecovery: offline },
          status: { source: 'microphone', audioMode: 0, usbConnected: false } });
        radio(host.render(), 'copy246').props.onPress(); const tree = host.render();
        assert.equal(record(tree).props.disabled, true); record(tree).props.onPress();
        assert.deepEqual(host.calls, []); assert.deepEqual(host.alerts, []);
      }
    });
    await check(() => {
      const host = harness({ isBusy: true, systemAccessStatus: { available: true, paired: true, helperConnected: false,
        wirelessDebuggingEnabled: false, connecting: false, offlineRecovery: { running: true } } });
      const tree = host.render(), recovery = nodes(tree).find(node => node.type === 'OfflineRecoveryCard');
      assert.equal(recovery.props.compact, true); assert.equal(record(tree).props.disabled, true);
      recovery.props.onOpenSetup(); assert.deepEqual(host.calls, []);
    });
  }
  console.log(`Paired Home: ${passed} checks passed (production TSX; no device/audio acceptance).`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
