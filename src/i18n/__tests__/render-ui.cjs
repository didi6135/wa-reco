'use strict';
// Conditional React Native screen rendering with controlled state; no permissions, audio or device access.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
module.exports = function createUiHarness(core) {
  const root = path.resolve(__dirname, '../..'); const cache = new Map(); let recording, setup, route;
  const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useMemo: fn => fn(), useRef: current => ({ current }), useCallback: fn => fn, useEffect() {} };
  const native = { ...Object.fromEntries(['View', 'Text', 'ScrollView', 'FlatList', 'TouchableOpacity', 'TextInput', 'Switch', 'ActivityIndicator'].map(name => [name, name])), StyleSheet: { create: value => value, hairlineWidth: 1 }, Platform: { OS: 'android', Version: 36 }, AppState: { currentState: 'active' }, Alert: { alert: () => { throw Error('Rendering must not open a dialog'); } }, Linking: {}, PermissionsAndroid: {} };
  const localization = { ...core, useLocalizedStyles: styles => core.directionalStyles(styles, core.getLanguage()), useLocalization: () => ({ language: core.getLanguage(), isRTL: core.getLanguage() === 'he', ready: true, error: null, selectLanguage: async () => {} }) };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exported = {}; cache.set(file, exported);
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
    vm.runInNewContext(compiled, { exports: exported, module: { exports: exported }, Error, require: name => {
      if (name === 'react') return react;
      if (name === 'react-native') return native;
      if (name === '@react-navigation/native') return { useNavigation: () => ({ navigate() {}, reset() {}, canGoBack: () => true, goBack() {} }), useRoute: () => ({ params: route }), useFocusEffect() {} };
      if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
      if (name === 'react-native-audio-recorder-player') return class AudioPlayer {};
      if (name.endsWith('/i18n') || name.endsWith('/i18n/core')) return localization;
      if (name.endsWith('/context/RecordingContext')) return { useRecording: () => recording };
      if (name.endsWith('/setup/SetupContext')) return { useSetup: () => setup };
      if (name.endsWith('/hooks/useDriveBackup')) return { useDriveBackup: () => ({ status: null, checking: true, action: null, error: null, errorAction: null, run() {}, refresh() {} }) };
      if (name.endsWith('/services/NativeDriveBackup')) return { NativeDriveBackup: {}, driveErrorMessage: () => '', driveActionErrorMessage: () => '' };
      if (name.endsWith('/hooks/useTelegramBackup')) return { useTelegramBackup: () => ({ status: null, checking: true, action: null, error: null, run() {}, refresh() {} }) };
      if (name.endsWith('/services/NativeTelegramBackup')) return { NativeTelegramBackup: {}, telegramErrorMessage: () => '' };
      if (name.endsWith('/services/NativeRecorder')) return {};
      if (name.endsWith('/utils/permissions')) return {};
      if (!name.startsWith('.')) throw Error(`Unexpected UI dependency ${name}`);
      const target = path.resolve(path.dirname(file), name);
      const resolved = fs.existsSync(`${target}.tsx`) ? `${target}.tsx` : fs.existsSync(`${target}.ts`) ? `${target}.ts` : path.join(target, 'index.ts');
      return load(resolved);
    } }, { filename: file }); return exported;
  }
  function text(node) {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(text).join(' ');
    if (typeof node.type === 'function') return text(node.type({ ...node.props, children: node.children }));
    if (node.type === 'FlatList') return text([node.props.ListHeaderComponent, node.props.data.length ? node.props.data.map(item => node.props.renderItem({ item })) : node.props.ListEmptyComponent]);
    return node.children.map(text).join(node.type === 'Text' ? '' : ' ');
  }
  return {
    render(screen, nextRecording, nextSetup) {
      recording = { accessibilityMicStatus: null, ...nextRecording };
      setup = { ...nextSetup, readiness: { mode: 'system', captureReady: nextSetup.readiness.helper,
        automaticSupported: true, ...nextSetup.readiness } };
      route = { recordingId: nextRecording.recordings[0]?.id };
      return text(load(path.join(root, `screens/${screen}.tsx`)).default());
    },
    recordButton(isRecording) { return text(load(path.join(root, 'components/RecordButton.tsx')).default({ isRecording, onPress() {} })); },
  };
};
