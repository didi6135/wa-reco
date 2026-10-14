import { localizedError, t, useLocalizedStyles } from '../i18n';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, AppState, TouchableOpacity, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useRecording } from '../context/RecordingContext';
import RecordButton from '../components/RecordButton';
import AutoRecordingCard from '../components/AutoRecordingCard';
import OfflineRecoveryCard from '../components/OfflineRecoveryCard';
import { BottomNav, WaveMark } from '../components/Visuals';
import { colors, ui } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const messageOf = (error: unknown) => localizedError(error);
const normalized = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

function LevelMeter({ label, level, active }: { label: string; level: number; active: boolean }) {
  const styles = useLocalizedStyles(baseStyles);
  const percent = active ? Math.round(normalized(level) * 100) : 0;
  return (
    <View style={styles.meter}>
      <Text style={styles.meterLabel}>{label}: {percent}%</Text>
      <View style={styles.meterTrack} accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: percent }}>
        <View style={[styles.meterFill, { width: `${percent}%` }]} />
      </View>
    </View>
  );
}

export default function HomeScreen() {
  const styles = useLocalizedStyles(baseStyles);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList, 'Home'>>();
  const { isRecording, recordingTime, startRecording, stopRecording, requestPermissions, status, isBusy, error,
    systemAccessStatus, autoRecordingStatus } = useRecording();
  const [captureChoice, setCaptureChoice] = useState<'microphone' | 'call'>('microphone');
  const restoreSystem = autoRecordingStatus.mode === 'accessibilityMic';
  const captureSource = captureChoice === 'microphone' ? 'microphone' : 'usb';
  const source = isRecording ? status.source : captureSource;
  const recoveryRunning = systemAccessStatus.offlineRecovery?.running === true;
  const helperReady = !systemAccessStatus.connecting && !recoveryRunning && (systemAccessStatus.helperConnected || status.usbConnected);
  const offline = systemAccessStatus.offlineRecovery;
  const offlinePrepared = offline?.supported && offline.enabled && offline.secureSettingsGranted && offline.nearbyWifiGranted;
  const systemReady = !restoreSystem && systemAccessStatus.available &&
    (helperReady || (systemAccessStatus.paired && (systemAccessStatus.wirelessDebuggingEnabled || offlinePrepared)));
  const startUnavailable = !isRecording && source === 'usb' && !systemReady;
  const mounted = useRef(true), focused = useRef(true), generation = useRef(0), starting = useRef(false);
  const current = useRef({ isBusy, isRecording, recoveryRunning, captureChoice, restoreSystem });
  current.current = { isBusy, isRecording, recoveryRunning, captureChoice, restoreSystem };
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') generation.current++; });
    return () => { mounted.current = false; focused.current = false; generation.current++; subscription.remove(); };
  }, []);
  useFocusEffect(useCallback(() => { focused.current = true; return () => { focused.current = false; generation.current++; }; }, []));
  const alive = (expected = generation.current) => mounted.current && focused.current &&
    AppState.currentState === 'active' && generation.current === expected;
  const canStart = (expected: number, choice: 'microphone' | 'call') => alive(expected) && !current.current.isBusy &&
    !current.current.isRecording && !current.current.recoveryRunning && current.current.captureChoice === choice;
  const setup = () => { if (alive() && !current.current.isBusy && !current.current.isRecording && !current.current.recoveryRunning) navigation.navigate('Setup'); };

  const chooseSource = (next: 'microphone' | 'call') => {
    if (isRecording || isBusy || recoveryRunning) return;
    setCaptureChoice(next);
    if (next === 'call' && restoreSystem) setup();
  };

  const begin = async (expected: number, choice: 'microphone' | 'call') => {
    if (starting.current || !canStart(expected, choice)) return;
    if (choice === 'call' && current.current.restoreSystem) { setup(); return; }
    starting.current = true;
    try {
      if (!(await requestPermissions())) {
        if (alive(expected)) Alert.alert(t('copy220'), t('copy221'));
        return;
      }
      if (!canStart(expected, choice)) return;
      if (choice === 'call' && current.current.restoreSystem) { setup(); return; }
      await startRecording(choice === 'microphone' ? 'microphone' : 'usb');
    } catch (failure) {
      if (alive(expected)) {
        if (choice === 'call' && (current.current.restoreSystem || messageOf(failure) === t('pairedSetupRestoreHelp'))) setup();
        else Alert.alert(t('copy222'), messageOf(failure));
      }
    } finally { starting.current = false; }
  };

  const handleRecordPress = async () => {
    if (isBusy || (!isRecording && recoveryRunning)) return;
    if (isRecording) {
      try {
        const saved = await stopRecording();
        if (!saved) {
          Alert.alert(t('copy223'), t('copy224'));
        } else if (saved.status === 'interrupted' || saved.status === 'recovered') {
          Alert.alert(t('copy225'), t('copy226'));
        } else if (saved.captureSource === 'usb') {
          const outputMissing = (saved.outputSoundMs ?? 0) < 200;
          const micMissing = (saved.microphoneSoundMs ?? 0) < 200;
          Alert.alert(outputMissing || micMissing ? t('copy225') : t('copy227'), outputMissing || micMissing
            ? t('copy230', { p0: outputMissing ? t('copy228') : '', p1: micMissing ? t('copy229') : '' })
            : t('copy231'));
        } else if (saved.captureSource === 'accessibilityMic') {
          Alert.alert(t(saved.status === 'captured' ? 'copy227' : 'copy225'),
            saved.status === 'captured' ? t('accessibilityMicSaved') : `${t('copy233')}\n\n${t('accessibilityMicSaved')}`);
        } else if (saved.status === 'captured') {
          Alert.alert(t('copy227'), t('copy232'));
        } else {
          Alert.alert(t('copy225'), t('copy233'));
        }
      } catch (failure) {
        Alert.alert(t('copy234'), messageOf(failure));
      }
      return;
    }
    if (captureChoice === 'call' && restoreSystem) { setup(); return; }
    if (startUnavailable || !alive()) return;
    const expected = generation.current, choice = captureChoice;
    Alert.alert(source === 'usb' ? t('copy235') : t('copy236'), t('copy237'), [
      { text: t('copy012'), style: 'cancel' },
      { text: t('copy238'), onPress: () => { void begin(expected, choice); } },
    ]);
  };

  const warning = status.isSilenced
    ? t('copy239')
    : status.silentForMs >= 5000
      ? t('copy240')
      : null;
  const accessLabel = restoreSystem ? t('pairedSetupRestoreTitle') : helperReady ? t('copy241')
    : systemAccessStatus.connecting ? t('copy097')
      : systemReady ? t('copy242')
        : t('copy243');

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: Math.max(18, insets.top + 10) }]}>
        <View style={styles.header}>
          <WaveMark size={38} />
          <Text style={styles.title}>{t('copy217')}</Text>
        </View>
        <Text style={styles.sourceLabel}>{t('copy244')}</Text>
        <View style={styles.modeRow}>
          <TouchableOpacity style={[styles.mode, source === 'microphone' && styles.modeSelected]} onPress={() => chooseSource('microphone')} disabled={isRecording || isBusy} accessibilityRole="radio" accessibilityState={{ selected: source === 'microphone', disabled: isRecording || isBusy }}><Text style={[styles.modeText, source === 'microphone' && styles.modeTextSelected]}>{t('copy245')}</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.mode, source !== 'microphone' && styles.modeSelected]} onPress={() => chooseSource('call')} disabled={isRecording || isBusy} accessibilityRole="radio" accessibilityState={{ selected: source !== 'microphone', disabled: isRecording || isBusy }}><Text style={[styles.modeText, source !== 'microphone' && styles.modeTextSelected]}>{t('copy246')}</Text></TouchableOpacity>
        </View>
        {source !== 'microphone' && !isRecording && <TouchableOpacity style={styles.accessLink} onPress={() => { if (restoreSystem) setup(); else navigation.navigate('Settings'); }} accessibilityRole="button" accessibilityLabel={t('copy247', { p0: accessLabel })}>
          <Text style={[styles.accessText, !restoreSystem && helperReady && styles.accessConnected]}>{accessLabel}</Text>
          <Text style={styles.linkText}>{t(restoreSystem ? 'pairedSetupRestoreAction' : 'copy195')}</Text>
        </TouchableOpacity>}
        <View style={[styles.card, isRecording && styles.cardActive]}>
          <Text style={[styles.state, isRecording && styles.recording]}>{isRecording ? t('copy248') : t('copy249')}</Text>
          {isRecording ? <Text style={styles.timer} accessibilityLabel={t('copy250', { p0: recordingTime })} accessibilityLiveRegion="none">{recordingTime}</Text> : <Text style={styles.caption}>{t(source === 'usb' && restoreSystem ? 'pairedSetupRestoreHelp' : source === 'usb' ? 'copy251' : 'copy252')}</Text>}
          {!isRecording && source === 'microphone' && <Text style={styles.small}>{t('ordinaryMicCallHint')}</Text>}
          {isRecording && <View style={styles.meters}>{source === 'usb' && <LevelMeter label={t('copy253')} level={status.outputLevel} active />}<LevelMeter label={t('copy245')} level={source === 'usb' ? status.microphoneLevel : status.level} active /></View>}
          <View style={styles.recordButton}><RecordButton isRecording={isRecording} onPress={() => { void handleRecordPress(); }} disabled={isBusy || startUnavailable || (!isRecording && (recoveryRunning || (source === 'usb' && systemAccessStatus.connecting)))} /></View>
          <Text style={styles.small}>{isBusy ? t('copy254') : startUnavailable ? t(restoreSystem ? 'pairedSetupRestoreAction' : 'copy255') : isRecording ? t('copy256') : t('copy257')}</Text>
          {isRecording && source === 'accessibilityMic' && <Text style={styles.warning}>{t('accessibilityMicLimits')}</Text>}
          {isRecording && warning && <Text style={styles.warning}>{warning}</Text>}
          {isRecording && source === 'microphone' && status.audioMode !== 0 && <Text style={styles.warning}>{t('copy258')}</Text>}
          {error && <Text style={styles.warning} accessibilityLiveRegion="polite">{localizedError(error)}</Text>}
          {systemAccessStatus.error && systemAccessStatus.error !== error && source === 'usb' && <Text style={styles.warning}>{localizedError(systemAccessStatus.error)}</Text>}
        </View>
        {recoveryRunning && <OfflineRecoveryCard compact onOpenSetup={setup} />}
        <AutoRecordingCard compact onShowDetails={setup} />
      </ScrollView>
      <BottomNav current="Home" />
    </View>
  );
}

