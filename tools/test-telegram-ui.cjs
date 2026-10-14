'use strict';
// Real bridge/card/hook code with synthetic native replies. No Telegram, phone, or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const {core: localization} = require('../src/i18n/__tests__/load-core.cjs')();
const native = {NativeModules: {}, Platform: {OS: 'android'}};
function load(file, dependencies, extras = {}) {
  const output = {};
  const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true}}).outputText;
  vm.runInNewContext(js, {exports: output, module: {exports: output}, require: name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, ...extras}, {filename: file});
  return output;
}
const resources = load('src/i18n/telegram.ts', {'./core': localization});
const bridge = load('src/services/NativeTelegramBackup.ts', {'react-native': native, '../i18n/telegram': resources});
const {NativeTelegramBackup: api, TelegramBackupError: Failure, normalizeTelegramBackupStatus: normalize, telegramErrorMessage} = bridge;
const disconnected = {connected: false, enabled: false, connectionPending: false, botUsername: null, startLink: null, connectionExpiresAt: null, queued: 0, uploaded: 0, failed: 0, unknownOutcome: 0, uploading: false, lastErrorCode: null, lastErrorAt: null, statusCode: 'DISCONNECTED'};
const linked = {...disconnected, connected: true, botUsername: 'sample_test_bot', statusCode: 'DISABLED'};
const ready = {...linked, enabled: true, queued: 3, uploaded: 2, statusCode: 'READY'};
const pending = {...disconnected, connectionPending: true, botUsername: 'sample_test_bot', startLink: 'https://t.me/sample_test_bot?start=synthetic_nonce-123', connectionExpiresAt: 1890000000000, statusCode: 'AWAITING_CHAT'};
let passed = 0;
function check(name, operation) { operation(); passed++; }
async function checkAsync(name, operation) { await operation(); passed++; }
function invalid(overrides) { assert.throws(() => normalize({...disconnected, ...overrides}), error => error.code === 'TELEGRAM_STATUS_INVALID'); }
const settle = () => new Promise(resolve => setImmediate(resolve));

function textOf(node) {
  if (node === undefined || node === null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  return node.type === 'Text' ? node.children.map(textOf).join('') : textOf(node.children);
}
function nodesOf(node, match) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(child => nodesOf(child, match));
  return [...(match(node) ? [node] : []), ...nodesOf(node.children, match)];
}
function cardHarness(nextStatus, extra = {}) {
  const states = []; let cursor = 0; let cleanup; const actions = []; const alerts = []; const links = [];
  const react = {createElement: (type, props, ...children) => ({type, props, children}), useState(initial) {const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => {states[index] = value;}];}, useCallback: callback => callback};
  const state = {status: nextStatus, checking: false, action: null, error: null, refresh: () => {}, run: async (name, operation) => {actions.push({name, operation});}, ...extra};
  const card = load('src/components/TelegramBackupCard.tsx', {
    react, 'react-native': {...Object.fromEntries(['View', 'Text', 'TextInput', 'Switch', 'TouchableOpacity', 'ActivityIndicator'].map(name => [name, name])), StyleSheet: {create: value => value}, Alert: {alert: (...args) => alerts.push(args)}, Linking: {openURL: async url => {links.push(url);}}},
    '@react-navigation/native': {useFocusEffect: callback => {if (!cleanup) cleanup = callback();}},
    '../i18n': {useLocalization: () => ({language: localization.getLanguage()}), useLocalizedStyles: value => localization.directionalStyles(value, localization.getLanguage())},
    '../i18n/telegram': resources, '../hooks/useTelegramBackup': {useTelegramBackup: () => state}, '../services/NativeTelegramBackup': bridge, '../theme': {colors: {}, ui: {}},
  });
  return {actions, alerts, links, state, render(props = {}) {cursor = 0; return card.default({isRecording: false, recorderBusy: false, ...props});}, blur() {cleanup?.();}, button(tree, key) {return nodesOf(tree, n => n.type === 'TouchableOpacity' && textOf(n) === resources.telegramText(key))[0];}};
}

