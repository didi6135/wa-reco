'use strict';
// Actual guided-screen actions with controlled React state. No OS/device permissions or audio.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { core } = require('../../i18n/__tests__/load-core.cjs')();
function compile(file, jsx = false) { return ts.transpileModule(fs.readFileSync(path.resolve(__dirname, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    jsx: jsx ? ts.JsxEmit.React : undefined, esModuleInterop: true },
}).outputText; }
const readinessModule = {}, flowModule = {};
vm.runInNewContext(compile('../readiness.ts'), { exports: readinessModule });
vm.runInNewContext(compile('../connectionFlow.ts'), { exports: flowModule });
const available = { supported: true, selected: false, enabled: false, connected: false, automaticSupported: true };
const freshSystem = { available: true, connecting: false, paired: false, helperConnected: false, wirelessDebuggingEnabled: false };
const freshReady = { ...readinessModule.EMPTY_SETUP_READINESS };
const readyAccess = { ...available, selected: true, enabled: true, connected: true };
const accessReady = { ...freshReady, mode: 'accessibilityMic', microphone: true, notifications: true,
  captureReady: true, callAccess: true };
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function harness(options = {}) {
  let cursor = 0, unmounted = false, lateWrites = 0, listener, focusEntry;
  const slots = [], effects = [], calls = [], alerts = [];
  const appState = { currentState: 'active', addEventListener(name, callback) {
    listener = callback; return { remove() { listener = null; } };
  } };
  const recording = {
    accessibilityMicStatus: available, autoRecordingStatus: { mode: 'system', enabled: false, armed: false },
    systemAccessStatus: freshSystem, status: { audioMode: 0 }, isBusy: false, isRecording: false,
    enableAutoRecording: async () => calls.push('arm-auto'),
    openNotificationAccessSetup: async () => calls.push('call-access'),
    ...options.recording,
  };
  const setup = { loading: false, completed: false, readiness: freshReady, systemAccessStatus: freshSystem, setupError: null,
    refresh: async () => calls.push('refresh'), completeOnboarding: async () => calls.push('finish-auto'),
    completeManualOnboarding: async () => { calls.push('finish-manual-disarm'); recording.autoRecordingStatus = { ...recording.autoRecordingStatus, enabled: false, armed: false }; },
    ...options.setup,
  };
  recording.setRecordingMode = options.setRecordingMode || (async mode => {
    calls.push(['mode', mode]); recording.autoRecordingStatus = { ...recording.autoRecordingStatus, mode, enabled: false, armed: false };
    recording.accessibilityMicStatus = { ...recording.accessibilityMicStatus, selected: mode === 'accessibilityMic' };
    setup.readiness = { ...setup.readiness, mode, captureReady: false, automatic: false, allReady: false };
  });
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) { const index = cursor++; slots[index] ??= { value: initial };
      return [slots[index].value, next => { if (unmounted) lateWrites++; slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
    useRef(value) { const index = cursor++; slots[index] ??= { current: value }; return slots[index]; },
    useCallback: action => action,
    useEffect(action) { const index = cursor++; if (!slots[index]) { slots[index] = {}; effects.push(() => { slots[index].cleanup = action(); }); } },
  };
  const exported = {};
  vm.runInNewContext(compile('../../screens/SetupScreen.tsx', true), {
    exports: exported, module: { exports: exported }, require(name) {
      if (name === 'react') return react;
      if (name === 'react-native') return { ...Object.fromEntries(['View', 'Text', 'ScrollView', 'TouchableOpacity', 'ActivityIndicator'].map(key => [key, key])),
        AppState: appState, Platform: { OS: 'android', Version: options.sdk ?? 36 }, StyleSheet: { create: value => value },
        Alert: { alert: (...args) => alerts.push(args) }, Linking: { openSettings: async () => calls.push('app-settings') },
        PermissionsAndroid: { PERMISSIONS: { RECORD_AUDIO: 'mic', POST_NOTIFICATIONS: 'notifications' },
          RESULTS: { GRANTED: 'granted', NEVER_ASK_AGAIN: 'blocked' }, check: async () => false,
          request: async permission => { calls.push(['permission', permission]); return 'granted'; } } };
      if (name === '@react-navigation/native') return { useNavigation: () => ({
        reset: value => calls.push(['home', value.routes[0].name]), canGoBack: () => true, goBack() {}, navigate() {},
      }), useFocusEffect(action) { if (!focusEntry) focusEntry = { action, cleanup: action() }; } };
      if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
      if (name === '../i18n') return { ...core, useLocalizedStyles: value => core.directionalStyles(value, core.getLanguage()) };
      if (name === '../context/RecordingContext') return { useRecording: () => recording };
      if (name === '../setup/SetupContext') return { useSetup: () => setup };
      if (name === '../setup/readiness') return readinessModule;
      if (name === '../setup/connectionFlow') return flowModule;
      if (name === '../utils/permissions') return { requestNotificationPermission: async () => { calls.push(['permission', 'notifications']); return true; } };
      if (name === '../components/AccessibilityMicCard') return { __esModule: true, default: 'AccessibilityCard' };
      if (name === '../components/SystemSetupWizard') return { __esModule: true, default: 'SystemWizard' };
      if (name === '../components/OfflineRecoveryCard') return { __esModule: true, default: 'RecoveryCard' };
      if (name === '../components/Visuals') return { WaveMark: 'WaveMark' };
      if (name === '../theme') return { colors: {}, ui: Object.fromEntries(['screen', 'primaryButton', 'primaryText',
        'secondaryButton', 'secondaryText', 'warning', 'disabled', 'body', 'subtitle', 'title', 'card'].map(key => [key, {}])) };
      throw Error(`Unexpected guided setup dependency ${name}`);
    },
  });
  return { recording, setup, calls, alerts, appState, lateWrites: () => lateWrites,
    render() { cursor = 0; const tree = exported.default(); while (effects.length) effects.shift()(); return tree; },
    blur() { focusEntry?.cleanup?.(); focusEntry.cleanup = null; },
    focus() { focusEntry.cleanup = focusEntry.action(); },
    background() { appState.currentState = 'background'; listener?.('background'); },
    foreground() { appState.currentState = 'active'; listener?.('active'); },
    unmount() { unmounted = true; for (const slot of slots) slot.cleanup?.(); focusEntry?.cleanup?.(); },
  };
}
function nodes(node) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(nodes); return [node, ...nodes(node.children)]; }
function text(node) { if (node == null || typeof node === 'boolean') return ''; if (typeof node === 'string') return node; if (Array.isArray(node)) return node.map(text).join(' '); return node.children.map(text).join(node.type === 'Text' ? '' : ' '); }
function button(tree, key) { return nodes(tree).find(node => node.type === 'TouchableOpacity' && text(node) === core.t(key)); }
function has(tree, type) { return nodes(tree).some(node => node.type === type); }
function chosen(options = {}) { return harness({ ...options, recording: { accessibilityMicStatus: readyAccess,
  autoRecordingStatus: { mode: 'accessibilityMic', enabled: false, armed: false }, ...options.recording },
  setup: { readiness: accessReady, ...options.setup } }); }
