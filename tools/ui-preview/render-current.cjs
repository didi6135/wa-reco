'use strict';
// Render actual TSX and styles with bounded synthetic state. No device/provider/permission actions.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'artifacts/ui-preview');
const { core } = require('../../src/i18n/__tests__/load-core.cjs')();
const sourceHashes = {};
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function renderer(recording, setup) {
  const cache = new Map(), slots = new Map(); let instance = '', cursor = 0;
  const refuse = () => { throw Error('Preview cannot perform app actions'); };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) { const key = `${instance}:${cursor++}`; if (!slots.has(key)) slots.set(key, typeof initial === 'function' ? initial() : initial);
      return [slots.get(key), next => slots.set(key, typeof next === 'function' ? next(slots.get(key)) : next)]; },
    useRef(current) { const key = `${instance}:${cursor++}`; if (!slots.has(key)) slots.set(key, { current }); return slots.get(key); },
    useCallback: fn => fn, useMemo: fn => fn(), useEffect() {},
  };
  const native = { ...Object.fromEntries(['View', 'Text', 'ScrollView', 'FlatList', 'TouchableOpacity', 'TextInput', 'Switch', 'ActivityIndicator'].map(key => [key, key])),
    StyleSheet: { create: value => value, hairlineWidth: 1 }, Platform: { OS: 'android', Version: 36 },
    AppState: { currentState: 'active' }, Alert: { alert: refuse }, Linking: { openSettings: refuse }, PermissionsAndroid: {} };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const bytes = fs.readFileSync(file); sourceHashes[path.relative(root, file).replace(/\\/g, '/')] = hash(bytes);
    const exports = {}; cache.set(file, exports);
    const compiled = ts.transpileModule(bytes.toString('utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
    vm.runInNewContext(compiled, { exports, module: { exports }, Error, require(name) {
      if (name === 'react') return react;
      if (name === 'react-native') return native;
      if (name === '@react-navigation/native') return { useNavigation: () => ({ navigate: refuse, reset: refuse, goBack: refuse, canGoBack: () => true }), useFocusEffect() {} };
      if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
      if (name.endsWith('/i18n') || name.endsWith('/i18n/core')) return { ...core,
        useLocalizedStyles: styles => core.directionalStyles(styles, core.getLanguage()),
        useLocalization: () => ({ language: core.getLanguage(), isRTL: core.getLanguage() === 'he', ready: true, error: null, selectLanguage: refuse }) };
      if (name.endsWith('/context/RecordingContext')) return { useRecording: () => recording };
      if (name.endsWith('/setup/SetupContext')) return { useSetup: () => setup };
      if (name.endsWith('/hooks/useDriveBackup')) return { useDriveBackup: () => ({ status: null, checking: false, action: null, error: null, errorAction: null, run: refuse, refresh: refuse }) };
      if (name.endsWith('/hooks/useTelegramBackup')) return { useTelegramBackup: () => ({ status: null, checking: false, action: null, error: null, run: refuse, refresh: refuse }) };
      if (name.endsWith('/services/NativeDriveBackup')) return { NativeDriveBackup: {}, driveErrorMessage: () => '', driveActionErrorMessage: () => '' };
      if (name.endsWith('/services/NativeTelegramBackup')) return { NativeTelegramBackup: {}, telegramErrorMessage: () => '' };
      if (name.endsWith('/services/NativeRecorder') || name.endsWith('/utils/permissions')) return {};
      if (!name.startsWith('.')) throw Error(`Unexpected preview dependency ${name}`);
      const target = path.resolve(path.dirname(file), name);
      return load(fs.existsSync(`${target}.tsx`) ? `${target}.tsx` : fs.existsSync(`${target}.ts`) ? `${target}.ts` : path.join(target, 'index.ts'));
    } }, { filename: file }); return exports;
  }
  function materialize(node, location = 'root') {
    if (node == null || typeof node === 'boolean') return null;
    if (typeof node === 'string' || typeof node === 'number') return node;
    if (Array.isArray(node)) return node.map((item, index) => materialize(item, `${location}/${index}`));
    if (node.type == null) return materialize(node.children, `${location}/Fragment`);
    if (typeof node.type === 'function') { instance = `${location}/${node.type.name}`; cursor = 0;
      return materialize(node.type({ ...node.props, children: node.children }), instance); }
    const children = node.type === 'FlatList' ? [node.props.ListHeaderComponent, node.props.data.length ? node.props.data.map(item => node.props.renderItem({ item })) : node.props.ListEmptyComponent] : node.children;
    return { ...node, children: materialize(children, `${location}/${node.type}`) };
  }
  const text = node => node == null ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join(' ') : text(node.children);
  const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.children)];
  let screen;
  const render = () => materialize(react.createElement(load(path.join(root, `src/screens/${screen}.tsx`)).default, {}));
  return { render(nextScreen, expand = []) { screen = nextScreen; let tree = render();
    for (const key of expand) { const match = nodes(tree).find(node => node.type === 'TouchableOpacity' &&
      (node.props.accessibilityLabel === core.t(key) || text(node).includes(core.t(key))));
      if (!match?.props.onPress || match.props.disabled) throw Error(`Missing enabled preview disclosure ${key}`);
      match.props.onPress(); tree = render(); }
    return tree;
  } };
}
function flatten(value) { if (!value) return {}; return Array.isArray(value) ? Object.assign({}, ...value.map(flatten)) : value; }
function css(value) {
  const styles = flatten(value), out = [];
  const unitless = new Set(['opacity', 'fontWeight', 'flexGrow', 'flexShrink', 'zIndex', 'order']);
  for (let [key, value] of Object.entries(styles)) {
    if (value == null || ['shadowOffset', 'shadowColor', 'shadowOpacity', 'shadowRadius', 'elevation', 'includeFontPadding', 'textAlignVertical'].includes(key)) continue;
    if (key === 'flex') { out.push(`flex:${value} 1 0%`); continue; }
    if (key === 'writingDirection') { out.push(`direction:${value}`); continue; }
    if (key === 'transform') { out.push(`transform:${value.map(item => Object.entries(item).map(([k, v]) => `${k}(${v}${typeof v === 'number' ? 'px' : ''})`).join(' ')).join(' ')}`); continue; }
    const expand = { paddingHorizontal: ['paddingLeft', 'paddingRight'], paddingVertical: ['paddingTop', 'paddingBottom'], marginHorizontal: ['marginLeft', 'marginRight'], marginVertical: ['marginTop', 'marginBottom'], borderWidth: ['borderWidth'], borderColor: ['borderColor'] };
    const keys = expand[key] || [key];
    for (const property of keys) out.push(`${property.replace(/[A-Z]/g, ch => '-' + ch.toLowerCase())}:${typeof value === 'number' && !unitless.has(property) ? value + 'px' : value}`);
  }
  if (Object.keys(styles).some(key => key.startsWith('border') && key.endsWith('Width'))) out.push('border-style:solid');
  return out.join(';');
}
function html(node) {
  if (node == null) return '';
  if (typeof node !== 'object') return escape(node);
  if (Array.isArray(node)) return node.map(html).join('');
  const { type, props } = node;
  if (type === 'Switch') return `<input aria-label="${escape(props.accessibilityLabel || '')}" type="checkbox" ${props.value ? 'checked' : ''} disabled>`;
  if (type === 'TextInput') return `<input aria-label="${escape(props.accessibilityLabel || '')}" placeholder="${escape(props.placeholder || '')}" value="${escape(props.value || '')}" style="${css(props.style)}" disabled>`;
  const tag = type === 'Text' ? 'span' : type === 'TouchableOpacity' ? 'button' : 'div';
  const content = html(node.children);
  const scroll = type === 'ScrollView' || type === 'FlatList';
  return `<${tag} data-kind="${escape(type)}" style="${css(props.style)}" ${props.disabled ? 'disabled' : ''}${props.accessibilityLabel ? ' aria-label="' + escape(props.accessibilityLabel) + '"' : ''}>${scroll ? `<div data-kind="View" style="${css(props.contentContainerStyle)}">${content}</div>` : content}</${tag}>`;
}
const noop = async () => { throw Error('Synthetic preview forbids native/provider actions'); };
const baseRecording = {
  isBusy: false, isRecording: false, status: { audioMode: 0, source: 'microphone', usbConnected: true }, recordings: [],
  accessibilityMicStatus: { supported: true, selected: false, enabled: false, connected: false, automaticSupported: true, appInfoRecoverySupported: true, source: 'voice_recognition', experimental: true, route: 'unknown', routeKnown: false },
  systemAccessStatus: { available: true, helperConnected: true, connecting: false, paired: true, wirelessDebuggingEnabled: false, developerOptionsEnabled: true,
    offlineRecovery: { supported: true, enabled: true, secureSettingsGranted: true, nearbyWifiGranted: true, running: false, stage: 'idle' } },
  autoRecordingStatus: { mode: 'system', enabled: false, armed: false, modeReady: true, helperConnected: true, automaticSupported: true, notificationAccessGranted: true, listenerConnected: true, notificationsEnabled: true, state: 'disabled', callDisplayNameConsent: false },
  enableAutoRecording: noop, disableAutoRecording: noop, setRecordingMode: noop, openAccessibilityMicSetup: noop, openAccessibilityMicAppInfo: noop,
  refreshAccessibilityMicStatus: noop, refreshAutoRecordingStatus: noop, openNotificationAccessSetup: noop,
};
const baseSetup = { loading: false, completed: true, setupError: null, supported: true,
  readiness: { mode: 'system', captureReady: true, automaticSupported: true, microphone: true, notifications: true, callAccess: true, helper: true, automatic: false, allReady: false },
  systemAccessStatus: baseRecording.systemAccessStatus, refresh: noop, completeOnboarding: noop, completeManualOnboarding: noop };
