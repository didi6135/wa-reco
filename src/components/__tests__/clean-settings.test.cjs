'use strict';
// Real Settings TSX/disclosure transitions with bounded context/card fixtures. No device/provider calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { core } = require('../../i18n/__tests__/load-core.cjs')();
const compiled = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../../screens/SettingsScreen.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const recoveryCompiled = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../OfflineRecoveryCard.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

function harness(overrides = {}) {
  let cursor = 0, renderedCards = [];
  const slots = [], calls = [], effects = [], alerts = [];
  let recording = { isBusy: false, isRecording: false, autoRecordingStatus: { mode: 'system', enabled: false },
    systemAccessStatus: { paired: true, helperConnected: true, wirelessDebuggingEnabled: true,
      offlineRecovery: { supported: true, enabled: false, secureSettingsGranted: false, nearbyWifiGranted: false, running: false } },
    setOfflineRecoveryEnabled: async enabled => calls.push(['recovery-enabled', enabled]),
    requestOfflineRecoveryPermission: async () => calls.push('recovery-permission'),
    connectSystemRecorderOffline: async () => calls.push('recover-helper'), cancelOfflineRecovery: async () => calls.push('cancel-recovery'),
    openSystemAccessSetup: async destination => calls.push(['system-settings', destination]), ...overrides.recording };
  let setup = { loading: false, setupError: null, readiness: { mode: 'system', microphone: true,
    notifications: true, captureReady: true, automatic: false, allReady: false },
    refresh: async () => calls.push('read-status'), ...overrides.setup };
  const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) { const index = cursor++; slots[index] ??= { value: initial };
      return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useEffect(action) { const index = cursor++; if (!slots[index]) { slots[index] = {}; effects.push(() => { slots[index].cleanup = action(); }); } },
  };
  const exported = {};
  const native = { ...Object.fromEntries(['View', 'Text', 'ScrollView', 'TouchableOpacity', 'ActivityIndicator', 'Switch'].map(name => [name, name])),
    StyleSheet: { create: value => value, hairlineWidth: 1 }, Alert: { alert: (...args) => alerts.push(args) },
    Linking: { openSettings: async () => calls.push('app-settings') } };
  const card = name => props => {
    renderedCards.push({ name, props });
    return react.createElement('View', { card: name }, react.createElement('Text', {}, name));
  };
  let recoveryComponent;
  function load(name) {
    if (name === 'react') return react;
    if (name === 'react-native') return native;
    if (name === '../i18n') return { ...core, useLocalizedStyles: value => core.directionalStyles(value, core.getLanguage()),
      useLocalization: () => ({ language: core.getLanguage(), isRTL: core.getLanguage() === 'he', error: null,
        selectLanguage: async language => { calls.push(['language', language]); core.activateLanguage(language); } }) };
    if (name === '@react-navigation/native') return { useNavigation: () => ({ navigate: screen => calls.push(['navigate', screen]) }) };
    if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0 }) };
    if (name === '../context/RecordingContext') return { useRecording: () => recording };
    if (name === '../setup/SetupContext') return { useSetup: () => setup };
    if (name === '../components/Visuals') return { BottomNav: 'BottomNav' };
    if (name === '../theme') return { colors: {}, ui: { ...Object.fromEntries(['screen', 'content', 'title', 'subtitle', 'label', 'warning', 'disabled', 'primaryText', 'secondaryText', 'body', 'card'].map(key => [key, {}])), primaryButton: { primary: true }, secondaryButton: {} } };
    if (name === '../services/NativeRecorder') return { recorderErrorMessage: code => code };
    if (name === '../components/OfflineRecoveryCard' && overrides.productionRecovery) return recoveryComponent;
    if (/^\.\.\/components\/(AutoRecordingCard|DriveBackupCard|TelegramBackupCard|CallNameCard|OfflineRecoveryCard)$/.test(name)) return card(name.split('/').pop());
    throw Error(`Unexpected Settings import ${name}`);
  }
  if (overrides.productionRecovery) {
    const recoveryExports = {};
    vm.runInNewContext(recoveryCompiled, { exports: recoveryExports, module: { exports: recoveryExports }, require: load });
    recoveryComponent = recoveryExports.default;
  }
  vm.runInNewContext(compiled, { exports: exported, module: { exports: exported }, require: load });
  function expand(node) {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function') return expand(node.type({ ...node.props, children: node.children }));
    return { ...node, children: node.children.map(expand) };
  }
  return { calls, alerts, cards: () => renderedCards,
    render() { cursor = 0; renderedCards = []; const tree = expand(exported.default()); while (effects.length) effects.shift()(); return tree; },
    setRecording(next) { recording = { ...recording, ...next }; },
    setSetup(next) { setup = { ...setup, ...next }; },
  };
}
function nodes(node) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(nodes); return [node, ...nodes(node.children)]; }
function text(node) { if (node == null || typeof node === 'boolean') return ''; if (typeof node === 'string') return node; if (Array.isArray(node)) return node.map(text).join(' '); return node.children.map(text).join(node.type === 'Text' ? '' : ' '); }
function row(tree, label) { return nodes(tree).find(node => node.type === 'TouchableOpacity' && node.props.accessibilityLabel === label && 'expanded' in (node.props.accessibilityState || {})); }
function button(tree, key) { return nodes(tree).find(node => node.type === 'TouchableOpacity' && text(node) === core.t(key)); }
function primary(tree) { return nodes(tree).filter(node => node.type === 'TouchableOpacity' && [node.props.style].flat().some(style => style?.primary)); }
let passed = 0;
async function check(work) { await work(); passed++; }