let passed = 0;
async function check(name, work) { await work(); passed++; }
async function main() {
  const pairedReady = { ...freshReady, microphone: true, notifications: true, captureReady: true,
    helper: true, callAccess: true };
  const pairedSystem = { ...freshSystem, paired: true, helperConnected: true };
  for (const language of ['he', 'en']) {
    core.activateLanguage(language);
    await check(`${language}: fresh system installation starts with microphone and has no experimental route choice`, () => {
      const host = harness(), tree = host.render();
      assert.ok(button(tree, 'copy359')); assert.equal(has(tree, 'AccessibilityCard'), false);
      for (const key of ['cleanSetupChooseAction', 'cleanSetupFallbackReveal', 'cleanSetupSimpleReveal', 'pairedSetupRestoreAction'])
        assert.equal(button(tree, key), undefined);
      assert.equal(host.calls.length, 0); assert.equal(host.alerts.length, 0);
    });
    await check(`${language}: reminder restoration failures appear in the existing live error area`, () => {
      const error = core.t('offlineRecoveryCallBusy');
      const host = harness({ recording: { error } });
      const live = nodes(host.render()).find(node => node.type === 'Text' && node.props.accessibilityLiveRegion === 'polite');
      assert.ok(live); assert.equal(text(live), error); assert.deepEqual(host.calls, []);
    });
    await check(`${language}: running restoration remains visible and cancellable during any setup step`, () => {
      for (const readiness of [freshReady, { ...freshReady, microphone: true, notifications: true }, pairedReady]) {
        const host = harness({ recording: { isBusy: true, systemAccessStatus: { ...freshSystem,
          offlineRecovery: { running: true } } }, setup: { readiness } });
        const tree = host.render(); assert.equal(has(tree, 'RecoveryCard'), true);
        assert.equal(has(tree, 'SystemWizard'), false); assert.deepEqual(host.calls, []);
      }
    });
    await check(`${language}: fresh activation and preserved paired activation show only the system wizard`, () => {
      for (const system of [freshSystem, pairedSystem]) {
        const host = harness({ recording: { systemAccessStatus: system }, setup: {
          completed: system.paired, systemAccessStatus: system,
          readiness: { ...freshReady, microphone: true, notifications: true } } });
        const tree = host.render(); assert.equal(has(tree, 'SystemWizard'), true);
        assert.equal(has(tree, 'AccessibilityCard'), false); assert.equal(host.calls.length, 0);
      }
    });
    await check(`${language}: each system permission requires a separate press and cannot arm Auto`, async () => {
      const host = harness(); button(host.render(), 'copy359').props.onPress(); await flush();
      assert.deepEqual(host.calls, [['permission', 'mic'], 'refresh']);
      host.setup.readiness = { ...host.setup.readiness, microphone: true };
      button(host.render(), 'copy363').props.onPress(); await flush();
      assert.deepEqual(host.calls, [['permission', 'mic'], 'refresh', ['permission', 'notifications'], 'refresh']);
    });
    await check(`${language}: completed legacy selection requires restore before permission Auto or manual completion`, () => {
      for (const capability of [null, available, readyAccess]) {
        const host = chosen({ recording: { accessibilityMicStatus: capability,
          autoRecordingStatus: { mode: 'accessibilityMic', enabled: true, armed: true } },
          setup: { completed: true, readiness: { ...accessReady, microphone: false, notifications: false,
            automatic: true, allReady: true } } });
        const tree = host.render(); assert.ok(button(tree, 'pairedSetupRestoreAction'));
        for (const key of ['copy359', 'copy363', 'copy372', 'copy373', 'copy377']) assert.equal(button(tree, key), undefined);
        assert.equal(has(tree, 'AccessibilityCard'), false); assert.equal(has(tree, 'SystemWizard'), false);
        assert.equal(host.calls.length, 0); assert.equal(host.alerts.length, 0);
      }
    });
    await check(`${language}: cancel and repeated status rendering preserve legacy mode Auto and pairing`, async () => {
      const host = chosen({ recording: { systemAccessStatus: pairedSystem,
        autoRecordingStatus: { mode: 'accessibilityMic', enabled: true, armed: true } } });
      button(host.render(), 'pairedSetupRestoreAction').props.onPress();
      assert.equal(host.alerts[0][1], core.t('accessibilityMicSystemConsent'));
      assert.equal(host.alerts[0][2][0].style, 'cancel'); host.render(); await flush();
      assert.equal(host.calls.length, 0); assert.equal(host.recording.autoRecordingStatus.mode, 'accessibilityMic');
      assert.equal(host.recording.autoRecordingStatus.armed, true); assert.equal(host.recording.systemAccessStatus.paired, true);
    });
    await check(`${language}: deliberate restore switches only system mode, disarms and retains pairing`, async () => {
      const host = chosen({ recording: { systemAccessStatus: pairedSystem,
        autoRecordingStatus: { mode: 'accessibilityMic', enabled: true, armed: true } },
        setup: { systemAccessStatus: pairedSystem } });
      button(host.render(), 'pairedSetupRestoreAction').props.onPress(); host.alerts[0][2][1].onPress(); await flush();
      assert.deepEqual(host.calls, [['mode', 'system'], 'refresh']);
      assert.equal(host.recording.autoRecordingStatus.enabled, false); assert.equal(host.recording.autoRecordingStatus.armed, false);
      assert.equal(host.recording.systemAccessStatus.paired, true); assert.equal(host.recording.systemAccessStatus.helperConnected, true);
      const tree = host.render(); assert.equal(has(tree, 'SystemWizard'), true);
      assert.equal(button(tree, 'pairedSetupRestoreAction'), undefined); assert.equal(has(tree, 'AccessibilityCard'), false);
    });
    await check(`${language}: delayed restore confirmation cannot revive after blur/refocus background/return or unmount`, async () => {
      for (const leave of [host => { host.blur(); host.focus(); }, host => { host.background(); host.foreground(); }, host => host.unmount()]) {
        const host = chosen(); button(host.render(), 'pairedSetupRestoreAction').props.onPress(); leave(host);
        host.alerts[0][2][1].onPress(); await flush(); assert.equal(host.calls.length, 0); assert.equal(host.lateWrites(), 0);
      }
    });
    await check(`${language}: fresh busy capture call and preparation block restore and its old confirmation`, async () => {
      for (const control of [{ isBusy: true }, { isRecording: true }, { status: { audioMode: 1 } }, { status: { audioMode: 2 } },
        { status: { audioMode: 3 } }, { systemAccessStatus: { ...freshSystem, connecting: true } },
        { systemAccessStatus: { ...freshSystem, offlineRecovery: { running: true } } }]) {
        const host = chosen(); button(host.render(), 'pairedSetupRestoreAction').props.onPress(); Object.assign(host.recording, control);
        const tree = host.render(); const target = button(tree, 'pairedSetupRestoreAction');
        assert.equal(target.props.disabled, true); host.alerts[0][2][1].onPress(); target.props.onPress(); await flush();
        assert.equal(host.calls.length, 0); assert.equal(host.alerts.length, 1);
      }
    });
    await check(`${language}: restore is single-flight and settlement cannot write after unmount`, async () => {
      const pending = deferred(); let requested = 0;
      const host = chosen({ setRecordingMode: value => { assert.equal(value, 'system'); requested++; return pending.promise; } });
      button(host.render(), 'pairedSetupRestoreAction').props.onPress(); const approve = host.alerts[0][2][1].onPress;
      approve(); approve(); assert.equal(requested, 1); host.unmount(); pending.resolve(); await flush();
      assert.equal(host.lateWrites(), 0); assert.equal(host.calls.length, 0);
    });
    await check(`${language}: failed restoration preserves legacy selection and does not advance or arm`, async () => {
      const host = chosen({ setRecordingMode: async () => { throw new Error('RECORDING_MODE_SAVE_FAILED'); } });
      button(host.render(), 'pairedSetupRestoreAction').props.onPress(); host.alerts[0][2][1].onPress(); await flush();
      assert.equal(host.calls.length, 0); assert.ok(button(host.render(), 'pairedSetupRestoreAction'));
      assert.equal(host.recording.autoRecordingStatus.mode, 'accessibilityMic'); assert.equal(has(host.render(), 'SystemWizard'), false);
    });
    await check(`${language}: system Auto off requires checkbox and a separate enable press`, async () => {
      const host = harness({ setup: { readiness: pairedReady, systemAccessStatus: pairedSystem },
        recording: { systemAccessStatus: pairedSystem } });
      const tree = host.render(), auto = button(tree, 'copy372'); assert.equal(auto.props.disabled, true);
      auto.props.onPress(); await flush(); assert.equal(host.calls.length, 0);
      const consent = nodes(tree).find(node => node.props.accessibilityRole === 'checkbox'); consent.props.onPress();
      assert.equal(host.calls.length, 0); const enabled = button(host.render(), 'copy372'); assert.equal(enabled.props.disabled, false);
      enabled.props.onPress(); await flush(); assert.deepEqual(host.calls, ['arm-auto', 'refresh']);
    });
    await check(`${language}: ready paired route keeps explicit manual finish, disarms and never arms`, async () => {
      const host = harness({ setup: { readiness: pairedReady }, recording: { systemAccessStatus: pairedSystem } });
      button(host.render(), 'copy377').props.onPress(); assert.equal(host.calls.length, 0);
      host.alerts[0][2][1].onPress(); await flush();
      assert.deepEqual(host.calls, ['finish-manual-disarm', 'refresh', ['home', 'Home']]);
      assert.equal(host.recording.autoRecordingStatus.armed, false);
    });
    await check(`${language}: retained Auto preference needs a separate rearm press after restart`, async () => {
      const host = harness({ setup: { readiness: pairedReady }, recording: { systemAccessStatus: pairedSystem,
        autoRecordingStatus: { mode: 'system', enabled: true, armed: false } } });
      const tree = host.render(); assert.equal(host.calls.length, 0); assert.ok(button(tree, 'copy373'));
      assert.equal(nodes(tree).some(node => node.props.accessibilityRole === 'checkbox'), false);
      button(tree, 'copy373').props.onPress(); await flush(); assert.deepEqual(host.calls, ['arm-auto', 'refresh']);
    });
    await check(`${language}: canceling manual finish preserves the current Auto choice and does not navigate`, async () => {
      const host = harness({ setup: { readiness: pairedReady }, recording: { systemAccessStatus: pairedSystem,
        autoRecordingStatus: { mode: 'system', enabled: true, armed: false } } });
      button(host.render(), 'copy377').props.onPress(); host.render(); await flush();
      assert.equal(host.calls.length, 0); assert.equal(host.recording.autoRecordingStatus.enabled, true);
    });
    await check(`${language}: older unsupported and fresh unpaired installs can explicitly finish ordinary microphone setup`, async () => {
      for (const sdk of [24, 29, 36]) {
        const system = { ...freshSystem, available: sdk >= 34 };
        const host = harness({ sdk, recording: { systemAccessStatus: system },
          setup: { systemAccessStatus: system, readiness: { ...freshReady, microphone: true, notifications: true } } });
        button(host.render(), 'copy377').props.onPress();
        assert.equal(host.calls.length, 0); assert.equal(host.alerts[0][1], core.t('copy345'));
        host.alerts[0][2][1].onPress(); await flush();
        assert.deepEqual(host.calls, ['finish-manual-disarm', 'refresh', ['home', 'Home']]);
        assert.equal(host.recording.autoRecordingStatus.enabled, false); assert.equal(host.recording.autoRecordingStatus.armed, false);
      }
    });
    await check(`${language}: legacy selection cannot bypass restoration with an ordinary microphone setup shortcut`, () => {
      const host = chosen({ setup: { completed: true, readiness: accessReady } });
      assert.equal(button(host.render(), 'copy377'), undefined); assert.ok(button(host.render(), 'pairedSetupRestoreAction'));
      assert.equal(host.calls.length, 0);
    });
    await check(`${language}: inconsistent independent mode observations display a check without restoration mutation`, () => {
      const host = chosen({ setup: { readiness: { ...accessReady, mode: 'system' } } }); const tree = host.render();
      assert.equal(has(tree, 'SystemWizard'), false); assert.equal(has(tree, 'AccessibilityCard'), false);
      assert.equal(button(tree, 'pairedSetupRestoreAction'), undefined); assert.ok(button(tree, 'copy376'));
      assert.equal(host.calls.length, 0);
    });
    await check(`${language}: no fresh or retained system action can select the abandoned experiment`, () => {
      const source = fs.readFileSync(path.resolve(__dirname, '../../screens/SetupScreen.tsx'), 'utf8');
      assert.equal(/setRecordingMode\(['"]accessibilityMic['"]\)|AccessibilityMicCard|cleanSetupChoose|cleanSetupFallback|cleanSetupSimple/.test(source), false);
    });
  }
  console.log(`paired setup screen: ${passed} checks passed`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