function hookHarness() {
  const slots = []; let cursor = 0; const effects = []; const timers = new Map(); let timerId = 0; let appListener;
  const appState = {currentState: 'active', addEventListener: (_, callback) => {appListener = callback; return {remove() {appListener = null;}};}};
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
  const react = {
    useState(initial) {const index = cursor++; if (!slots[index]) slots[index] = {value: initial}; return [slots[index].value, value => {slots[index].value = value;}];},
    useRef(initial) {const index = cursor++; if (!slots[index]) slots[index] = {current: initial}; return slots[index];},
    useCallback(callback, deps) {const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = {callback, deps}; return slots[index].callback;},
    useEffect(callback, deps) {const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) {slots[index]?.cleanup?.(); slots[index] = {deps}; effects.push(() => {slots[index].cleanup = callback();});}},
  };
  const hook = load('src/hooks/useTelegramBackup.ts', {react, 'react-native': {AppState: appState}, '@react-navigation/native': {useFocusEffect: callback => react.useEffect(callback, [callback])}, '../services/NativeTelegramBackup': bridge}, {setInterval: callback => {timers.set(++timerId, callback); return timerId;}, clearInterval: id => timers.delete(id)});
  return {render() {cursor = 0; const result = hook.useTelegramBackup(); while (effects.length) effects.shift()(); return result;}, dispose() {for (const slot of slots) slot?.cleanup?.();}, appState, background() {appState.currentState = 'background'; appListener?.('background');}, foreground() {appState.currentState = 'active'; appListener?.('active');}, tick() {for (const callback of timers.values()) callback();}, timers};
}

