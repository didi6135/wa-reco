'use strict';
// Production bridge/card host checks. No device, capture, settings or provider operations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { core } = require('../../i18n/__tests__/load-core.cjs')();
const compile = (name, jsx = false) => ts.transpileModule(fs.readFileSync(path.resolve(__dirname, name), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    jsx: jsx ? ts.JsxEmit.React : undefined, esModuleInterop: true },
}).outputText;
const readiness = {};
vm.runInNewContext(compile('../../setup/readiness.ts'), { exports: readiness });
const moduleState = { Platform: { OS: 'android' }, NativeModules: {} };
const bridge = {};
vm.runInNewContext(compile('../../services/NativeRecorder.ts'), { exports: bridge, module: { exports: bridge }, require(name) {
  if (name === '../i18n/core') return core;
  if (name === 'react-native') return moduleState;
  throw Error(`Unexpected bridge import ${name}`);
} });
const available = { supported: true, selected: false, enabled: false, connected: false, automaticSupported: true,
  appInfoRecoverySupported: true,
  source: 'voice_recognition', experimental: true, route: 'unknown', routeKnown: false };
const selected = { ...available, selected: true };
const ready = { ...selected, enabled: true, connected: true };
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
let passed = 0;
async function check(name, work) { await work(); passed++; }

