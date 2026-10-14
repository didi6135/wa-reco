'use strict';
// Host UI/bridge checks only. No permissions, network, phone, audio or provider access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { core, catalog } = require('../../i18n/__tests__/load-core.cjs')();
const compile = (file, jsx = false) => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    jsx: jsx ? ts.JsxEmit.React : undefined, esModuleInterop: true },
}).outputText;
const moduleState = { NativeModules: {}, Platform: { OS: 'android' } };
const bridgeExports = {};
vm.runInNewContext(compile(path.resolve(__dirname, '../../services/NativeRecorder.ts')), {
  exports: bridgeExports, module: { exports: bridgeExports }, require: name => {
    if (name === '../i18n/core') return core;
    if (name === 'react-native') return moduleState;
    throw Error(`Unexpected bridge dependency ${name}`);
  },
});

const base = { available: true, paired: true, wirelessDebuggingEnabled: true,
  helperConnected: false, connecting: false, error: null, offlineRecovery: {
    supported: true, enabled: false, secureSettingsGranted: false, nearbyWifiGranted: false,
    running: false, stage: 'idle', errorCode: null,
  } };
const ready = { ...base, offlineRecovery: { ...base.offlineRecovery, enabled: true,
  secureSettingsGranted: true, nearbyWifiGranted: true } };
const nested = (state, override) => ({ ...state, offlineRecovery: { ...state.offlineRecovery, ...override } });
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
let passed = 0;
const check = async (name, work) => { await work(); passed += 1; };

function harness(initial, component = 'card') {
  let recording = initial; let cursor = 0; let focused = true; let unmounted = false;
  let lateStateWrites = 0;
  const slots = []; const effects = []; const focusEffects = []; const alerts = []; const calls = [];
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(value) { const index = cursor++; if (!slots[index]) slots[index] = { value };
      return [slots[index].value, next => { if (unmounted) lateStateWrites++; slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
    useRef(value) { const index = cursor++; if (!slots[index]) slots[index] = { current: value }; return slots[index]; },
    useCallback: value => value,
    useEffect(effect) { const index = cursor++; if (!slots[index]) {
      slots[index] = { cleanup: null };
      effects.push(() => { slots[index].cleanup = effect(); });
    } },
  };
  const exported = {};
  vm.runInNewContext(compile(path.resolve(__dirname, component === 'wizard' ? '../SystemSetupWizard.tsx' : '../OfflineRecoveryCard.tsx'), true), {
    exports: exported, module: { exports: exported }, require: name => {
      if (name === 'react') return react;
      if (name === 'react-native') return {
        ...Object.fromEntries(['View', 'Text', 'TextInput', 'Switch', 'TouchableOpacity', 'ActivityIndicator'].map(key => [key, key])),
        Platform: { OS: 'android' },
        StyleSheet: { create: value => value }, Alert: { alert: (...args) => alerts.push(args) },
        Linking: { openSettings: async () => calls.push('app-permissions') },
      };
      if (name === '@react-navigation/native') return { useFocusEffect(effect) {
        if (!focusEffects.length) {
          const value = { effect, cleanup: focused ? effect() : null };
          focusEffects.push(value);
        }
      } };
      if (name === '../context/RecordingContext') return { useRecording: () => ({
        systemAccessStatus: recording, isBusy: false, isRecording: false,
        deviceInfo: { sdk: 36 },
        setOfflineRecoveryEnabled: async value => { calls.push(['enable', value]); },
        requestOfflineRecoveryPermission: async () => { calls.push('permission'); },
        connectSystemRecorderOffline: async () => { calls.push('activate'); },
        cancelOfflineRecovery: async () => { calls.push('cancel'); },
        openSystemAccessSetup: async value => { calls.push(['setup', value]); },
        connectSystemRecorder: async value => { calls.push(['ordinary-connect', value]); },
        refreshSystemAccessStatus: async () => {},
        enableAutoRecording: async () => { calls.push('arm-auto'); },
        startRecording: async () => { calls.push('capture'); },
        ...recording.controls,
      }) };
      if (name === '../services/NativeRecorder') return bridgeExports;
      if (name === '../i18n') return { ...core, useLocalizedStyles: value => core.directionalStyles(value, core.getLanguage()) };
      if (name === '../theme') return { colors: {}, ui: Object.fromEntries(
        ['card', 'label', 'body', 'subtitle', 'primaryButton', 'secondaryButton', 'primaryText', 'secondaryText', 'warning'].map(key => [key, {}])) };
      if (name === './OfflineRecoveryCard') return { __esModule: true, default: 'RecoveryCard' };
      if (name === './Visuals') return { WaveMark: 'WaveMark' };
      if (name === '../setup/readiness') {
        const readiness = {};
        vm.runInNewContext(compile(path.resolve(__dirname, '../../setup/readiness.ts')), { exports: readiness });
        return readiness;
      }
      throw Error(`Unexpected card dependency ${name}`);
    },
  });
  return { calls, alerts, set: value => { recording = value; },
    blur() { focused = false; for (const value of focusEffects) { value.cleanup?.(); value.cleanup = null; } },
    focus() { focused = true; for (const value of focusEffects) value.cleanup = value.effect(); },
    unmount() { unmounted = true; for (const value of slots) value?.cleanup?.(); for (const value of focusEffects) value.cleanup?.(); },
    lateStateWrites: () => lateStateWrites,
    render(props = {}) {
      cursor = 0;
      const tree = exported.default({ focused: component === 'wizard', onOpenSetup: () => calls.push('ordinary-setup'), ...props });
      while (effects.length) effects.shift()();
      return tree;
    } };
}
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.children)];
}
function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join(' ');
  return node.children.map(text).join(node.type === 'Text' ? '' : ' ');
}
function button(tree, key) { return nodes(tree).find(node => node.type === 'TouchableOpacity' && text(node) === core.t(key)); }