const scenarios = [
  { id: 'home-auto-off', screen: 'HomeScreen', title: 'Home automatic status' },
  { id: 'home-auto-ready', screen: 'HomeScreen', title: 'Home automatic ready', mutate(r) { Object.assign(r.autoRecordingStatus, { enabled: true, armed: true, state: 'ready' }); } },
  { id: 'home-offline-call', screen: 'HomeScreen', title: 'Prepared call activation', expand: ['copy246'], mutate(r) { r.status.usbConnected = false; r.systemAccessStatus.helperConnected = false; r.autoRecordingStatus.helperConnected = false; } },
  { id: 'settings-recovery-ready', screen: 'SettingsScreen', title: 'Recovery while connected', expand: ['offlineRecoveryTitle'] },
  { id: 'settings-recovery-preparation', screen: 'SettingsScreen', title: 'One-time preparation', expand: ['offlineRecoveryTitle'], mutate(r) { r.systemAccessStatus.wirelessDebuggingEnabled = true; Object.assign(r.systemAccessStatus.offlineRecovery, { enabled: false, secureSettingsGranted: false, nearbyWifiGranted: false }); } },
  { id: 'settings-recovery-activate', screen: 'SettingsScreen', title: 'Activate without a network', expand: ['offlineRecoveryTitle'], mutate(r, s) { r.systemAccessStatus.helperConnected = false; r.status.usbConnected = false; s.readiness.captureReady = false; } },
  { id: 'settings-ready', screen: 'SettingsScreen', title: 'Connected · Auto off' },
  { id: 'settings-auto', screen: 'SettingsScreen', title: 'Auto controls', expand: ['copy015'] },
  { id: 'settings-backups', screen: 'SettingsScreen', title: 'Backup choices', expand: ['cleanSettingsBackups'] },
  { id: 'settings-language', screen: 'SettingsScreen', title: 'Language controls', expand: ['languageTitle'] },
  { id: 'settings-missing', screen: 'SettingsScreen', title: 'Connection needed', mutate(r, s) { r.systemAccessStatus.helperConnected = false; s.readiness.captureReady = false; } },
  { id: 'setup-fresh', screen: 'SetupScreen', title: 'First paired connection', mutate(r, s) { r.systemAccessStatus.helperConnected = false; r.systemAccessStatus.paired = false; r.systemAccessStatus.developerOptionsEnabled = false; s.completed = false; s.readiness = { ...s.readiness, captureReady: false, microphone: false, notifications: false, callAccess: false }; } },
  { id: 'setup-restore', screen: 'SetupScreen', title: 'Explicit return to paired calls', mutate(r, s) { r.autoRecordingStatus.mode = 'accessibilityMic'; r.accessibilityMicStatus.selected = true; s.readiness.mode = 'accessibilityMic'; } },
  { id: 'settings-legacy', screen: 'SettingsScreen', title: 'Restore previous call connection', mutate(r, s) { r.autoRecordingStatus.mode = 'accessibilityMic'; r.accessibilityMicStatus.selected = true; s.readiness.mode = 'accessibilityMic'; } },
  { id: 'setup-wireless', screen: 'SetupScreen', title: 'Wireless debugging guidance', mutate(r, s) { r.systemAccessStatus.helperConnected = false; r.systemAccessStatus.paired = false; s.readiness.captureReady = false; } },
  { id: 'setup-automatic', screen: 'SetupScreen', title: 'Optional Auto', mutate(r, s) { s.completed = false; } },
  { id: 'setup-paired', screen: 'SetupScreen', title: 'Existing paired connection', mutate(r, s) { r.autoRecordingStatus.mode = 'system'; r.accessibilityMicStatus.selected = false; r.systemAccessStatus.paired = true; s.readiness.mode = 'system'; s.readiness.captureReady = false; } },
];
const clone = value => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item && typeof item === 'object' ? clone(item) : item]));
fs.mkdirSync(output, { recursive: true });
const cards = [];
for (const language of ['he', 'en']) {
  core.activateLanguage(language);
  for (const scenario of scenarios) {
    const recording = clone(baseRecording), setup = clone(baseSetup); scenario.mutate?.(recording, setup); setup.systemAccessStatus = recording.systemAccessStatus;
    const tree = renderer(recording, setup).render(scenario.screen, scenario.expand);
    cards.push(`<section class="sample" data-case="${scenario.id}" data-language="${language}"><h2>${language.toUpperCase()} · ${escape(scenario.title)}</h2><div class="phone" dir="${language === 'he' ? 'rtl' : 'ltr'}">${html(tree)}</div></section>`);
  }
}
for (const file of ['src/i18n/core.ts', 'src/i18n/catalog.ts']) sourceHashes[file] = hash(fs.readFileSync(path.join(root, file)));
const page = `<!doctype html><html><meta charset="utf-8"><title>wa-reco · Current TSX preview</title><style>
*{box-sizing:border-box;border-width:0}body{margin:0;background:#e7eeeb;color:#102A2E;font-family:Arial,sans-serif;padding:24px}h1{font-size:24px}h2{font-size:14px;font-weight:600}p{max-width:900px;line-height:1.6}.gallery{display:flex;gap:22px;flex-wrap:wrap}.sample{width:390px}.phone{width:100%;height:844px;border:1px solid #d1dcd7;border-radius:28px;overflow:hidden;display:flex;flex-direction:column;background:#F6F8F6}.phone>[data-kind]{flex:1;min-height:0} [data-kind=View],[data-kind=ScrollView],[data-kind=FlatList],[data-kind=TouchableOpacity]{display:flex;flex-direction:column;min-width:0;flex-shrink:0}[data-kind=Text]{white-space:pre-wrap;overflow-wrap:anywhere;min-width:0;flex-shrink:1;font-size:14px;line-height:1.4}[data-kind=ScrollView],[data-kind=FlatList]{flex:1;min-height:0;overflow:auto}[data-kind=TouchableOpacity]{font:inherit;cursor:default;border-color:#DFE7E3}[data-kind=TouchableOpacity]:disabled{opacity:.4}[data-kind=ActivityIndicator]{height:24px;width:24px;border:2px solid #C2EDDE;border-top-color:#21634F;border-radius:50%}.phone input{min-height:30px;max-width:100%}
[data-kind=View],[data-kind=ScrollView],[data-kind=FlatList],[data-kind=TouchableOpacity]{position:relative;direction:ltr}[data-kind=TouchableOpacity]{background:transparent}
</style><h1>wa-reco · Current screen preview</h1><p>Actual React Native screen source and styles, rendered with synthetic state. Android text metrics, system dialogs and recording behavior require device verification. Preview actions cannot request permissions, record or upload.</p><div class="gallery">${cards.join('')}</div></html>`;
fs.writeFileSync(path.join(output, 'current.html'), page, 'utf8');
fs.writeFileSync(path.join(output, 'current-source.json'), JSON.stringify({ renderer: 'actual TSX/styles with synthetic state', sourceHashes, scenarios: scenarios.map(item => item.id), languages: ['he', 'en'] }, null, 2) + '\n');
console.log(JSON.stringify({ output: 'artifacts/ui-preview/current.html', samples: cards.length, sourceFiles: Object.keys(sourceHashes).length }));