async function main() {
  localization.activateLanguage('he');
  check('public status copies only safe contract fields', () => {const value = normalize({...ready, token: 'synthetic-private', chatId: 'synthetic-private', errorMessage: 'synthetic-provider-body'}); assert.equal('token' in value, false); assert.equal('chatId' in value, false); assert.equal('errorMessage' in value, false); assert.equal(value.uploaded, 2);});
  check('all public phases are accepted with coherent sample status', () => {for (const value of [disconnected, pending, linked, ready, {...ready, uploading: true, statusCode: 'UPLOADING'}, {...ready, statusCode: 'ACTION_REQUIRED'}]) assert.equal(normalize(value).statusCode, value.statusCode);});
  check('unsafe primitive and missing fields are rejected', () => {for (const value of [null, [], 42, 'raw', {}]) assert.throws(() => normalize(value), e => e.code === 'TELEGRAM_STATUS_INVALID'); invalid({connected: 'true'}); invalid({uploading: undefined}); invalid({statusCode: 'SUCCESS'});});
  check('counts and timestamps are finite nonnegative safe integers', () => {for (const key of ['queued', 'uploaded', 'failed', 'unknownOutcome', 'lastErrorAt', 'connectionExpiresAt']) for (const value of [-1, NaN, Infinity, 0.1, Number.MAX_SAFE_INTEGER + 1, '1']) invalid({[key]: value});});
  check('incomplete or contradictory connections are rejected', () => {invalid({enabled: true}); invalid({connected: true}); invalid({connectionPending: true}); invalid({connectionExpiresAt: 1});});
  check('exact generated bot link and username are preserved', () => {assert.equal(normalize(pending).startLink, pending.startLink); assert.equal(normalize(linked).botUsername, 'sample_test_bot');});
  check('private chat links reject redirects, credentials, mismatch and extras', () => {for (const startLink of ['http://t.me/sample_test_bot?start=a', 'https://evil.test/sample_test_bot?start=a', 'https://t.me.evil.test/sample_test_bot?start=a', 'https://user@t.me/sample_test_bot?start=a', 'https://t.me/other_bot?start=a', 'https://t.me/sample_test_bot?start=a&extra=b', 'https://t.me/sample_test_bot?start=a#x', 'tg://resolve?domain=sample_test_bot', 'https://t.me/sample_test_bot?start=' + 'a'.repeat(65)]) assert.throws(() => normalize({...pending, startLink}), e => e.code === 'TELEGRAM_STATUS_INVALID');});
  check('unknown provider error codes are replaced, not exposed', () => {for (const lastErrorCode of ['new-private-code', '__proto__', 'toString']) assert.equal(normalize({...ready, lastErrorCode}).lastErrorCode, 'TELEGRAM_ACTION_FAILED');});
  check('every stable error has paired app-owned messages', () => {for (const language of ['he', 'en']) {localization.activateLanguage(language); for (const code of bridge.telegramErrorCodes) {assert.ok(telegramErrorMessage(code).length > 8); assert.notEqual(telegramErrorMessage(code), resources.telegramText('generic'));}}});
  check('stored error codes can be translated after a language change', () => {localization.activateLanguage('he'); const error = new Failure('NETWORK'); localization.activateLanguage('en'); assert.notEqual(error.message, telegramErrorMessage(error.code)); assert.match(telegramErrorMessage(error.code), /Pending files are preserved/);});
  await checkAsync('module absence and iOS reject safely', async () => {await assert.rejects(api.getStatus(), e => e.code === 'TELEGRAM_MODULE_UNAVAILABLE'); native.Platform.OS = 'ios'; await assert.rejects(api.getStatus(), e => e.code === 'TELEGRAM_ANDROID_ONLY'); native.Platform.OS = 'android';});
  const calls = [];
  native.NativeModules.TelegramBackup = Object.fromEntries(['getStatus', 'connect', 'verifyConnection', 'setEnabled', 'retryPending', 'disconnect'].map(name => [name, async (...args) => {calls.push({name, args}); return ready;} ]));
  await checkAsync('each API preserves native arguments and normalized result', async () => {await api.getStatus(); await api.connect('synthetic-token'); await api.verifyConnection(); await api.setEnabled(true); await api.retryPending(false); await api.retryPending(true); await api.disconnect(); assert.equal(calls.find(n => n.name === 'connect').args[0], 'synthetic-token'); assert.equal(calls.filter(n => n.name === 'retryPending')[0].args[0], false); assert.equal(calls.filter(n => n.name === 'retryPending')[1].args[0], true);});
  await checkAsync('runtime invalid consent values never invoke native mutations', async () => {const before = calls.length; await assert.rejects(api.setEnabled('true')); await assert.rejects(api.retryPending(undefined), e => e.code === 'UNKNOWN_OUTCOME_REQUIRES_CONFIRMATION'); await assert.rejects(api.connect('')); await assert.rejects(api.connect('a'.repeat(257))); assert.equal(calls.length, before);});
  await checkAsync('raw native rejection messages never become UI copy', async () => {const original = native.NativeModules.TelegramBackup.getStatus; native.NativeModules.TelegramBackup.getStatus = async () => {throw {code: 'new-private-code', message: 'synthetic-private-provider-body'};}; await assert.rejects(api.getStatus(), e => e.code === 'TELEGRAM_ACTION_FAILED' && !e.message.includes('synthetic-private')); native.NativeModules.TelegramBackup.getStatus = original;});

  for (const language of ['he', 'en']) {
    localization.activateLanguage(language);
    check(`${language} card has secure ephemeral input and exact BotFather link`, () => {const h = cardHarness(disconnected); let tree = h.render(); const input = nodesOf(tree, n => n.type === 'TextInput')[0]; assert.equal(input.props.secureTextEntry, true); assert.equal(input.props.autoComplete, 'off'); input.props.onChangeText('  synthetic-private-token  '); tree = h.render(); h.button(tree, 'connect').props.onPress(); assert.equal(nodesOf(h.render(), n => n.type === 'TextInput')[0].props.value, ''); assert.equal(h.actions[0].name, 'connect'); assert.equal(JSON.stringify(h.state).includes('synthetic-private-token'), false); h.button(tree, 'botFather').props.onPress(); assert.equal(h.links[0], 'https://t.me/BotFather');});
    check(`${language} token is cleared when Settings loses focus`, () => {const h = cardHarness(disconnected); nodesOf(h.render(), n => n.type === 'TextInput')[0].props.onChangeText('synthetic-private-token'); h.blur(); assert.equal(nodesOf(h.render(), n => n.type === 'TextInput')[0].props.value, '');});
    check(`${language} pairing link is not opened automatically`, () => {const h = cardHarness(pending); const tree = h.render(); assert.equal(h.links.length, 0); h.button(tree, 'start').props.onPress(); assert.equal(h.links[0], pending.startLink); h.button(tree, 'verify').props.onPress(); assert.equal(h.actions[0].name, 'verify');});
    check(`${language} enabling existing and future backup requires a confirmation`, () => {const h = cardHarness(linked); h.button(h.render(), 'enable').props.onPress(); assert.equal(h.actions.length, 0); assert.equal(h.alerts.length, 1); assert.ok(h.alerts[0][1].includes(resources.telegramText('enableBody'))); h.alerts[0][2][1].onPress(); assert.equal(h.actions[0].name, 'enable');});
    check(`${language} unknown retry is blocked until duplicate confirmation`, () => {const h = cardHarness({...ready, unknownOutcome: 1, statusCode: 'ACTION_REQUIRED'}); const tree = h.render(); assert.ok(textOf(tree).includes(resources.telegramText('unknownNote'))); h.button(tree, 'retry').props.onPress(); assert.equal(h.actions.length, 0); assert.ok(h.alerts[0][1].includes(resources.telegramText('unknownBody'))); h.alerts[0][2][1].onPress(); assert.equal(h.actions[0].name, 'retry');});
    await checkAsync(`${language} known and explicitly confirmed retries pass different native flags`, async () => {for (const unknownOutcome of [0, 1]) {const h = cardHarness({...ready, unknownOutcome}); h.button(h.render(), 'retry').props.onPress(); if (unknownOutcome) h.alerts[0][2][1].onPress(); await h.actions[0].operation(); assert.equal(calls.at(-1).name, 'retryPending'); assert.equal(calls.at(-1).args[0], unknownOutcome === 1);}});
    check(`${language} runtime unknown-outcome rejection also requires confirmation`, () => {const h = cardHarness(ready, {error: new Failure('UNKNOWN_OUTCOME_REQUIRES_CONFIRMATION')}); h.button(h.render(), 'retry').props.onPress(); assert.equal(h.actions.length, 0); assert.equal(h.alerts.length, 1);});
    check(`${language} persisted duplicate-confirmation error also keeps the warning`, () => {const h = cardHarness({...ready, lastErrorCode: 'UNKNOWN_OUTCOME_REQUIRES_CONFIRMATION'}); h.button(h.render(), 'retry').props.onPress(); assert.equal(h.actions.length, 0); assert.equal(h.alerts.length, 1);});
    check(`${language} connection mutation and enabling are disabled during recording`, () => {const h = cardHarness(linked); const tree = h.render({isRecording: true}); assert.equal(h.button(tree, 'enable').props.disabled, true); assert.equal(h.button(tree, 'disconnect').props.disabled, true); assert.equal(nodesOf(tree, n => n.type === 'Switch')[0].props.disabled, true);});
    check(`${language} enabled backup can be paused during recording`, () => {const h = cardHarness(ready); const control = nodesOf(h.render({isRecording: true}), n => n.type === 'Switch')[0]; assert.equal(control.props.disabled, false); control.props.onValueChange(false); assert.equal(h.actions[0].name, 'pause');});
    check(`${language} uploaded means receipts, and no unsupported percent is invented`, () => {const h = cardHarness({...ready, uploading: true, statusCode: 'UPLOADING'}); const content = textOf(h.render()); assert.ok(content.includes(resources.telegramText('uploading'))); assert.ok(content.includes(resources.telegramText('countersNote'))); assert.equal(content.includes('%'), false); assert.equal(h.button(h.render(), 'retry').props.disabled, true);});
    check(`${language} disconnect needs confirmation and preserves remote/local files`, () => {const h = cardHarness(ready); h.button(h.render(), 'disconnect').props.onPress(); assert.equal(h.actions.length, 0); assert.equal(h.alerts[0][1], resources.telegramText('disconnectBody')); h.alerts[0][2][1].onPress(); assert.equal(h.actions[0].name, 'disconnect');});
  }
  localization.activateLanguage('en');
  await checkAsync('hook initial polling never enables or uploads automatically', async () => {const before = calls.length; const h = hookHarness(); h.render(); await settle(); const state = h.render(); assert.equal(state.status.enabled, true); assert.equal(calls.length, before + 1); assert.equal(calls.at(-1).name, 'getStatus'); h.dispose(); assert.equal(h.timers.size, 0);});
  await checkAsync('hook ignores stale poll completion after an action', async () => {let resolvePoll; const original = native.NativeModules.TelegramBackup.getStatus; native.NativeModules.TelegramBackup.getStatus = () => new Promise(resolve => {resolvePoll = resolve;}); const h = hookHarness(); h.render(); await h.render().run('pause', async () => linked); resolvePoll(disconnected); await settle(); assert.equal(h.render().status.connected, true); assert.equal(h.render().status.enabled, false); native.NativeModules.TelegramBackup.getStatus = original; h.dispose();});
  await checkAsync('hook serializes mutations and retains actionable failure across polls', async () => {const h = hookHarness(); h.render(); await settle(); const state = h.render(); let finish; let operations = 0; const first = state.run('retry', () => {operations++; return new Promise(resolve => {finish = resolve;});}); await state.run('enable', async () => {operations++; return ready;}); assert.equal(operations, 1); finish(ready); await first; await h.render().run('retry', async () => {throw new Failure('UNKNOWN_OUTCOME_REQUIRES_CONFIRMATION');}); await h.render().refresh(); assert.equal(h.render().error.code, 'UNKNOWN_OUTCOME_REQUIRES_CONFIRMATION'); h.dispose();});
  await checkAsync('hook stops polling/actions in background and resumes status only', async () => {const h = hookHarness(); h.render(); await settle(); const before = calls.length; h.background(); assert.equal(h.timers.size, 0); await h.render().run('disconnect', async () => {throw new Error('Must not run');}); await h.render().refresh(); assert.equal(calls.length, before); h.foreground(); await settle(); assert.equal(calls.at(-1).name, 'getStatus'); h.dispose();});
  await checkAsync('unmounted hook ignores late status completion', async () => {let resolvePoll; const original = native.NativeModules.TelegramBackup.getStatus; native.NativeModules.TelegramBackup.getStatus = () => new Promise(resolve => {resolvePoll = resolve;}); const h = hookHarness(); h.render(); h.dispose(); resolvePoll(ready); await settle(); assert.equal(h.render().status, null); native.NativeModules.TelegramBackup.getStatus = original;});
  console.log(`Telegram UI: ${passed} host checks passed (synthetic only; no Telegram/phone actions).`);
}
main().catch(error => {console.error(error); process.exitCode = 1;});