async function main() {
  for (const language of ['he', 'en']) {
    core.activateLanguage(language);
    await check(`${language}: default-off rendering never requests a permission or activates`, () => {
      const host = harness(base); const tree = host.render();
      assert.equal(host.alerts.length, 0); assert.equal(host.calls.length, 0);
      assert.equal(nodes(tree).find(node => node.type === 'Switch').props.value, false);
      assert.equal(button(tree, 'offlineRecoveryActivate'), undefined);
      assert.ok(text(tree).includes(core.t('offlineRecoveryOff')));
    });
    await check(`${language}: enabling requires explanatory consent and preserves cancel`, async () => {
      const host = harness(base);
      nodes(host.render()).find(node => node.type === 'Switch').props.onValueChange(true);
      assert.equal(host.calls.length, 0); assert.equal(host.alerts.length, 1);
      const [title, message, choices] = host.alerts[0];
      assert.equal(title, core.t('offlineRecoveryConsentTitle')); assert.equal(message, core.t('offlineRecoveryConsent'));
      assert.equal(choices[0].style, 'cancel'); assert.equal(choices[0].onPress, undefined);
      choices[1].onPress(); await flush(); assert.deepEqual(host.calls, [['enable', true]]);
    });
    await check(`${language}: one next action advances only after each explicit approved step`, async () => {
      const host = harness(base);
      const nextKeys = ['offlineRecoveryInitialSetup', 'offlineRecoveryPrepare', 'offlineRecoveryNearbyAction',
        'offlineRecoveryActivate', 'offlineRecoveryContinueSetup', 'offlineRecoveryWifiSettings'];
      const expectNext = key => {
        const tree = host.render();
        assert.deepEqual(nextKeys.filter(item => button(tree, item)), [key]);
        return button(tree, key);
      };
      expectNext('offlineRecoveryPrepare').props.onPress();
      assert.equal(host.calls.length, 0);
      assert.equal(host.alerts[0][1], core.t('offlineRecoveryConsent'));
      host.alerts[0][2][1].onPress(); await flush();
      assert.deepEqual(host.calls, [['enable', true]]);
      host.set(nested(ready, { nearbyWifiGranted: false }));
      expectNext('offlineRecoveryNearbyAction').props.onPress();
      assert.deepEqual(host.calls, [['enable', true]]);
      assert.equal(host.alerts[1][1], core.t('offlineRecoveryNearbyHelp'));
      host.alerts[1][2][1].onPress(); await flush();
      assert.deepEqual(host.calls, [['enable', true], 'permission']);
      host.set(ready);
      expectNext('offlineRecoveryActivate').props.onPress(); await flush();
      assert.deepEqual(host.calls, [['enable', true], 'permission', 'activate']);
      host.set({ ...ready, helperConnected: true });
      expectNext('offlineRecoveryContinueSetup').props.onPress();
      assert.deepEqual(host.calls, [['enable', true], 'permission', 'activate', 'ordinary-setup']);
      assert.equal(host.calls.includes('arm-auto'), false); assert.equal(host.calls.includes('capture'), false);
    });
    await check(`${language}: missing pairing leads to initial setup without granting or activating`, () => {
      const host = harness({ ...base, paired: false }); const tree = host.render();
      assert.ok(text(tree).includes(core.t('offlineRecoverySetupRequired')));
      assert.equal(button(tree, 'offlineRecoveryPrepare'), undefined);
      button(tree, 'offlineRecoveryInitialSetup').props.onPress();
      assert.deepEqual(host.calls, ['ordinary-setup']); assert.equal(host.alerts.length, 0);
    });
    await check(`${language}: missing protected grant and debugging require ordinary setup even with a live helper`, async () => {
      for (const helperConnected of [false, true]) {
        const host = harness({ ...base, helperConnected, wirelessDebuggingEnabled: false }); const tree = host.render();
        assert.ok(text(tree).includes(core.t('offlineRecoverySetupRequired')));
        assert.equal(button(tree, 'offlineRecoveryPrepare'), undefined);
        button(tree, 'offlineRecoveryInitialSetup').props.onPress(); await flush();
        assert.deepEqual(host.calls, [['setup', 'wireless']]); assert.equal(host.alerts.length, 0);
      }
    });
    await check(`${language}: a live normal helper cannot hide missing offline preparation or Nearby permission`, () => {
      for (const [override, action, status] of [
        [{ secureSettingsGranted: false }, 'offlineRecoveryPrepare', 'offlineRecoveryGrantRequired'],
        [{ nearbyWifiGranted: false }, 'offlineRecoveryNearbyAction', 'offlineRecoveryNearbyRequired'],
      ]) {
        const host = harness({ ...nested(ready, override), helperConnected: true }); const tree = host.render();
        assert.ok(button(tree, action)); assert.ok(text(tree).includes(core.t(status)));
        assert.ok(text(tree).includes(core.t('offlineRecoveryConnectedNeedsPreparation')));
        assert.equal(text(tree).includes(core.t('offlineRecoveryReady')), false);
        assert.equal(button(tree, 'offlineRecoveryActivate'), undefined);
        assert.equal(host.calls.length, 0); assert.equal(host.alerts.length, 0);
      }
    });
    await check(`${language}: ordinary activation precedes a short optional invitation when recovery is off`, async () => {
      for (const wirelessDebuggingEnabled of [false, true]) {
        const host = harness({ ...base, developerOptionsEnabled: true, wirelessDebuggingEnabled }, 'wizard');
        const tree = host.render(); const list = nodes(tree);
        const ordinary = button(tree, wirelessDebuggingEnabled ? 'copy130' : 'copy121');
        const invitation = list.find(node => node.type === 'RecoveryCard');
        assert.ok(ordinary);
        if (wirelessDebuggingEnabled) {
          assert.ok(invitation); assert.equal(invitation.props.compact, true);
          assert.ok(list.indexOf(ordinary) < list.indexOf(invitation));
        } else assert.equal(invitation, undefined);
        assert.equal(host.calls.length, 0); assert.equal(host.alerts.length, 0);
        ordinary.props.onPress(); await flush();
        assert.deepEqual(host.calls, [wirelessDebuggingEnabled ? ['ordinary-connect', 0] : ['setup', 'wireless']]);
      }
    });
    await check(`${language}: the off-state setup invitation is short and has no competing preference switch`, () => {
      const host = harness(base); const tree = host.render({ compact: true });
      assert.ok(text(tree).includes(core.t('offlineRecoveryCompactHelp')));
      assert.equal(text(tree).includes(core.t('offlineRecoveryHelp')), false);
      assert.equal(nodes(tree).find(node => node.type === 'Switch'), undefined);
      assert.ok(button(tree, 'offlineRecoveryPrepare'));
      assert.equal(button(tree, 'offlineRecoveryNormalSetup'), undefined);
      assert.equal(host.calls.length, 0); assert.equal(host.alerts.length, 0);
    });
    await check(`${language}: opted-in setup has one recovery route with an explicit ordinary fallback and return`, () => {
      const host = harness({ ...ready, developerOptionsEnabled: true, wirelessDebuggingEnabled: true }, 'wizard');
      let tree = host.render();
      assert.equal(tree.type, 'RecoveryCard'); assert.equal(button(tree, 'copy130'), undefined);
      assert.equal(host.calls.length, 0); assert.equal(host.alerts.length, 0);
      tree.props.onOpenSetup(); tree = host.render();
      assert.ok(button(tree, 'copy130'));
      assert.equal(nodes(tree).find(node => node.type === 'RecoveryCard'), undefined);
      button(tree, 'offlineRecoveryReturn').props.onPress();
      assert.equal(host.render().type, 'RecoveryCard'); assert.equal(host.calls.length, 0);
    });
    await check(`${language}: older status retains the ordinary setup route`, () => {
      const host = harness({ ...base, offlineRecovery: undefined, developerOptionsEnabled: true, wirelessDebuggingEnabled: true }, 'wizard');
      const tree = host.render(); assert.ok(button(tree, 'copy130'));
      assert.equal(nodes(tree).find(node => node.type === 'RecoveryCard'), undefined);
      assert.equal(host.calls.length, 0);
    });
    await check(`${language}: nearby permission is separate and never requested on render`, async () => {
      const host = harness(nested(ready, { nearbyWifiGranted: false }));
      const tree = host.render(); assert.equal(host.calls.length, 0);
      assert.equal(button(tree, 'offlineRecoveryActivate'), undefined);
      button(tree, 'offlineRecoveryNearbyAction').props.onPress(); assert.equal(host.calls.length, 0);
      assert.equal(host.alerts[0][1], core.t('offlineRecoveryNearbyHelp'));
      host.alerts[0][2][1].onPress(); await flush(); assert.deepEqual(host.calls, ['permission']);
    });
    await check(`${language}: activation uses only the explicit offline button`, async () => {
      const host = harness(ready); const tree = host.render(); assert.equal(host.calls.length, 0);
      button(tree, 'offlineRecoveryActivate').props.onPress(); await flush(); assert.deepEqual(host.calls, ['activate']);
    });
    await check(`${language}: native progress remains cancelable while recorder action is busy`, async () => {
      const host = harness({ ...nested(ready, { running: true, stage: 'restoring' }), controls: { isBusy: true } });
      const tree = host.render(); assert.ok(text(tree).includes(core.t('offlineRecoveryRestoring')));
      assert.equal(nodes(tree).find(node => node.type === 'Switch').props.disabled, true);
      const cancel = button(tree, 'offlineRecoveryCancel'); assert.ok(cancel); assert.equal(cancel.props.disabled, false);
      cancel.props.onPress(); await flush(); assert.deepEqual(host.calls, ['cancel']);
    });
    await check(`${language}: a native ready stage without heartbeat is never presented as connected`, () => {
      const host = harness(nested(ready, { stage: 'ready' })); const tree = host.render();
      assert.equal(text(tree).includes(core.t('offlineRecoveryReady')), false);
      assert.ok(button(tree, 'offlineRecoveryActivate'));
      host.set({ ...ready, helperConnected: true }); const connected = host.render();
      assert.ok(text(connected).includes(core.t('offlineRecoveryReady')));
      assert.equal(button(connected, 'offlineRecoveryActivate'), undefined);
    });
    await check(`${language}: revoked preparation permission removes activation and offers preparation`, () => {
      const tree = harness(nested(ready, { secureSettingsGranted: false })).render();
      assert.equal(button(tree, 'offlineRecoveryActivate'), undefined);
      assert.ok(button(tree, 'offlineRecoveryPrepare'));
      assert.ok(button(tree, 'offlineRecoveryNormalSetup'));
    });
    await check(`${language}: radio-off error offers Wi-Fi settings without asking to join a network`, async () => {
      const host = harness(nested(ready, { errorCode: 'OFFLINE_WIFI_DISABLED' })); const tree = host.render();
      assert.ok(text(tree).includes(core.t('offlineRecoveryWifiDisabled')));
      button(tree, 'offlineRecoveryWifiSettings').props.onPress(); await flush();
      assert.deepEqual(host.calls, [['setup', 'wifi']]);
    });
    await check(`${language}: disabling calls native cleanup path`, async () => {
      const host = harness(ready); nodes(host.render()).find(node => node.type === 'Switch').props.onValueChange(false);
      await flush(); assert.deepEqual(host.calls, [['enable', false]]);
    });
    await check(`${language}: active recording, unsupported and old optional status fail safely`, () => {
      for (const state of [{ ...ready, controls: { isRecording: true } }, nested(ready, { supported: false }), { ...base, offlineRecovery: undefined }]) {
        const host = harness(state); const tree = host.render();
        assert.equal(nodes(tree).find(node => node.type === 'Switch').props.disabled, true);
        const activate = button(tree, 'offlineRecoveryActivate'); if (activate) assert.equal(activate.props.disabled, true);
        assert.equal(host.calls.length, 0); assert.equal(host.alerts.length, 0);
      }
    });
    await check(`${language}: activation completed while Settings is blurred unlocks the mounted card on return`, async () => {
      const activation = deferred();
      const host = harness({ ...ready, controls: { connectSystemRecorderOffline: () => activation.promise } });
      button(host.render(), 'offlineRecoveryActivate').props.onPress();
      assert.ok(button(host.render(), 'offlineRecoveryCancel'));
      host.blur();
      activation.resolve(); await flush();
      host.set({ ...ready, helperConnected: true }); host.focus();
      const returned = host.render();
      assert.equal(button(returned, 'offlineRecoveryCancel'), undefined);
      assert.equal(nodes(returned).find(node => node.type === 'Switch').props.disabled, false);
      assert.ok(text(returned).includes(core.t('offlineRecoveryReady')));
      assert.equal(host.lateStateWrites(), 0);
    });
    await check(`${language}: cancellation completed while blurred does not leave cancel or retry disabled`, async () => {
      const cancellation = deferred();
      const host = harness({ ...nested(ready, { running: true, stage: 'discovering' }),
        controls: { cancelOfflineRecovery: () => cancellation.promise } });
      button(host.render(), 'offlineRecoveryCancel').props.onPress();
      assert.equal(button(host.render(), 'offlineRecoveryCancel').props.disabled, true);
      host.blur(); cancellation.resolve(); await flush(); host.focus();
      assert.equal(button(host.render(), 'offlineRecoveryCancel').props.disabled, false);
      host.set(nested(ready, { running: false, stage: 'canceled' }));
      const returned = host.render();
      assert.equal(nodes(returned).find(node => node.type === 'Switch').props.disabled, false);
      assert.equal(button(returned, 'offlineRecoveryActivate').props.disabled, false);
      assert.equal(host.lateStateWrites(), 0);
    });
    await check(`${language}: native settlement does not unlock activation while cancellation is still pending`, async () => {
      const cancellation = deferred();
      const host = harness({ ...nested(ready, { running: true, stage: 'restoring' }),
        controls: { cancelOfflineRecovery: () => cancellation.promise } });
      button(host.render(), 'offlineRecoveryCancel').props.onPress();
      host.set(nested(ready, { running: false, stage: 'canceled' }));
      let tree = host.render();
      assert.equal(button(tree, 'offlineRecoveryCancel').props.disabled, true);
      assert.equal(button(tree, 'offlineRecoveryActivate'), undefined);
      assert.equal(nodes(tree).find(node => node.type === 'Switch').props.disabled, true);
      cancellation.resolve(); await flush(); tree = host.render();
      assert.equal(button(tree, 'offlineRecoveryCancel'), undefined);
      assert.equal(button(tree, 'offlineRecoveryActivate').props.disabled, false);
    });
    await check(`${language}: operation failure after a true unmount cannot write component state`, async () => {
      const activation = deferred();
      const host = harness({ ...ready, controls: { connectSystemRecorderOffline: () => activation.promise } });
      button(host.render(), 'offlineRecoveryActivate').props.onPress();
      host.unmount(); activation.reject(new Error(core.t('offlineRecoveryFailed'))); await flush();
      assert.equal(host.lateStateWrites(), 0);
    });
    await check(`${language}: cancellation failure after a true unmount cannot write component state`, async () => {
      const cancellation = deferred();
      const host = harness({ ...nested(ready, { running: true, stage: 'discovering' }),
        controls: { cancelOfflineRecovery: () => cancellation.promise } });
      button(host.render(), 'offlineRecoveryCancel').props.onPress();
      host.unmount(); cancellation.reject(new Error(core.t('offlineRecoveryFailed'))); await flush();
      assert.equal(host.lateStateWrites(), 0);
    });
    await check(`${language}: all recovery rejection codes are translated; unknown data stays hidden`, async () => {
      const codes = ['OFFLINE_UNSUPPORTED', 'OFFLINE_DISABLED', 'OFFLINE_PERMISSION_REQUIRED', 'OFFLINE_NEARBY_PERMISSION_REQUIRED',
        'OFFLINE_PAIRING_REQUIRED', 'OFFLINE_SETUP_REQUIRED', 'OFFLINE_ADMIN_RESTRICTED', 'OFFLINE_RECORDING_BUSY',
        'OFFLINE_FOREGROUND_REQUIRED', 'OFFLINE_ACTIVATION_BUSY', 'OFFLINE_HOTSPOT_FAILED', 'OFFLINE_TIMEOUT',
        'OFFLINE_CANCELED', 'OFFLINE_ADB_FAILED', 'OFFLINE_SHELL_IDENTITY_FAILED', 'OFFLINE_GRANT_FAILED',
        'OFFLINE_BOOTSTRAP_FAILED', 'OFFLINE_AUTHENTICATION_FAILED', 'OFFLINE_HANDOFF_FAILED', 'OFFLINE_RESTORE_FAILED',
        'OFFLINE_HEARTBEAT_FAILED', 'OFFLINE_OWNER_FAILED', 'OFFLINE_SETTINGS_SAVE_FAILED', 'OFFLINE_WIFI_DISABLED'];
      for (const code of codes) {
        moduleState.NativeModules.CallRecorder = { connectSystemRecorderOffline: async () => { throw { code, message: 'private raw native details' }; } };
        await assert.rejects(bridgeExports.NativeRecorder.connectSystemRecorderOffline(), error => {
          assert.equal(error.code, code); assert.equal(error.message.includes('private raw'), false);
          assert.ok(Object.values(catalog[language]).includes(error.message)); return true;
        });
      }
      assert.equal(bridgeExports.recorderErrorMessage('unknown', 'private raw native details'), core.t('copy009'));
    });
  }
  await check('native setting result must confirm the requested persisted opt-in', async () => {
    moduleState.NativeModules.CallRecorder = { setOfflineRecoveryEnabled: async () => base };
    await assert.rejects(bridgeExports.NativeRecorder.setOfflineRecoveryEnabled(true));
    moduleState.NativeModules.CallRecorder = { setOfflineRecoveryEnabled: async () => ready };
    assert.equal((await bridgeExports.NativeRecorder.setOfflineRecoveryEnabled(true)).offlineRecovery.enabled, true);
  });
  await check('ordinary builds without recovery status remain readable', async () => {
    moduleState.NativeModules.CallRecorder = { getSystemAccessStatus: async () => ({ ...base, offlineRecovery: undefined }) };
    assert.equal((await bridgeExports.NativeRecorder.getSystemAccessStatus()).paired, true);
  });
  console.log(`Offline recovery UI/bridge: ${passed} checks passed (host only; no device recovery tested).`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