function harness(status = available, mode = 'system', controls = {}, component = 'AccessibilityMicCard') {
  let cursor = 0, focused = true, unmounted = false, lateWrites = 0, componentProps = {};
  const slots = [], effects = [], focus = [], calls = [], alerts = [];
  let appStateListener;
  const appState = { currentState: 'active', addEventListener(name, callback) {
    appStateListener = callback; return { remove() { appStateListener = null; } };
  } };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(value) { const index = cursor++; slots[index] ??= { value };
      return [slots[index].value, next => { if (unmounted) lateWrites++; slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
    useRef(value) { const index = cursor++; slots[index] ??= { current: value }; return slots[index]; },
    useCallback: value => value,
    useEffect(effect) { const index = cursor++; if (!slots[index]) { slots[index] = { cleanup: null }; effects.push(() => { slots[index].cleanup = effect(); }); } },
  };
  const exported = {};
  vm.runInNewContext(compile(`../${component}.tsx`, true), {
    exports: exported, module: { exports: exported }, require(name) {
      if (name === 'react') return react;
      if (name === 'react-native') return { ...Object.fromEntries(['View', 'Text', 'TouchableOpacity', 'Switch'].map(key => [key, key])),
        AppState: appState, StyleSheet: { create: value => value }, Alert: { alert: (...args) => alerts.push(args) } };
      if (name === '@react-navigation/native') return { useNavigation: () => ({ navigate: route => calls.push(['navigate', route]) }),
        useFocusEffect(effect) { if (!focus.length) focus.push({ effect, cleanup: focused ? effect() : null }); } };
      if (name === '../context/RecordingContext') return { useRecording: () => ({
        accessibilityMicStatus: status, autoRecordingStatus: { mode },
        isBusy: false, isRecording: false, status: { audioMode: 0 }, systemAccessStatus: { connecting: false },
        setRecordingMode: async value => calls.push(['mode', value]),
        openAccessibilityMicSetup: async () => calls.push('service-settings'),
        openAccessibilityMicAppInfo: async () => calls.push('app-info'),
        refreshAccessibilityMicStatus: async () => calls.push('read-service'),
        refreshAutoRecordingStatus: async () => calls.push('read-auto'),
        enableAutoRecording: async () => calls.push('arm-auto'), startRecording: async () => calls.push('capture'),
        disableAutoRecording: async () => calls.push('disarm-auto'),
        openNotificationAccessSetup: async () => calls.push('notification-settings'),
        connectSystemRecorder: async () => calls.push('pairing-helper'), ...controls,
      }) };
      if (name === '../i18n') return { ...core, useLocalization: () => ({ isRTL: core.getLanguage() === 'he' }), useLocalizedStyles: value => core.directionalStyles(value, core.getLanguage()) };
      if (name === '../setup/readiness') return readiness;
      if (name === './OfflineRecoveryCard') return { __esModule: true, default: 'OfflineRecoveryCard' };
      if (name === '../theme') return { colors: {}, ui: {} };
      throw Error(`Unexpected card import ${name}`);
    },
  });
  return { calls, alerts, appState, lateWrites: () => lateWrites,
    render(nextProps) { if (nextProps) componentProps = nextProps; cursor = 0; const tree = exported.default(componentProps); while (effects.length) effects.shift()(); return tree; },
    setStatus(next) { status = next; },
    setControls(next) { Object.assign(controls, next); },
    blur() { focused = false; for (const f of focus) { f.cleanup?.(); f.cleanup = null; } },
    focus() { focused = true; for (const f of focus) f.cleanup = f.effect(); },
    background() { appState.currentState = 'background'; appStateListener?.('background'); },
    foreground() { appState.currentState = 'active'; appStateListener?.('active'); },
    unmount() { unmounted = true; for (const slot of slots) slot?.cleanup?.(); for (const f of focus) f.cleanup?.(); },
  };
}
function nodes(node) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(nodes); return [node, ...nodes(node.children)]; }
function text(node) { if (node == null || typeof node === 'boolean') return ''; if (typeof node === 'string') return node; if (Array.isArray(node)) return node.map(text).join(' '); return node.children.map(text).join(node.type === 'Text' ? '' : ' '); }
function button(tree, key) { return nodes(tree).find(node => node.type === 'TouchableOpacity' && text(node) === core.t(key)); }
function recoveryTree(host) {
  let tree = host.render();
  if (!button(tree, 'accessibilityMicAppInfoOpen')) {
    button(tree, 'accessibilityMicAppInfoTitle')?.props.onPress(); tree = host.render();
  }
  return tree;
}
function providerHarness(nativeOverrides = {}) {
  const calls = [], slots = []; let cursor = 0; let mode = 'system';
  const initialStatus = { ...bridge.EMPTY_RECORDER_STATUS };
  moduleState.NativeModules.CallRecorder = {
    getStatus: async () => ({ ...initialStatus }),
    getAutoRecordingStatus: async () => ({ ...bridge.EMPTY_AUTO_RECORDING_STATUS, mode, modeReady: false }),
    getAccessibilityMicStatus: async () => ({ ...ready, selected: mode === 'accessibilityMic' }),
    getSystemAccessStatus: async () => { calls.push('system-state'); return { ...bridge.EMPTY_SYSTEM_ACCESS_STATUS }; },
    connectSystemRecorder: async () => calls.push('activate-system'),
    setRecordingMode: async value => { calls.push(['mode', value]); mode = value; return { ...ready, selected: value === 'accessibilityMic' }; },
    openAccessibilityMicSetup: async () => calls.push('service-settings'),
    openAccessibilityMicAppInfo: async () => calls.push('app-info'),
    setAutoRecordingEnabled: async value => calls.push(['auto', value]),
    startRecording: async source => { calls.push(['capture', source]); return { ...initialStatus, isRecording: true, source }; },
    ...nativeOverrides,
  };
  const react = { createContext: () => ({ Provider: 'RecordingProvider' }),
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState(initial) { const index = cursor++; slots[index] ??= { value: initial }; return [slots[index].value,
      next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useCallback: action => action, useEffect() {},
  };
  const exported = {};
  vm.runInNewContext(compile('../../context/RecordingContext.tsx', true), {
    exports: exported, module: { exports: exported }, setTimeout, clearTimeout, setInterval, clearInterval,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react-native') return { Platform: { OS: 'android', Version: 36 }, AppState: { currentState: 'active' }, PermissionsAndroid: {} };
      if (name === '../services/NativeRecorder') return bridge;
      if (name === '../i18n/core') return core;
      if (name === '@react-native-async-storage/async-storage') return { getItem: async () => null };
      if (name === '../utils/permissions') return { checkPermissions: async () => true,
        requestPermissions: async () => { calls.push('mic-permission'); return true; },
        requestNotificationPermission: async () => { calls.push('notification-permission'); return true; } };
      throw Error(`Unexpected provider import ${name}`);
    },
  });
  return { calls, render() { cursor = 0; return exported.RecordingProvider({ children: null }).props.value; } };
}
async function main() {
  for (const language of ['he', 'en']) {
    core.activateLanguage(language);
    await check(`${language}: render never requests permission, changes mode, pairs, captures or arms`, () => {
      for (const [status, mode] of [[available, 'system'], [selected, 'accessibilityMic'], [ready, 'accessibilityMic'], [null, 'accessibilityMic']]) {
        const host = harness(status, mode); host.render(); assert.equal(host.calls.length, 0); assert.equal(host.alerts.length, 0);
      }
    });
    await check(`${language}: experiment requires explanatory positive mode choice, cancel is inert`, async () => {
      const host = harness(); button(host.render(), 'cleanSettingsConnectService').props.onPress();
      assert.equal(host.calls.length, 0); assert.equal(host.alerts.length, 1);
      const [title, message, choices] = host.alerts[0];
      assert.equal(title, core.t('accessibilityMicConsentTitle')); assert.equal(message, core.t('accessibilityMicConsent'));
      assert.equal(choices[0].style, 'cancel'); assert.equal(choices[0].onPress, undefined);
      choices[1].onPress(); await flush(); assert.deepEqual(host.calls, [['mode', 'accessibilityMic'], 'read-service', 'read-auto']);
    });
    await check(`${language}: service approval only opens system settings and reads state`, async () => {
      const host = harness(selected, 'accessibilityMic'); button(host.render(), 'accessibilityMicOpenSettings').props.onPress(); await flush();
      assert.deepEqual(host.calls, ['service-settings', 'read-service', 'read-auto']);
    });
    await check(`${language}: restricted-settings help is conditional and never diagnoses a disabled service`, () => {
      const host = harness(selected, 'accessibilityMic'); const tree = host.render();
      assert.ok(text(tree).includes(core.t('accessibilityMicAppInfoTitle')));
      assert.ok(!text(tree).includes(core.t('accessibilityMicAppInfoHelp')));
      assert.ok(button(tree, 'accessibilityMicOpenSettings'));
      assert.equal(button(tree, 'accessibilityMicAppInfoOpen'), undefined);
      const expanded = recoveryTree(host);
      assert.ok(text(expanded).includes(core.t('accessibilityMicAppInfoHelp')));
      assert.ok(button(expanded, 'accessibilityMicAppInfoOpen'));
      assert.equal(host.calls.length, 0); assert.equal(host.alerts.length, 0);
    });
    await check(`${language}: recovery navigation is unavailable without native SDK support or service permission step`, () => {
      for (const [status, mode] of [[{ ...selected, appInfoRecoverySupported: false }, 'accessibilityMic'],
        [{ ...selected, appInfoRecoverySupported: undefined }, 'accessibilityMic'], [available, 'system'],
        [ready, 'accessibilityMic'], [{ ...selected, enabled: true }, 'accessibilityMic'], [null, 'accessibilityMic']]) {
        const host = harness(status, mode); assert.equal(button(recoveryTree(host), 'accessibilityMicAppInfoOpen'), undefined);
        assert.equal(host.calls.length, 0);
      }
    });
    await check(`${language}: explicit restricted-settings action opens only App info and reads state`, async () => {
      const host = harness(selected, 'accessibilityMic'); button(recoveryTree(host), 'accessibilityMicAppInfoOpen').props.onPress(); await flush();
      assert.deepEqual(host.calls, ['app-info', 'read-service', 'read-auto']);
      assert.equal(host.alerts.length, 0);
    });
    await check(`${language}: returning without approval preserves refusal and cannot redirect, arm or capture`, async () => {
      const host = harness(selected, 'accessibilityMic');
      button(host.render(), 'accessibilityMicOpenSettings').props.onPress(); await flush();
      host.appState.currentState = 'background'; host.render(); host.appState.currentState = 'active';
      const tree = host.render(); assert.ok(button(tree, 'accessibilityMicOpenSettings'));
      assert.ok(button(recoveryTree(host), 'accessibilityMicAppInfoOpen'));
      assert.deepEqual(host.calls, ['service-settings', 'read-service', 'read-auto']);
    });
    await check(`${language}: App info return still requires genuine service approval and binding`, async () => {
      const host = harness(selected, 'accessibilityMic');
      button(recoveryTree(host), 'accessibilityMicAppInfoOpen').props.onPress(); await flush();
      assert.ok(button(host.render(), 'accessibilityMicOpenSettings'));
      assert.ok(!text(host.render()).includes(core.t('cleanSettingsServiceReadyHelp')));
      host.setStatus({ ...selected, enabled: true }); assert.ok(text(host.render()).includes(core.t('cleanSettingsServiceConnecting')));
      host.setStatus(ready); assert.ok(text(host.render()).includes(core.t('cleanSettingsServiceReadyHelp')));
      assert.equal(button(recoveryTree(host), 'accessibilityMicAppInfoOpen'), undefined);
      assert.deepEqual(host.calls, ['app-info', 'read-service', 'read-auto']);
    });
    await check(`${language}: App info action rejects blur background unmount busy capture and call lifetimes`, async () => {
      for (const controls of [{ isRecording: true }, { isBusy: true }, { status: { audioMode: 3 } },
        { systemAccessStatus: { offlineRecovery: { running: true } } }, { systemAccessStatus: { connecting: true } }]) {
        const host = harness(selected, 'accessibilityMic', controls); const target = button(recoveryTree(host), 'accessibilityMicAppInfoOpen');
        assert.equal(target.props.disabled, true); target.props.onPress(); await flush(); assert.equal(host.calls.length, 0);
      }
      for (const leave of [h => h.blur(), h => { h.appState.currentState = 'background'; }, h => h.unmount()]) {
        const host = harness(selected, 'accessibilityMic'); const target = button(recoveryTree(host), 'accessibilityMicAppInfoOpen');
        leave(host); target.props.onPress(); await flush(); assert.equal(host.calls.length, 0); assert.equal(host.lateWrites(), 0);
      }
    });
    await check(`${language}: pending App info navigation is bounded to one request without late unmounted writes`, async () => {
      const pending = deferred(); let launched = 0;
      const host = harness(selected, 'accessibilityMic', { openAccessibilityMicAppInfo: () => { launched++; return pending.promise; } });
      const target = button(recoveryTree(host), 'accessibilityMicAppInfoOpen'); target.props.onPress(); target.props.onPress();
      assert.equal(launched, 1); host.unmount(); pending.resolve(); await flush();
      assert.equal(host.lateWrites(), 0); assert.deepEqual(host.calls, ['read-service', 'read-auto']);
    });
    await check(`${language}: enabled service is never called connected before binding`, () => {
      const host = harness({ ...selected, enabled: true }, 'accessibilityMic'); const tree = host.render();
      assert.ok(text(tree).includes(core.t('cleanSettingsServiceConnecting')));
      assert.ok(!text(tree).includes(core.t('accessibilityMicReadyHelp')));
      assert.ok(button(tree, 'copy327'));
      assert.equal(button(tree, 'accessibilityMicOpenSettings'), undefined);
      button(tree, 'cleanSettingsServiceHelp').props.onPress();
      assert.ok(button(host.render(), 'accessibilityMicOpenSettings')); assert.equal(host.calls.length, 0);
    });
    await check(`${language}: connected service retains two-party and headphone limitation`, () => {
      const host = harness(ready, 'accessibilityMic'); const tree = host.render();
      assert.ok(text(tree).includes(core.t('cleanSettingsServiceCheck'))); assert.ok(text(tree).includes(core.t('cleanSettingsServiceReadyHelp')));
      assert.ok(!text(tree).includes(core.t('accessibilityMicLimits')));
      assert.equal(button(tree, 'accessibilityMicOpenSettings'), undefined);
      button(tree, 'cleanSettingsServiceHelp').props.onPress(); const expanded = host.render();
      assert.ok(text(expanded).includes(core.t('accessibilityMicLimits'))); assert.ok(text(expanded).includes(core.t('accessibilityMicReadyHelp')));
      assert.equal(host.calls.length, 0);
    });
    await check(`${language}: return to existing pairing is separately confirmed and never activates`, async () => {
      const host = harness(ready, 'accessibilityMic');
      assert.equal(button(host.render(), 'accessibilityMicReturnSystem'), undefined);
      button(host.render({ showFallback: true }), 'cleanSettingsServiceHelp').props.onPress();
      button(host.render(), 'accessibilityMicReturnSystem').props.onPress();
      assert.equal(host.calls.length, 0); host.alerts[0][2][1].onPress(); await flush();
      assert.deepEqual(host.calls, [['mode', 'system'], 'read-service', 'read-auto']);
    });
    await check(`${language}: recording busy recovery and active audio mode block mode changes`, () => {
      for (const controls of [{ isRecording: true }, { isBusy: true }, { status: { audioMode: 3 } }, { systemAccessStatus: { offlineRecovery: { running: true } } }]) {
        const host = harness(available, 'system', controls); const target = button(host.render(), 'cleanSettingsConnectService');
        assert.equal(target.props.disabled, true); target.props.onPress(); assert.equal(host.alerts.length, 0); assert.equal(host.calls.length, 0);
      }
    });
    await check(`${language}: positive callback cannot mutate after blur or background`, async () => {
      for (const leave of [h => h.blur(), h => { h.appState.currentState = 'background'; }, h => h.unmount()]) {
        const host = harness(); button(host.render(), 'cleanSettingsConnectService').props.onPress(); leave(host);
        host.alerts[0][2][1].onPress(); await flush(); assert.equal(host.calls.length, 0); assert.equal(host.lateWrites(), 0);
      }
    });
    await check(`${language}: asynchronous settings completion makes no late UI writes after unmount`, async () => {
      const pending = deferred(); const host = harness(selected, 'accessibilityMic', { openAccessibilityMicSetup: () => pending.promise });
      button(host.render(), 'accessibilityMicOpenSettings').props.onPress(); host.unmount(); pending.resolve(); await flush();
      assert.equal(host.lateWrites(), 0); assert.ok(!host.calls.includes('capture')); assert.ok(!host.calls.includes('arm-auto'));
    });
    await check(`${language}: old APK without new service API fails closed and does not pretend to be connected`, async () => {
      moduleState.NativeModules.CallRecorder = {};
      const value = await bridge.NativeRecorder.getAccessibilityMicStatus(); assert.equal(value.supported, false); assert.equal(value.connected, false);
      assert.equal(value.appInfoRecoverySupported, false); await assert.rejects(bridge.NativeRecorder.openAccessibilityMicAppInfo());
      await assert.rejects(bridge.NativeRecorder.openAccessibilityMicSetup()); await assert.rejects(bridge.NativeRecorder.setRecordingMode('accessibilityMic'));
    });
    await check(`${language}: malformed native capability replies cannot authorize capture`, async () => {
      for (const value of [null, {}, { ...ready, connected: 'true' }, { ...ready, experimental: false }, { ...ready, source: 'mic' }, { ...ready, route: 'private-device' }, { ...ready, automaticSupported: undefined }, { ...ready, appInfoRecoverySupported: 'true' }]) {
        moduleState.NativeModules.CallRecorder = { getAccessibilityMicStatus: async () => value };
        await assert.rejects(bridge.NativeRecorder.getAccessibilityMicStatus(), error => error.message === core.t('accessibilityMicReadFailed'));
      }
    });
    await check(`${language}: old native status cannot imply restricted-settings recovery support`, async () => {
      moduleState.NativeModules.CallRecorder = { getAccessibilityMicStatus: async () => ({ ...ready, appInfoRecoverySupported: undefined }) };
      const value = await bridge.NativeRecorder.getAccessibilityMicStatus();
      assert.equal(value.connected, true); assert.equal(value.appInfoRecoverySupported, false);
    });
    await check(`${language}: App info bridge is an exact explicit navigation action with localized safe failure codes`, async () => {
      const calls = []; moduleState.NativeModules.CallRecorder = { openAccessibilityMicAppInfo: async () => calls.push('app-info') };
      await bridge.NativeRecorder.openAccessibilityMicAppInfo(); assert.deepEqual(calls, ['app-info']);
      for (const [code, key] of [['ACCESSIBILITY_APP_INFO_UNSUPPORTED', 'accessibilityMicAppInfoUnsupported'],
        ['ACCESSIBILITY_APP_INFO_FAILED', 'accessibilityMicAppInfoFailed'], ['ACCESSIBILITY_MIC_MODE_REQUIRED', 'accessibilityMicModeRequired']]) {
        moduleState.NativeModules.CallRecorder = { openAccessibilityMicAppInfo: async () => { throw { code, message: 'native detail' }; } };
        await assert.rejects(bridge.NativeRecorder.openAccessibilityMicAppInfo(), error => error.code === code && error.message === core.t(key));
      }
    });
    await check(`${language}: exact native service/mode methods preserve explicit source`, async () => {
      const calls = []; moduleState.NativeModules.CallRecorder = {
        getAccessibilityMicStatus: async () => ready,
        setRecordingMode: async value => { calls.push(['mode', value]); return ready; },
        openAccessibilityMicSetup: async () => calls.push('service-settings'),
        startRecording: async source => { calls.push(['capture', source]); return { error: null }; },
      };
      await bridge.NativeRecorder.setRecordingMode('accessibilityMic'); await bridge.NativeRecorder.openAccessibilityMicSetup();
      assert.deepEqual(calls, [['mode', 'accessibilityMic'], 'service-settings']);
      await bridge.NativeRecorder.startRecording('accessibilityMic'); assert.deepEqual(calls[2], ['capture', 'accessibilityMic']);
      assert.equal((await bridge.NativeRecorder.getAccessibilityMicStatus()).connected, true);
    });
    await check(`${language}: malformed native recording mode cannot silently become paired`, async () => {
      moduleState.NativeModules.CallRecorder = { getAutoRecordingStatus: async () => ({ ...bridge.EMPTY_AUTO_RECORDING_STATUS, mode: 'invalid' }) };
      await assert.rejects(bridge.NativeRecorder.getAutoRecordingStatus());
    });
    await check(`${language}: stale Auto poll cannot overwrite explicit paired restoration`, async () => {
      const old = deferred(); let reads = 0;
      const host = providerHarness({ getAutoRecordingStatus: () => ++reads === 1 ? old.promise :
        Promise.resolve({ ...bridge.EMPTY_AUTO_RECORDING_STATUS, mode: 'system', modeReady: true }) });
      const context = host.render(); const pending = context.refreshAutoRecordingStatus();
      await context.setRecordingMode('system');
      old.resolve({ ...bridge.EMPTY_AUTO_RECORDING_STATUS, mode: 'accessibilityMic' }); await pending;
      assert.equal(host.render().autoRecordingStatus.mode, 'system');
      assert.ok(!host.calls.some(call => Array.isArray(call) && ['auto', 'capture'].includes(call[0])));
    });
    await check(`${language}: live paired helper records and arms without Wi-Fi or an activation session`, async () => {
      for (const action of ['startRecording', 'enableAutoRecording']) {
        const host = providerHarness({ getStatus: async () => ({ ...bridge.EMPTY_RECORDER_STATUS, usbConnected: true, audioMode: 3 }),
          getSystemAccessStatus: async () => ({ ...bridge.EMPTY_SYSTEM_ACCESS_STATUS, available: true, helperConnected: true,
            paired: false, wirelessDebuggingEnabled: false }),
          getAutoRecordingStatus: async () => ({ ...bridge.EMPTY_AUTO_RECORDING_STATUS, mode: 'system', notificationAccessGranted: true }),
          connectSystemRecorderOffline: async () => host.calls.push('activate-offline') });
        await host.render()[action]('usb');
        assert.ok(!host.calls.includes('activate-system')); assert.ok(!host.calls.includes('activate-offline'));
        assert.ok(host.calls.some(call => Array.isArray(call) && call[0] === (action === 'startRecording' ? 'capture' : 'auto')));
      }
    });
    await check(`${language}: explicit call or Auto action restores a prepared detached helper before capture or arming`, async () => {
      for (const action of ['startRecording', 'enableAutoRecording']) {
        let live = false;
        const host = providerHarness({ getStatus: async () => ({ ...bridge.EMPTY_RECORDER_STATUS, usbConnected: live }),
          getSystemAccessStatus: async () => ({ ...bridge.EMPTY_SYSTEM_ACCESS_STATUS, available: true, paired: true,
            helperConnected: live, wirelessDebuggingEnabled: false, offlineRecovery: { supported: true, enabled: true,
              secureSettingsGranted: true, nearbyWifiGranted: true, running: false } }),
          getAutoRecordingStatus: async () => ({ ...bridge.EMPTY_AUTO_RECORDING_STATUS, mode: 'system', notificationAccessGranted: true }),
          connectSystemRecorderOffline: async () => { host.calls.push('activate-offline'); live = true; } });
        const context = host.render(); assert.deepEqual(host.calls, []);
        await context[action]('usb');
        assert.equal(host.calls.filter(call => call === 'activate-offline').length, 1);
        assert.ok(!host.calls.includes('activate-system'));
        const mutation = host.calls.findIndex(call => Array.isArray(call) && call[0] === (action === 'startRecording' ? 'capture' : 'auto'));
        assert.ok(mutation > host.calls.indexOf('activate-offline'));
      }
    });
    await check(`${language}: incomplete or disabled offline setup never grants permissions or starts recovery`, async () => {
      for (const missing of ['supported', 'enabled', 'secureSettingsGranted', 'nearbyWifiGranted']) {
        const host = providerHarness({ getSystemAccessStatus: async () => ({ ...bridge.EMPTY_SYSTEM_ACCESS_STATUS,
          available: true, paired: true, wirelessDebuggingEnabled: false, offlineRecovery: { supported: true,
            enabled: true, secureSettingsGranted: true, nearbyWifiGranted: true, running: false, [missing]: false } }),
          connectSystemRecorderOffline: async () => host.calls.push('activate-offline') });
        await assert.rejects(host.render().startRecording('usb'), error => error.message === core.t('copy205'));
        assert.ok(!host.calls.includes('activate-offline')); assert.ok(!host.calls.includes('activate-system'));
        assert.ok(!host.calls.some(call => Array.isArray(call) && ['auto', 'capture'].includes(call[0])));
      }
    });
    await check(`${language}: cold helper recovery cannot create a hotspot during an active call`, async () => {
      const host = providerHarness({ getStatus: async () => ({ ...bridge.EMPTY_RECORDER_STATUS, audioMode: 3 }),
        getSystemAccessStatus: async () => ({ ...bridge.EMPTY_SYSTEM_ACCESS_STATUS, available: true, paired: true,
          offlineRecovery: { supported: true, enabled: true, secureSettingsGranted: true, nearbyWifiGranted: true, running: false } }),
        connectSystemRecorderOffline: async () => host.calls.push('activate-offline') });
      await assert.rejects(host.render().startRecording('usb'), error => error.message === core.t('offlineRecoveryCallBusy'));
      assert.deepEqual(host.calls, []);
    });
    await check(`${language}: cancel after native activation revokes pending capture and Auto continuations`, async () => {
      for (const action of ['startRecording', 'enableAutoRecording']) {
        const result = deferred(); let live = false, statusReads = 0;
        const host = providerHarness({ getStatus: async () => {
          statusReads++;
          if (live) return result.promise;
          return { ...bridge.EMPTY_RECORDER_STATUS };
        }, getSystemAccessStatus: async () => ({ ...bridge.EMPTY_SYSTEM_ACCESS_STATUS, available: true, paired: true,
          helperConnected: live, offlineRecovery: { supported: true, enabled: true,
            secureSettingsGranted: true, nearbyWifiGranted: true, running: false } }),
          getAutoRecordingStatus: async () => ({ ...bridge.EMPTY_AUTO_RECORDING_STATUS, mode: 'system', notificationAccessGranted: true }),
          connectSystemRecorderOffline: async () => { host.calls.push('activate-offline'); live = true; },
          cancelOfflineRecovery: async () => host.calls.push('cancel-offline') });
        const context = host.render(), pending = context[action]('usb');
        // Attach rejection before cancellation settles to avoid an unhandled promise.
        const rejected = assert.rejects(pending, error => error.message === core.t('offlineRecoveryCancelled'));
        await flush(); assert.ok(live); assert.ok(statusReads >= 2);
        await context.cancelOfflineRecovery(); result.resolve({ ...bridge.EMPTY_RECORDER_STATUS, usbConnected: true });
        await rejected;
        assert.ok(!host.calls.includes('activate-system'));
        assert.ok(!host.calls.some(call => Array.isArray(call) && ['auto', 'capture'].includes(call[0])));
      }
    });
    await check(`${language}: failed or stale offline liveness never falls back, captures or arms`, async () => {
      for (const failure of ['native', 'helper', 'recorder']) {
        let activated = false;
        const host = providerHarness({ getStatus: async () => ({ ...bridge.EMPTY_RECORDER_STATUS,
          usbConnected: activated && failure !== 'recorder' }),
          getSystemAccessStatus: async () => ({ ...bridge.EMPTY_SYSTEM_ACCESS_STATUS, available: true, paired: true,
            helperConnected: activated && failure !== 'helper', wirelessDebuggingEnabled: false,
            offlineRecovery: { supported: true, enabled: true, secureSettingsGranted: true, nearbyWifiGranted: true, running: false } }),
          getAutoRecordingStatus: async () => ({ ...bridge.EMPTY_AUTO_RECORDING_STATUS, mode: 'system', notificationAccessGranted: true }),
          connectSystemRecorderOffline: async () => { host.calls.push('activate-offline'); if (failure === 'native') throw new Error('OFFLINE_WIFI_DISABLED'); activated = true; } });
        await assert.rejects(host.render().enableAutoRecording());
        assert.ok(!host.calls.includes('activate-system'));
        assert.ok(!host.calls.some(call => Array.isArray(call) && ['auto', 'capture'].includes(call[0])));
        assert.ok(host.render().error);
      }
    });
    await check(`${language}: an explicit manual ADB port preserves ordinary activation despite prepared recovery`, async () => {
      let live = false;
      const host = providerHarness({ getStatus: async () => ({ ...bridge.EMPTY_RECORDER_STATUS, usbConnected: live }),
        getSystemAccessStatus: async () => ({ ...bridge.EMPTY_SYSTEM_ACCESS_STATUS, available: true, paired: true,
          helperConnected: live, wirelessDebuggingEnabled: true, offlineRecovery: { supported: true, enabled: true,
            secureSettingsGranted: true, nearbyWifiGranted: true, running: false } }),
        connectSystemRecorder: async port => { host.calls.push(['activate-system', port]); live = true; },
        connectSystemRecorderOffline: async () => host.calls.push('activate-offline') });
      await host.render().connectSystemRecorder(37123);
      assert.deepEqual(host.calls, [['activate-system', 37123]]);
    });
    await check(`${language}: mismatched stale Home source rejects before helper activation or capture`, async () => {
      const host = providerHarness({ getAutoRecordingStatus: async () => ({ ...bridge.EMPTY_AUTO_RECORDING_STATUS, mode: 'accessibilityMic' }) });
      await assert.rejects(host.render().startRecording('usb'), error => error.message === core.t('pairedSetupRestoreHelp'));
      assert.ok(!host.calls.includes('system-state')); assert.ok(!host.calls.includes('activate-system'));
      assert.ok(!host.calls.some(call => Array.isArray(call) && call[0] === 'capture'));
    });
    await check(`${language}: connected experimental capture is rejected before any native work`, async () => {
      const host = providerHarness({ getAutoRecordingStatus: async () => ({ ...bridge.EMPTY_AUTO_RECORDING_STATUS, mode: 'accessibilityMic' }),
        getAccessibilityMicStatus: async () => ready });
      await assert.rejects(host.render().startRecording('accessibilityMic'), error => error.message === core.t('pairedSetupRestoreHelp'));
      assert.deepEqual(host.calls, []);
    });
    await check(`${language}: disconnected accessibility service cannot start microphone capture`, async () => {
      const host = providerHarness({ getAutoRecordingStatus: async () => ({ ...bridge.EMPTY_AUTO_RECORDING_STATUS, mode: 'accessibilityMic' }),
        getAccessibilityMicStatus: async () => ({ ...ready, connected: false }) });
      await assert.rejects(host.render().startRecording('accessibilityMic'));
      assert.equal(host.calls.length, 0);
    });
    await check(`${language}: service approval is not an Auto or capture action in production provider`, async () => {
      const host = providerHarness(); await host.render().openAccessibilityMicSetup();
      assert.deepEqual(host.calls, ['service-settings']);
    });
    await check(`${language}: production App info action never requests permission changes mode activates helper or captures`, async () => {
      const host = providerHarness(); await host.render().openAccessibilityMicAppInfo();
      assert.deepEqual(host.calls, ['app-info']);
    });
    await check(`${language}: fresh provider capture and active-call state block App info navigation`, async () => {
      for (const current of [{ ...bridge.EMPTY_RECORDER_STATUS, audioMode: 3 }, { ...bridge.EMPTY_RECORDER_STATUS, isRecording: true }]) {
        const host = providerHarness({ getStatus: async () => current });
        await assert.rejects(host.render().openAccessibilityMicAppInfo()); assert.equal(host.calls.length, 0);
      }
    });
    await check(`${language}: fresh active call blocks provider mode switch before native mutation`, async () => {
      const host = providerHarness({ getStatus: async () => ({ ...bridge.EMPTY_RECORDER_STATUS, audioMode: 3 }) });
      await assert.rejects(host.render().setRecordingMode('system'));
      assert.equal(host.calls.length, 0);
    });
    await check(`${language}: unavailable experimental Auto cannot arm and does not touch paired helper`, async () => {
      const host = providerHarness({ getAutoRecordingStatus: async () => ({ ...bridge.EMPTY_AUTO_RECORDING_STATUS,
        notificationAccessGranted: true, mode: 'accessibilityMic' }),
        getAccessibilityMicStatus: async () => ({ ...ready, automaticSupported: false }) });
      await assert.rejects(host.render().enableAutoRecording(), error => error.message === core.t('pairedSetupRestoreHelp'));
      assert.deepEqual(host.calls, []);
    });
    await check(`${language}: legacy Auto control disables ON but permits explicit OFF and guided restoration`, async () => {
      for (const enabled of [false, true]) {
        const host = harness({ ...ready, automaticSupported: false }, 'accessibilityMic', {
          autoRecordingStatus: { mode: 'accessibilityMic', enabled, armed: true, listenerConnected: true,
            modeReady: true, notificationAccessGranted: true, state: 'ready' },
        }, 'AutoRecordingCard');
        const tree = host.render(); const control = nodes(tree).find(node => node.type === 'Switch');
        assert.equal(control.props.disabled, !enabled); assert.ok(text(tree).includes(core.t('pairedSetupRestoreTitle')));
        assert.ok(!text(tree).includes(core.t('accessibilityMicAutoHelp'))); assert.ok(!text(tree).includes(core.t('accessibilityMicLimits')));
        assert.equal(button(tree, 'copy026'), undefined); assert.equal(button(tree, 'copy010'), undefined);
        if (enabled) { control.props.onValueChange(false); await flush(); assert.deepEqual(host.calls, ['disarm-auto']); }
        else { control.props.onValueChange(true); assert.deepEqual(host.calls, [['navigate', 'Setup']]); }
        host.calls.length = 0; button(host.render(), 'pairedSetupRestoreAction').props.onPress();
        assert.deepEqual(host.calls, [['navigate', 'Setup']]);
      }
    });
    await check(`${language}: retired mode selection cannot call native and ordinary MIC remains available`, async () => {
      const host = providerHarness({ getAutoRecordingStatus: async () => ({ ...bridge.EMPTY_AUTO_RECORDING_STATUS, mode: 'accessibilityMic' }) });
      await assert.rejects(host.render().setRecordingMode('accessibilityMic'), error => error.message === core.t('pairedSetupRestoreHelp'));
      assert.deepEqual(host.calls, []);
      await host.render().startRecording('microphone');
      assert.ok(host.calls.some(call => Array.isArray(call) && call[0] === 'capture' && call[1] === 'microphone'));
      assert.ok(!host.calls.includes('activate-system'));
    });
    await check(`${language}: paired Auto cancellation is inert and explicit approval arms only once`, async () => {
      const host = harness(null, 'system', { autoRecordingStatus: { mode: 'system', enabled: false,
        armed: false, helperConnected: true, listenerConnected: true, notificationAccessGranted: true, state: 'disabled' } }, 'AutoRecordingCard');
      button(host.render(), 'copy010').props.onPress(); assert.equal(host.alerts[0][2][0].style, 'cancel'); assert.deepEqual(host.calls, []);
      host.alerts[0][2][1].onPress(); host.alerts[0][2][1].onPress(); await flush(); assert.deepEqual(host.calls, ['arm-auto']);
    });
    await check(`${language}: Auto activation retains visible recovery progress and cancel controls`, () => {
      const host = harness(null, 'system', { isBusy: true, systemAccessStatus: { offlineRecovery: { running: true } },
        autoRecordingStatus: { mode: 'system', enabled: false, notificationAccessGranted: true, state: 'disabled' } }, 'AutoRecordingCard');
      const tree = host.render(), recovery = nodes(tree).find(node => node.type === 'OfflineRecoveryCard');
      assert.equal(recovery.props.compact, true); recovery.props.onOpenSetup(); assert.deepEqual(host.calls, []);
    });
    await check(`${language}: old paired Auto consent cannot arm after legacy selection or screen lifetime change`, async () => {
      for (const change of [host => { host.setControls({ autoRecordingStatus: { mode: 'accessibilityMic', enabled: false } }); host.render(); },
        host => { host.blur(); host.focus(); }, host => { host.background(); host.foreground(); }, host => host.unmount()]) {
        const host = harness(null, 'system', { autoRecordingStatus: { mode: 'system', enabled: false,
          notificationAccessGranted: true, state: 'disabled' } }, 'AutoRecordingCard');
        button(host.render(), 'copy010').props.onPress(); change(host); host.alerts[0][2][1].onPress(); await flush();
        assert.ok(!host.calls.includes('arm-auto')); assert.ok(!host.calls.some(call => call[0] === 'mode'));
        assert.equal(host.lateWrites(), 0);
      }
    });
  }
  console.log(`Accessibility microphone UI/bridge: ${passed} checks passed (host only; no call audio acceptance).`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