async function main() {
  for (const language of ['he', 'en']) {
    core.activateLanguage(language);
    await check(() => {
      const host = harness(); const tree = host.render();
      assert.ok(text(tree).includes(core.t('cleanSettingsManualReady')));
      assert.ok(text(tree).includes(core.t('cleanSettingsAutoOff')));
      assert.ok(!text(tree).includes(core.t('cleanSettingsNeedsSetup')));
      assert.ok(text(tree).includes(core.t('systemReadyTestHint')));
      assert.equal(primary(tree).length, 1); assert.equal(host.cards().length, 0); assert.equal(host.calls.length, 0);
      assert.ok(row(tree, core.t('offlineRecoveryTitle')));
      for (const key of ['accessibilityMicTitle', 'copy112', 'copy116']) assert.ok(!text(tree).includes(core.t(key)));
    });
    await check(() => {
      const host = harness({ recording: { autoRecordingStatus: { enabled: true } } });
      assert.ok(text(host.render()).includes(core.t('cleanSettingsManualReady')));
      assert.ok(text(host.render()).includes(core.t('cleanSettingsAutoNeedsAction')));
      assert.ok(!text(host.render()).includes(core.t('cleanSettingsAutomaticReady')));
      host.setSetup({ readiness: { mode: 'system', captureReady: true, microphone: true, notifications: true, automatic: true } });
      assert.ok(text(host.render()).includes(core.t('cleanSettingsAutomaticReady')));
      assert.equal(host.calls.length, 0);
    });
    await check(() => {
      const host = harness({ setup: { readiness: { mode: 'system', captureReady: false, microphone: true, notifications: true, automatic: false } } });
      const tree = host.render(); assert.ok(text(tree).includes(core.t('cleanSettingsNeedsSetup')));
      button(tree, 'cleanSettingsCompleteSetup').props.onPress(); assert.deepEqual(host.calls, [['navigate', 'Setup']]);
    });
    await check(() => {
      for (const recording of [{ isBusy: true }, { isRecording: true }]) {
        const host = harness({ recording }); const target = button(host.render(), 'cleanSettingsManageRecording');
        assert.equal(target.props.disabled, true); target.props.onPress(); assert.equal(host.calls.length, 0);
        if (recording.isRecording) assert.ok(text(host.render()).includes(core.t('cleanSettingsRecording')));
      }
      const host = harness({ setup: { setupError: 'check failed' } });
      assert.ok(text(host.render()).includes(core.t('cleanSettingsNeedsCheck')));
      assert.ok(!text(host.render()).includes(core.t('cleanSettingsManualReady')));
    });
    await check(() => {
      const host = harness(); row(host.render(), core.t('copy015')).props.onPress();
      assert.deepEqual(host.cards().length, 0); host.render(); assert.deepEqual(host.cards().map(card => card.name), ['AutoRecordingCard']);
      row(host.render(), core.t('copy015')).props.onPress(); host.render(); assert.equal(host.cards().length, 0);
      assert.equal(host.calls.length, 0);
    });
    await check(() => {
      const host = harness(); row(host.render(), core.t('cleanSettingsBackups')).props.onPress(); let tree = host.render();
      assert.equal(host.cards().length, 0); assert.ok(row(tree, 'Google Drive')); assert.ok(row(tree, 'Telegram'));
      row(tree, 'Google Drive').props.onPress(); host.render(); assert.deepEqual(host.cards().map(card => card.name), ['DriveBackupCard']);
      row(host.render(), 'Telegram').props.onPress(); host.render(); assert.deepEqual(host.cards().map(card => card.name), ['TelegramBackupCard']);
      row(host.render(), core.t('cleanSettingsBackups')).props.onPress(); host.render(); assert.equal(host.cards().length, 0);
      assert.equal(host.calls.length, 0);
    });
    await check(() => {
      const host = harness({ recording: { isBusy: true, isRecording: true } });
      row(host.render(), core.t('callNameTitle')).props.onPress(); host.render();
      assert.equal(host.cards()[0].name, 'CallNameCard'); assert.equal(host.cards()[0].props.recorderBusy, true); assert.equal(host.cards()[0].props.isRecording, true);
      row(host.render(), core.t('cleanSettingsBackups')).props.onPress(); row(host.render(), 'Google Drive').props.onPress(); host.render();
      assert.equal(host.cards()[0].props.recorderBusy, true); assert.equal(host.cards()[0].props.isRecording, true);
      assert.equal(host.calls.length, 0);
    });
    await check(async () => {
      const host = harness(); row(host.render(), core.t('languageTitle')).props.onPress(); let tree = host.render();
      const radios = nodes(tree).filter(node => node.type === 'TouchableOpacity' && node.props.accessibilityRole === 'radio');
      assert.equal(radios.length, 2); assert.equal(host.cards().length, 0);
      const next = language === 'he' ? 'en' : 'he'; radios.find(node => text(node) === core.t(next === 'he' ? 'languageHebrew' : 'languageEnglish')).props.onPress();
      await flush(); assert.deepEqual(host.calls, [['language', next]]); assert.equal(core.getLanguage(), next); core.activateLanguage(language);
    });
    await check(async () => {
      const pending = deferred(); const host = harness({ setup: { refresh: () => { host.calls.push('read-status'); return pending.promise; } } });
      button(host.render(), 'cleanSettingsCheckAgain').props.onPress(); let tree = host.render();
      assert.ok(text(tree).includes(core.t('cleanSettingsChecking'))); assert.equal(primary(tree)[0].props.disabled, true);
      pending.resolve(); await flush(); assert.ok(text(host.render()).includes(core.t('cleanSettingsManualReady')));
      assert.deepEqual(host.calls, ['read-status']);
    });
    await check(() => {
      for (const mismatch of [{ mode: 'accessibilityMic', statusMode: 'accessibilityMic' },
        { mode: 'system', statusMode: 'accessibilityMic' }, { mode: 'accessibilityMic', statusMode: 'system' }]) {
        const host = harness({ recording: { autoRecordingStatus: { mode: mismatch.statusMode, enabled: true, armed: true } },
          setup: { readiness: { mode: mismatch.mode, captureReady: true, microphone: true, notifications: true, automatic: true } } });
        const tree = host.render(); assert.ok(text(tree).includes(core.t('pairedSetupRestoreTitle')));
        assert.ok(!text(tree).includes(core.t('cleanSettingsManualReady'))); assert.ok(!text(tree).includes(core.t('cleanSettingsAutomaticReady')));
        assert.ok(!text(tree).includes(core.t('cleanSettingsAutoOn'))); assert.equal(primary(tree).length, 1);
        assert.equal(host.cards().length, 0); assert.equal(host.calls.length, 0);
        button(tree, 'pairedSetupRestoreAction').props.onPress(); assert.deepEqual(host.calls, [['navigate', 'Setup']]);
      }
    });
    await check(() => {
      const host = harness({ recording: { isRecording: true, autoRecordingStatus: { mode: 'accessibilityMic', enabled: true } },
        setup: { readiness: { mode: 'accessibilityMic', captureReady: true, microphone: true, notifications: true, automatic: true } } });
      const tree = host.render(); assert.ok(text(tree).includes(core.t('cleanSettingsRecording')));
      assert.equal(button(tree, 'pairedSetupRestoreAction').props.disabled, true);
      button(tree, 'pairedSetupRestoreAction').props.onPress(); assert.equal(host.calls.length, 0);
    });
    await check(() => {
      for (const captureReady of [true, false]) {
        const host = harness({ setup: { readiness: { mode: 'system', captureReady, microphone: true, notifications: true, automatic: false } } });
        let tree = host.render(); assert.ok(row(tree, core.t('offlineRecoveryTitle'))); assert.equal(host.cards().length, 0);
        row(tree, core.t('offlineRecoveryTitle')).props.onPress(); tree = host.render();
        assert.deepEqual(host.cards().map(card => card.name), ['OfflineRecoveryCard']); assert.equal(host.calls.length, 0);
        host.cards()[0].props.onOpenSetup(); assert.deepEqual(host.calls, [['navigate', 'Setup']]);
        host.calls.length = 0; row(tree, core.t('offlineRecoveryTitle')).props.onPress(); host.render();
        assert.equal(host.cards().length, 0); assert.equal(host.calls.length, 0);
      }
    });
    await check(() => {
      for (const recording of [{ isBusy: true }, { isRecording: true }]) {
        const host = harness({ recording }); row(host.render(), core.t('offlineRecoveryTitle')).props.onPress(); host.render();
        host.cards()[0].props.onOpenSetup(); assert.equal(host.calls.length, 0);
      }
      const host = harness({ recording: { autoRecordingStatus: { mode: 'accessibilityMic', enabled: true } } });
      row(host.render(), core.t('offlineRecoveryTitle')).props.onPress(); const tree = host.render();
      assert.equal(host.cards().length, 0); assert.ok(text(tree).includes(core.t('pairedSetupRestoreHelp')));
      assert.equal(host.calls.length, 0);
    });
    await check(async () => {
      const host = harness({ productionRecovery: true }); row(host.render(), core.t('offlineRecoveryTitle')).props.onPress();
      let tree = host.render(); assert.ok(text(tree).includes(core.t('offlineRecoveryHelp')));
      assert.ok(button(tree, 'offlineRecoveryPrepare')); assert.deepEqual(host.calls, []);
      button(tree, 'offlineRecoveryPrepare').props.onPress(); assert.equal(host.alerts[0][2][0].style, 'cancel'); assert.deepEqual(host.calls, []);
      host.alerts[0][2][1].onPress(); await flush(); assert.deepEqual(host.calls, [['recovery-enabled', true]]);
    });
    await check(async () => {
      const host = harness({ productionRecovery: true, recording: { systemAccessStatus: { paired: true, helperConnected: false,
        wirelessDebuggingEnabled: false, offlineRecovery: { supported: true, enabled: true, secureSettingsGranted: true, nearbyWifiGranted: true, running: false } } } });
      row(host.render(), core.t('offlineRecoveryTitle')).props.onPress(); let tree = host.render();
      assert.ok(button(tree, 'offlineRecoveryActivate')); assert.deepEqual(host.calls, []);
      button(tree, 'offlineRecoveryActivate').props.onPress(); await flush(); assert.deepEqual(host.calls, ['recover-helper']);
    });
    await check(() => {
      const host = harness({ productionRecovery: true, recording: { systemAccessStatus: { paired: true, helperConnected: true,
        wirelessDebuggingEnabled: false, offlineRecovery: { supported: true, enabled: true, secureSettingsGranted: true, nearbyWifiGranted: true, running: false } } } });
      row(host.render(), core.t('offlineRecoveryTitle')).props.onPress(); const tree = host.render();
      assert.ok(button(tree, 'offlineRecoveryContinueSetup')); assert.deepEqual(host.calls, []);
      button(tree, 'offlineRecoveryContinueSetup').props.onPress(); assert.deepEqual(host.calls, [['navigate', 'Setup']]);
    });
  }
  console.log(`Clean Settings: ${passed} checks passed (production TSX; synthetic context/card boundaries).`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
