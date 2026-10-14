'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { core, catalog } = require('./load-core.cjs')();
let passed = 0;
const check = (name, fn) => { fn(); passed += 1; };
const checkAsync = async (name, fn) => { await fn(); passed += 1; };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const memoryStorage = (saved = null) => ({ saved, writes: [], async getItem(key) { assert.equal(key, 'waRecoLanguage'); return this.saved; }, async setItem(key, value) { assert.equal(key, 'waRecoLanguage'); this.writes.push(value); this.saved = value; } });
const makeController = (storage, locale, calls = []) => core.createLanguageController(storage, locale, async language => { calls.push(language); });

async function main() {
  check('complete resource keys and interpolation tokens match', () => {
    assert.deepEqual(Object.keys(catalog.he).sort(), Object.keys(catalog.en).sort());
    for (const key of Object.keys(catalog.he)) {
      assert.equal(typeof catalog.en[key], 'string'); assert.ok(catalog.en[key].trim());
      const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
      assert.deepEqual(placeholders(catalog.he[key]), placeholders(catalog.en[key]), key);
      if (key !== 'languageHebrew') assert.equal(/[\u0590-\u05ff]/.test(catalog.en[key]), false, key);
    }
  });
  check('all current JS Hebrew copy lives in the catalog', () => {
    const root = path.resolve(__dirname, '../..');
    function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!['i18n', '__tests__'].includes(entry.name)) walk(file); continue; }
      if (!/\.tsx?$/.test(file) || entry.name.startsWith('Telegram')) continue;
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      function inspect(node) { if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) assert.equal(/[\u0590-\u05ff]/.test(node.text), false, file); ts.forEachChild(node, inspect); }
      inspect(source);
    } } walk(root);
  });
  check('Hebrew locale aliases and other device defaults are deliberate', () => {
    for (const locale of ['he', 'he-IL', 'he_IL', 'iw', 'iw_IL', 'HE-il']) assert.equal(core.languageFromLocale(locale), 'he');
    for (const locale of ['en', 'en-US', 'fr-FR', 'ar-SA', '', null, 4, '__proto__']) assert.equal(core.languageFromLocale(locale), 'en');
  });
  check('translations interpolate without evaluating values', () => {
    core.activateLanguage('en'); assert.equal(core.t('copy352', { p0: 2 }), 'Step 2 of 5');
    assert.equal(core.t('copy287', { p0: '{p1}<script>synthetic</script>' }), 'Delete “{p1}<script>synthetic</script>” and its audio file from this device?');
  });
  check('cached known errors change language without exposing unknown messages', () => {
    core.activateLanguage('he'); const prior = core.t('copy205'); core.activateLanguage('en');
    assert.equal(core.localizedError(prior), catalog.en.copy205);
    assert.equal(core.localizedError({ message: 'synthetic private provider body' }).includes('synthetic private'), false);
  });
  check('date and duration display respect effective locale', () => {
    const date = '2026-10-07T12:34:00Z';
    assert.equal(core.formatDate(date, 'en'), new Date(date).toLocaleString('en-US'));
    assert.equal(core.formatDate(date, 'he'), new Date(date).toLocaleString('he-IL'));
    assert.equal(core.formatDate('invalid', 'en'), catalog.en.unknownDate);
    assert.equal(core.formatDuration(3602000, 'en'), '01:00:02'); assert.equal(core.formatDuration(NaN, 'he'), '00:00:00');
  });
  check('direction changes mirror only semantic layout and preserve LTR data', () => {
    const original = { row: { flexDirection: 'row-reverse' }, label: { writingDirection: 'rtl', textAlign: 'right' }, trailing: { writingDirection: 'rtl', textAlign: 'left' }, input: { writingDirection: 'ltr', textAlign: 'right' }, time: { writingDirection: 'ltr' } };
    const next = core.directionalStyles(original, 'en');
    assert.equal(next.row.flexDirection, 'row'); assert.equal(next.label.textAlign, 'left'); assert.equal(next.label.writingDirection, 'ltr'); assert.equal(next.trailing.textAlign, 'right'); assert.equal(next.input.writingDirection, 'ltr'); assert.equal(next.input.textAlign, 'right'); assert.equal(next.time.writingDirection, 'ltr'); assert.equal(original.row.flexDirection, 'row-reverse'); assert.equal(core.directionalStyles(original, 'he'), original);
  });
  check('default recording titles change only for recognized generated names', () => {
    core.activateLanguage('en'); assert.equal(core.displayRecordingTitle(catalog.he.nativeCallTitle), catalog.en.nativeCallTitle);
    for (const title of ['פגישה עם Dave', 'Settings', 'הגדרות', 'Customer recording']) assert.equal(core.displayRecordingTitle(title), title);
  });
  check('named recordings translate the title without altering Hebrew or emoji labels', () => {
    core.activateLanguage('he'); assert.equal(core.displayRecordingTitle('stored title', 'דוד 👨‍💻'), 'שיחה עם דוד 👨‍💻');
    core.activateLanguage('en'); assert.equal(core.displayRecordingTitle('stored title', 'דוד 👨‍💻'), 'Call with דוד 👨‍💻');
    assert.equal(core.displayRecordingTitle('stored title', '+972501234567'), 'Call with +972501234567');
  });
  check('missing or invalid participant metadata keeps legacy generated titles', () => {
    core.activateLanguage('en');
    for (const label of [undefined, null, '', '  ', 'A\u202eB', 'A\nB', 'X'.repeat(81)])
      assert.equal(core.displayRecordingTitle(catalog.he.nativeCallTitle, label), catalog.en.nativeCallTitle);
  });
  await checkAsync('first-run device locale is used without writing a choice', async () => {
    const store = memoryStorage(); const calls = []; const controller = makeController(store, 'iw_IL', calls);
    await controller.initialize(); assert.equal(controller.getSnapshot().language, 'he'); assert.equal(controller.getSnapshot().ready, true); assert.deepEqual(store.writes, []); assert.deepEqual(calls, ['he']);
  });
  await checkAsync('valid persisted choice overrides device locale on relaunch', async () => {
    const store = memoryStorage('en'); const controller = makeController(store, 'he-IL'); await controller.initialize(); assert.equal(controller.getSnapshot().language, 'en');
    await controller.select('he'); assert.equal(store.saved, 'he'); const next = makeController(store, 'en-US'); await next.initialize(); assert.equal(next.getSnapshot().language, 'he');
  });
  await checkAsync('malformed preferences fall back to device locale', async () => {
    for (const saved of ['__proto__', 'he\n', '{}', 'fr', '']) { const controller = makeController(memoryStorage(saved), 'he_IL'); await controller.initialize(); assert.equal(controller.getSnapshot().language, 'he'); }
  });
  await checkAsync('read failure remains usable with truthful local error', async () => {
    const controller = makeController({ async getItem() { throw Error('synthetic'); }, async setItem() {} }, 'en'); await controller.initialize(); assert.equal(controller.getSnapshot().ready, true); assert.equal(controller.getSnapshot().language, 'en'); assert.equal(controller.getSnapshot().error, 'languageSaveFailed');
  });
  await checkAsync('failed persistence keeps the current language', async () => {
    const controller = makeController({ async getItem() { return 'he'; }, async setItem() { throw Error('synthetic'); } }, 'en'); await controller.initialize(); await controller.select('en'); assert.equal(controller.getSnapshot().language, 'he'); assert.equal(controller.getSnapshot().error, 'languageSaveFailed');
  });
  await checkAsync('native sync failure preserves JS choice and shows its limit', async () => {
    const store = memoryStorage('he'); const controller = core.createLanguageController(store, 'he', async language => { if (language === 'en') throw Error('synthetic'); }); await controller.initialize(); await controller.select('en'); assert.equal(store.saved, 'en'); assert.equal(controller.getSnapshot().language, 'en'); assert.equal(controller.getSnapshot().ready, true); assert.equal(controller.getSnapshot().error, 'languageSyncFailed');
  });
  await checkAsync('late hydration cannot overwrite a new language selection', async () => {
    const read = deferred(); const store = memoryStorage(); store.getItem = () => read.promise; const calls = []; const controller = makeController(store, 'he', calls);
    const initialized = controller.initialize(); await controller.select('en'); read.resolve('he'); await initialized; assert.equal(controller.getSnapshot().language, 'en'); assert.deepEqual(calls, ['en']);
  });
  await checkAsync('overlapping writes persist the latest selection in order', async () => {
    const first = deferred(); const store = memoryStorage('he'); const order = []; store.setItem = async (_key, value) => { order.push(value); if (order.length === 1) await first.promise; store.saved = value; };
    const calls = []; const controller = makeController(store, 'he', calls); await controller.initialize(); const en = controller.select('en'); const he = controller.select('he'); await Promise.resolve(); first.resolve(); await Promise.all([en, he]); assert.deepEqual(order, ['en', 'he']); assert.equal(store.saved, 'he'); assert.equal(controller.getSnapshot().language, 'he'); assert.deepEqual(calls, ['he', 'he']);
  });
  await checkAsync('unmount cancellation prevents late hydration and native mutation', async () => {
    const read = deferred(); const calls = []; const controller = makeController({ getItem: () => read.promise, async setItem() {} }, 'he', calls); let events = 0; const unsubscribe = controller.subscribe(() => events++);
    const initialized = controller.initialize(); unsubscribe(); controller.cancelPending(); read.resolve('en'); await initialized; assert.equal(events, 0); assert.deepEqual(calls, []); assert.equal(controller.getSnapshot().ready, false);
    await controller.initialize(); assert.equal(controller.getSnapshot().language, 'en'); assert.equal(controller.getSnapshot().ready, true);
  });
  await checkAsync('language updates remain ready and notify only current subscribers', async () => {
    const controller = makeController(memoryStorage('he'), 'he'); const observed = []; const unsubscribe = controller.subscribe(value => observed.push(value)); await controller.initialize(); await controller.select('en'); unsubscribe(); await controller.select('he'); assert.equal(observed.length, 2); assert.ok(observed.every(value => value.ready)); assert.equal(controller.getSnapshot().ready, true);
  });
  check('app does not key recording/setup providers or force an RTL restart', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '../../../App.tsx'), 'utf8');
    assert.match(app, /<RecordingProvider><SetupProvider>/); assert.equal(/<RecordingProvider[^>]*key=|<SetupProvider[^>]*key=|forceRTL\(|allowRTL\(/.test(app), false);
    assert.equal(/forceRTL\(|allowRTL\(/.test(fs.readFileSync(path.resolve(__dirname, '../LocalizationContext.tsx'), 'utf8')), false);
  });
  const ui = require('./render-ui.cjs')(core);
  const recordingState = { recordings: [{ id: 'synthetic', title: catalog.he.nativeCallTitle, date: '2026-10-07T12:00:00Z', durationMs: 10000, duration: '00:00:10', captureSource: 'usb', source: 'native', status: 'captured', outputSoundMs: 1000, microphoneSoundMs: 1000 }], isRecording: false, isBusy: false, recordingTime: '00:00:10', error: null, status: { source: 'usb', usbConnected: true, isSilenced: false, silentForMs: 0, audioMode: 0, level: 0.1, outputLevel: 0.5, microphoneLevel: 0.2 }, systemAccessStatus: { available: true, connecting: false, paired: true, helperConnected: true, wirelessDebuggingEnabled: true }, autoRecordingStatus: { enabled: false }, deviceInfo: { sdk: 36 } };
  const setupState = { loading: false, completed: true, readiness: { microphone: true, notifications: true, callAccess: true, helper: true, automatic: true, allReady: true }, systemAccessStatus: recordingState.systemAccessStatus, setupError: null, supported: true };
  check('real manual STOP and idle button labels switch languages', () => {
    core.activateLanguage('en'); assert.match(ui.recordButton(true), /Stop and save/); assert.match(ui.recordButton(false), /Start recording/);
    core.activateLanguage('he'); assert.match(ui.recordButton(true), /עצירה ושמירה/);
  });
  check('real English screens and setup states render translated current copy', () => {
    core.activateLanguage('en');
    for (const screen of ['HomeScreen', 'RecordingsScreen', 'PlaybackScreen', 'SettingsScreen', 'SetupScreen']) {
      const rendered = ui.render(screen, recordingState, setupState).replaceAll('עברית', '');
      assert.equal(/[\u0590-\u05ff]/.test(rendered), false, screen); assert.ok(rendered.trim());
    }
    const active = ui.render('HomeScreen', { ...recordingState, isRecording: true }, setupState); assert.match(active, /Recording now/); assert.match(active, /Stop and save/); assert.match(active, /Call audio/);
    const microphoneSetup = { ...setupState, loading: false, completed: false, readiness: { ...setupState.readiness, microphone: false, allReady: false } };
    assert.match(ui.render('SetupScreen', recordingState, microphoneSetup), /Allow microphone/);
    const autoSetup = { ...setupState, completed: false, readiness: { ...setupState.readiness, automatic: false, allReady: false } };
    assert.match(ui.render('SetupScreen', recordingState, autoSetup), /participants informed/);
    core.activateLanguage('he'); assert.match(ui.render('SettingsScreen', recordingState, setupState), /שפת האפליקציה/);
  });
  const nativeModules = { CallRecorder: { getStatus: async () => ({ isRecording: true, source: 'usb', elapsedMs: 1234, level: 0.5, usbConnected: true, error: 'synthetic private error', errorCode: 'MIC_PERMISSION' }), startRecording: async () => { throw { code: 'FOREGROUND_REQUIRED', message: 'synthetic private error' }; }, getSystemAccessStatus: async () => ({ available: true, helperConnected: true, paired: true, error: null, pairingSetup: { active: true, error: 'synthetic private error', errorCode: 'PAIRING_BUSY' } }) } };
  check('legacy experimental onboarding offers only explicit paired restoration', () => {
    for (const language of ['he', 'en']) {
      core.activateLanguage(language);
      const experiment = { ...recordingState, deviceInfo: { sdk: 29 },
        autoRecordingStatus: { mode: 'accessibilityMic', enabled: false, armed: false },
        accessibilityMicStatus: { supported: true, selected: true, enabled: false, connected: false, automaticSupported: true },
        systemAccessStatus: { available: false, helperConnected: false, paired: false, wirelessDebuggingEnabled: false, connecting: false } };
      const setup = { ...setupState, supported: false, readiness: { ...setupState.readiness, mode: 'accessibilityMic',
        captureReady: false, helper: false, automatic: false, allReady: false } };
      const rendered = ui.render('SetupScreen', experiment, setup);
      assert.ok(rendered.includes(core.t('pairedSetupRestoreHelp')));
      assert.ok(rendered.includes(core.t('pairedSetupRestoreAction')));
      assert.ok(!rendered.includes(core.t('cleanSettingsServiceApprovalHelp')));
      assert.ok(!rendered.includes(core.t('cleanSetupChooseAction')));
      assert.ok(!rendered.includes(core.t('copy372')));
      assert.ok(!rendered.includes(core.t('copy112'))); assert.ok(!rendered.includes(core.t('copy116')));
      const live = { ...experiment, isRecording: true, status: { ...recordingState.status, source: 'accessibilityMic', usbConnected: false } };
      assert.ok(ui.render('HomeScreen', live, setup).includes(core.t('accessibilityMicLimits')));
    }
  });
  check('experimental saved files are labeled and never imply verified remote speech', () => {
    for (const language of ['he', 'en']) {
      core.activateLanguage(language);
      const recording = { ...recordingState, recordings: [{ ...recordingState.recordings[0], captureSource: 'accessibilityMic',
        remoteAudioVerified: false, experimental: true, silencingKnown: false }] };
      for (const screen of ['RecordingsScreen', 'PlaybackScreen']) {
        const rendered = ui.render(screen, recording, setupState);
        assert.ok(rendered.includes(core.t('accessibilityMicLabel')));
        assert.ok(rendered.includes(core.t('accessibilityMicRecordingNote')));
      }
    }
  });
  const recorder = {};
  const compiled = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../../services/NativeRecorder.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(compiled, { exports: recorder, module: { exports: recorder }, Error, require: name => {
    if (name === '../i18n/core') return core; if (name === 'react-native') return { NativeModules: nativeModules, Platform: { OS: 'android' } }; throw Error(name);
  } });
  await checkAsync('name preference reads are authoritative and strip unrelated bridge fields', async () => {
    nativeModules.CallRecorder.getCallNameStatus = async () => ({ enabled: false, privateField: 'not returned' });
    const value = await recorder.NativeRecorder.getCallNameStatus(); assert.equal(value.enabled, false); assert.equal(Object.keys(value).join(','), 'enabled');
    nativeModules.CallRecorder.getCallNameStatus = async () => ({ enabled: true }); assert.equal((await recorder.NativeRecorder.getCallNameStatus()).enabled, true);
  });
  await checkAsync('malformed preference response cannot silently enable name saving', async () => {
    for (const value of [null, {}, { enabled: 'true' }, { enabled: 1 }]) {
      nativeModules.CallRecorder.getCallNameStatus = async () => value;
      await assert.rejects(recorder.NativeRecorder.getCallNameStatus(), error => error.message === core.t('callNameReadFailed'));
    }
  });
  await checkAsync('name preference writes verify the native committed value', async () => {
    nativeModules.CallRecorder.setCallNameEnabled = async enabled => ({ enabled });
    assert.equal((await recorder.NativeRecorder.setCallNameEnabled(true)).enabled, true);
    assert.equal((await recorder.NativeRecorder.setCallNameEnabled(false)).enabled, false);
    nativeModules.CallRecorder.setCallNameEnabled = async () => ({ enabled: true });
    await assert.rejects(recorder.NativeRecorder.setCallNameEnabled(false), error => error.message === core.t('callNameSaveFailed'));
  });
  await checkAsync('busy setting rejection is localized without exposing native private details', async () => {
    nativeModules.CallRecorder.setCallNameEnabled = async () => { throw { code: 'RECORDING_BUSY', message: 'private device data' }; };
    for (const language of ['he', 'en']) {
      core.activateLanguage(language);
      await assert.rejects(recorder.NativeRecorder.setCallNameEnabled(true), error => error.code === 'RECORDING_BUSY' && error.message === core.t('callNameRecordingBusy'));
    }
  });
  await checkAsync('native status localization preserves all recording facts', async () => {
    for (const language of ['he', 'en']) { core.activateLanguage(language); const status = await recorder.NativeRecorder.getStatus(); assert.equal(status.isRecording, true); assert.equal(status.elapsedMs, 1234); assert.equal(status.source, 'usb'); assert.equal(status.level, 0.5); assert.equal(status.usbConnected, true); assert.equal(status.error, core.t('copy211')); }
  });
  await checkAsync('native rejection codes map to safe copy in both languages', async () => {
    for (const language of ['he', 'en']) { core.activateLanguage(language); await assert.rejects(recorder.NativeRecorder.startRecording('usb'), error => error.code === 'FOREGROUND_REQUIRED' && error.message === core.t('copy196')); }
    assert.equal(recorder.recorderErrorMessage('toString', 'synthetic private').includes('synthetic private'), false);
  });
  await checkAsync('nested pairing status retains pairing facts with localized errors', async () => {
    core.activateLanguage('en'); const status = await recorder.NativeRecorder.getSystemAccessStatus(); assert.equal(status.helperConnected, true); assert.equal(status.pairingSetup.active, true); assert.equal(status.pairingSetup.error, core.t('pairingBusy'));
  });
  const activationFailures = [
    ['DISCOVERY', 'חיבור ההפעלה לא נמצא. ודאו שניפוי באגים אלחוטי פעיל. אפשר להזין ידנית את יציאת החיבור שמוצגת בהגדרות.', 'The activation connection was not found. Enable Wireless debugging. You can enter the connection port shown in Android Settings manually.'],
    ['ADB_CONNECTION', 'לא ניתן להתחבר להפעלה. ודאו שניפוי באגים אלחוטי פעיל ושהצימוד הושלם; אם האישור הוסר, בצעו צימוד מחדש.', 'The activation connection failed. Check Wireless debugging and pairing. Pair again if authorization was removed.'],
    ['BOOTSTRAP', 'רכיב ההקלטה לא התחיל. חזרו למסך האפליקציה ונסו להפעיל אותו שוב. אם זה חוזר, אפשר להשתמש בהקלטת מיקרופון.', 'The recording component did not start. Return to the app and activate it again. If this persists, microphone recording is available.'],
    ['AUTHENTICATION', 'רכיב ההקלטה לא אישר שהוא מוכן בטלפון הזה. נסו הפעלה מחדש מתוך האפליקציה. אם זה חוזר, אפשר להשתמש בהקלטת מיקרופון.', 'The recording component did not confirm readiness on this phone. Activate it again from the app. If this persists, microphone recording is available.'],
    ['HANDOFF', 'העברת השליטה לרכיב ההקלטה לא הושלמה. חזרו לאפליקציה ונסו להפעיל שוב.', 'Ownership transfer to the recording component did not finish. Return to the app and activate it again.'],
    ['DETACH', 'סגירת חיבור ההפעלה לא הושלמה. חזרו לאפליקציה ונסו להפעיל שוב.', 'Closing the activation connection did not finish. Return to the app and activate it again.'],
    ['LIVENESS', 'רכיב ההקלטה נעצר אחרי ההפעלה. הפעילו אותו שוב כשהאפליקציה פתוחה. אם זה חוזר, בדקו מגבלות סוללה ורקע של המכשיר.', "The recording component stopped after activation. Activate it again while the app is open. If this persists, check this phone's battery and background restrictions."],
    ['READINESS_OWNER', 'לא ניתן להשאיר את רכיב ההקלטה פעיל ברקע. חזרו לאפליקציה, ודאו שההתראות מותרות ונסו שוב.', 'The recording component could not stay active in the background. Return to the app, check notification access and try again.'],
  ];
  await checkAsync('activation stages preserve legacy rejection families with safe actionable detail', async () => {
    for (const language of ['he', 'en']) {
      core.activateLanguage(language);
      for (const [stage, hebrew, english] of activationFailures) {
        const errorCode = `ACTIVATION_${stage}_FAILED`;
        const family = stage === 'READINESS_OWNER' ? 'READINESS_OWNER_FAILED' : 'ACTIVATION_FAILED';
        nativeModules.CallRecorder.connectSystemRecorder = async () => { throw { code: family, userInfo: { errorCode }, message: 'private token port and provider text' }; };
        await assert.rejects(recorder.NativeRecorder.connectSystemRecorder(), error =>
          error.code === family && error.errorCode === errorCode && error.message === (language === 'he' ? hebrew : english));
      }
    }
  });
  await checkAsync('unknown or misplaced activation details cannot expose native text or change legacy behavior', async () => {
    core.activateLanguage('en');
    for (const userInfo of [null, [], 'ACTIVATION_DISCOVERY_FAILED', {}, { errorCode: 'toString' }, { errorCode: '__proto__' }, { errorCode: 'raw private token' }, { errorCode: 3 }, Object.create({ errorCode: 'ACTIVATION_DISCOVERY_FAILED' })]) {
      nativeModules.CallRecorder.connectSystemRecorder = async () => { throw { code: 'ACTIVATION_FAILED', userInfo, message: 'private token' }; };
      await assert.rejects(recorder.NativeRecorder.connectSystemRecorder(), error => error.code === 'ACTIVATION_FAILED' && !error.errorCode && error.message === core.t('copy206'));
    }
    nativeModules.CallRecorder.connectSystemRecorder = async () => { throw { code: 'PAIRING_FAILED', userInfo: { errorCode: 'ACTIVATION_DISCOVERY_FAILED' }, message: 'private token' }; };
    await assert.rejects(recorder.NativeRecorder.connectSystemRecorder(), error => error.code === 'PAIRING_FAILED' && !error.errorCode && error.message === core.t('copy148'));
    for (const [code, detail] of [['ACTIVATION_FAILED', 'ACTIVATION_READINESS_OWNER_FAILED'], ['READINESS_OWNER_FAILED', 'ACTIVATION_DISCOVERY_FAILED']]) {
      nativeModules.CallRecorder.connectSystemRecorder = async () => { throw { code, userInfo: { errorCode: detail }, message: 'private token' }; };
      await assert.rejects(recorder.NativeRecorder.connectSystemRecorder(), error => error.code === code && !error.errorCode && error.message === core.t('copy206'));
    }
  });
  await checkAsync('activation status retains facts and distinct safe stage copy across languages', async () => {
    for (const language of ['he', 'en']) {
      core.activateLanguage(language);
      for (const [stage, hebrew, english] of activationFailures) {
        const errorCode = `ACTIVATION_${stage}_FAILED`;
        nativeModules.CallRecorder.getSystemAccessStatus = async () => ({ available: true, helperConnected: false, paired: true, connecting: false, wirelessDebuggingEnabled: true, error: 'private native text', errorCode });
        const status = await recorder.NativeRecorder.getSystemAccessStatus();
        assert.equal(status.error, language === 'he' ? hebrew : english); assert.equal(status.errorCode, errorCode);
        assert.equal(status.available, true); assert.equal(status.helperConnected, false); assert.equal(status.paired, true); assert.equal(status.connecting, false); assert.equal(status.wirelessDebuggingEnabled, true);
      }
    }
  });
  check('focused setup preserves every approved stage message instead of generic Wi-Fi advice', () => {
    for (const language of ['he', 'en']) {
      core.activateLanguage(language);
      for (const [stage, hebrew, english] of activationFailures) {
        const message = language === 'he' ? hebrew : english;
        const access = { available: true, helperConnected: false, developerOptionsEnabled: true, wirelessDebuggingEnabled: true, paired: true, error: message, errorCode: `ACTIVATION_${stage}_FAILED` };
        const rendered = ui.render('SetupScreen', { ...recordingState, systemAccessStatus: access }, { ...setupState, readiness: { ...setupState.readiness, helper: false, allReady: false }, systemAccessStatus: access });
        assert.ok(rendered.includes(message), stage); assert.equal(rendered.includes(core.t('copy148')), false, stage);
      }
      const access = { available: true, helperConnected: false, developerOptionsEnabled: true, wirelessDebuggingEnabled: true, paired: true, error: 'private token port and native text' };
      const rendered = ui.render('SetupScreen', { ...recordingState, systemAccessStatus: access }, { ...setupState, readiness: { ...setupState.readiness, helper: false, allReady: false }, systemAccessStatus: access });
      assert.ok(rendered.includes(core.t('copy009'))); assert.equal(rendered.includes('private token'), false);
    }
  });
  process.stdout.write(`Localization checks: ${passed} passed (${Object.keys(catalog.he).length} paired resources)\n`);
}
main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
