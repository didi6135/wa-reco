'use strict';
// Actual initial navigator presentation with controlled provider state; no native actions or navigation side effects.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { core } = require('../../i18n/__tests__/load-core.cjs')();
function compile(relative, jsx = false) { return ts.transpileModule(fs.readFileSync(path.resolve(__dirname, relative), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: jsx ? ts.JsxEmit.React : undefined, esModuleInterop: true },
}).outputText; }
const flow = {};
vm.runInNewContext(compile('../../setup/connectionFlow.ts'), { exports: flow });
let state;
const exported = {};
vm.runInNewContext(compile('../AppNavigator.tsx', true), { exports: exported, module: { exports: exported }, require(name) {
  if (name === 'react') return { createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useRef: value => ({ current: value }), useState: value => [value, () => {}], useCallback: value => value };
  if (name === 'react-native') return { View: 'View', Text: 'Text', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: value => value } };
  if (name === '@react-navigation/native') return { DefaultTheme: { colors: {} }, NavigationContainer: 'NavigationContainer',
    createNavigationContainerRef: () => ({ isReady: () => false, navigate() { throw Error('Initial render must not navigate'); } }) };
  if (name === '@react-navigation/stack') return { createStackNavigator: () => ({ Navigator: 'StackNavigator', Screen: 'StackScreen' }) };
  if (name === '../i18n') return { ...core, useLocalization: () => ({ isRTL: core.getLanguage() === 'he' }),
    useLocalizedStyles: value => core.directionalStyles(value, core.getLanguage()) };
  if (name === '../setup/SetupContext') return { useSetup: () => state };
  if (name === '../setup/connectionFlow') return flow;
  if (name === '../hooks/useRestartResume') return { useRestartResume(ready) { assert.equal(ready, false); } };
  if (name === '../theme') return { colors: {} };
  if (name.startsWith('../screens/')) return { __esModule: true, default: name };
  throw Error(`Unexpected navigator dependency ${name}`);
} });
function nodes(node) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(nodes); return [node, ...nodes(node.children)]; }
function render(next) { state = next; return exported.default(); }
function initial(next) { return nodes(render(next)).find(node => node.type === 'StackNavigator')?.props.initialRouteName; }
let passed = 0;
function check(name, action) { action(); passed++; }
for (const language of ['he', 'en']) {
  core.activateLanguage(language);
  check(`${language}: fresh paired route enters Setup`, () => assert.equal(initial({ loading: false, completed: false, readiness: { mode: 'system' } }), 'Setup'));
  check(`${language}: completed paired route retains Home`, () => assert.equal(initial({ loading: false, completed: true, readiness: { mode: 'system' } }), 'Home'));
  check(`${language}: completed legacy route enters explicit restore Setup`, () => {
    for (const completed of [true, false]) assert.equal(initial({ loading: false, completed, readiness: { mode: 'accessibilityMic' } }), 'Setup');
  });
  check(`${language}: initial read waits for setup snapshot before selecting legacy restore`, () => {
    assert.equal(initial({ loading: true, completed: true, readiness: { mode: 'system' } }), undefined);
    assert.equal(initial({ loading: false, completed: true, readiness: { mode: 'accessibilityMic' } }), 'Setup');
  });
  check(`${language}: confirmed system snapshot can use retained completion`, () => {
    assert.equal(initial({ loading: false, completed: true, readiness: { mode: 'accessibilityMic' } }), 'Setup');
    assert.equal(initial({ loading: false, completed: true, readiness: { mode: 'system' } }), 'Home');
  });
  check(`${language}: rendering unknown or restored state has no migration and no locale remount key`, () => {
    const next = { loading: false, completed: true, readiness: { mode: 'invalid' } }, before = JSON.stringify(next);
    const tree = render(next); assert.equal(JSON.stringify(next), before);
    assert.equal(nodes(tree).find(node => node.type === 'StackNavigator').props.initialRouteName, 'Setup');
    assert.equal(tree.props.direction, language === 'he' ? 'rtl' : 'ltr'); assert.equal(tree.props.key, undefined);
  });
}
console.log(`paired initial navigation: ${passed} checks passed`);