const baseStyles = StyleSheet.create({
  container: ui.screen,
  content: { ...ui.content, flexGrow: 1 },
  header: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, marginBottom: 28 },
  title: { ...ui.title, flex: 1, fontSize: 26, lineHeight: 36 },
  sourceLabel: { ...ui.label, marginBottom: 10 },
  modeRow: { flexDirection: 'row-reverse', gap: 8, padding: 4, borderRadius: 18, backgroundColor: colors.border },
  mode: { flex: 1, minHeight: 52, paddingHorizontal: 10, paddingVertical: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  modeSelected: { backgroundColor: colors.surface },
  modeText: { color: colors.muted, fontSize: 15, fontWeight: '500', writingDirection: 'rtl', textAlign: 'center' },
  modeTextSelected: { color: colors.ink, fontWeight: '700' },
  accessLink: { minHeight: 52, flexDirection: 'row-reverse', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingVertical: 12 },
  accessText: { ...ui.subtitle, flexGrow: 1, flexShrink: 1 },
  accessConnected: { color: colors.green },
  linkText: { color: colors.green, fontSize: 14, fontWeight: '600', textAlign: 'right', writingDirection: 'rtl' },
  card: { ...ui.card, minHeight: 250, justifyContent: 'center', marginTop: 20, paddingVertical: 28 },
  cardActive: { borderColor: '#E8C9C5' },
  state: { fontSize: 22, lineHeight: 32, fontWeight: '700', color: colors.ink, textAlign: 'center', writingDirection: 'rtl' },
  recording: { color: colors.danger },
  caption: { ...ui.body, textAlign: 'center', marginTop: 10 },
  timer: { fontSize: 36, color: colors.ink, fontVariant: ['tabular-nums'], textAlign: 'center', marginTop: 12, writingDirection: 'ltr' },
  meters: { marginTop: 22 },
  meter: { marginBottom: 12 },
  meterLabel: { ...ui.subtitle },
  meterTrack: { height: 6, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden', marginTop: 6 },
  meterFill: { height: 6, backgroundColor: colors.green, borderRadius: 4 },
  warning: { ...ui.warning, marginTop: 12 },
  recordButton: { marginTop: 28, marginBottom: 12 },
  small: { ...ui.subtitle, textAlign: 'center' },
});
