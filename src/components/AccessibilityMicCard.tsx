import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { localizedError, t, useLocalizedStyles } from '../i18n';
import { useRecording } from '../context/RecordingContext';
import { accessibilityMicStep } from '../setup/readiness';
import { colors, ui } from '../theme';

export default function AccessibilityMicCard({ compact = false, showFallback = false, onStatusChanged }: {
  compact?: boolean; showFallback?: boolean; onStatusChanged?: () => Promise<void>;
}) {
  const styles = useLocalizedStyles(baseStyles);
  const { accessibilityMicStatus: status, autoRecordingStatus, setRecordingMode, openAccessibilityMicSetup, openAccessibilityMicAppInfo,
    refreshAccessibilityMicStatus, refreshAutoRecordingStatus, isBusy, isRecording,
    status: recorderStatus, systemAccessStatus } = useRecording();
  const mode = autoRecordingStatus.mode === 'accessibilityMic' ? 'accessibilityMic' : 'system';
  const step = accessibilityMicStep(status, mode);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const mounted = useRef(true);
  const focused = useRef(true);
  const running = useRef(false);
  const disabled = isBusy || working || isRecording || recorderStatus.audioMode !== 0 ||
    systemAccessStatus.offlineRecovery?.running === true || systemAccessStatus.connecting;
  useEffect(() => () => { mounted.current = false; focused.current = false; }, []);
  useFocusEffect(useCallback(() => { focused.current = true; return () => { focused.current = false; }; }, []));

  const run = async (action: () => Promise<void>) => {
    if (disabled || running.current || !mounted.current || !focused.current || AppState.currentState !== 'active') return;
    running.current = true; setWorking(true); setError(null);
    try {
      await action();
      await Promise.all([refreshAccessibilityMicStatus(), refreshAutoRecordingStatus()]);
      await onStatusChanged?.();
    } catch (failure) {
      if (mounted.current && focused.current) setError(localizedError(failure));
    } finally {
      running.current = false;
      if (mounted.current) setWorking(false);
    }
  };
  const choose = () => { if (disabled || !focused.current || !mounted.current) return; Alert.alert(t('accessibilityMicConsentTitle'), t('accessibilityMicConsent'), [
    { text: t('copy012'), style: 'cancel' },
    { text: t('accessibilityMicChoose'), onPress: () => { void run(() => setRecordingMode('accessibilityMic')); } },
  ]); };
  const returnToSystem = () => { if (disabled || !focused.current || !mounted.current) return; Alert.alert(t('accessibilityMicSystemTitle'), t('accessibilityMicSystemConsent'), [
    { text: t('copy012'), style: 'cancel' },
    { text: t('accessibilityMicReturnSystem'), onPress: () => { void run(() => setRecordingMode('system')); } },
  ]); };
  const label = {
    checking: 'cleanSettingsServiceChecking', unsupported: 'cleanSettingsServiceUnavailable', choose: 'cleanSettingsServiceTitle',
    permission: 'cleanSettingsServiceApproval', connecting: 'cleanSettingsServiceConnecting', ready: 'cleanSettingsServiceConnected',
  } as const;
  return <View style={styles.card}>
    <Text style={styles.title} accessibilityRole="header">{t(label[step])}</Text>
    <Text style={styles.body}>{t(step === 'permission' ? 'cleanSettingsServiceApprovalHelp'
      : step === 'connecting' ? 'cleanSettingsServiceConnectingHelp'
        : step === 'ready' ? 'cleanSettingsServiceReadyHelp' : 'cleanSettingsServiceIntro')}</Text>
    <Text style={styles.note}>{t('cleanSettingsServiceCheck')}</Text>
    {step === 'choose' && <TouchableOpacity style={[compact ? styles.secondary : styles.primary, disabled && ui.disabled]}
      disabled={disabled} accessibilityRole="button" onPress={choose}>
      <Text style={compact ? ui.secondaryText : ui.primaryText}>{t('cleanSettingsConnectService')}</Text>
    </TouchableOpacity>}
    {step === 'permission' && <TouchableOpacity style={[styles.primary, disabled && ui.disabled]} disabled={disabled}
      accessibilityRole="button" onPress={() => { void run(openAccessibilityMicSetup); }}>
      <Text style={ui.primaryText}>{t('accessibilityMicOpenSettings')}</Text>
    </TouchableOpacity>}
    {step === 'permission' && status?.appInfoRecoverySupported === true && <>
      <TouchableOpacity style={styles.linkButton} accessibilityRole="button" accessibilityState={{ expanded: showRecovery }}
        onPress={() => setShowRecovery(value => !value)}><Text style={styles.link}>{t('accessibilityMicAppInfoTitle')}</Text></TouchableOpacity>
      {showRecovery && <View style={styles.recovery}>
        <Text style={styles.body}>{t('accessibilityMicAppInfoHelp')}</Text>
        <TouchableOpacity style={[styles.secondary, disabled && ui.disabled]} disabled={disabled} accessibilityRole="button"
          onPress={() => { void run(openAccessibilityMicAppInfo); }}>
          <Text style={ui.secondaryText}>{t('accessibilityMicAppInfoOpen')}</Text>
        </TouchableOpacity>
      </View>}
    </>}
    {(step === 'checking' || step === 'connecting') && <TouchableOpacity style={[styles.primary, disabled && ui.disabled]}
      disabled={disabled} accessibilityRole="button" onPress={() => { void run(async () => {}); }}>
      <Text style={ui.primaryText}>{t('copy327')}</Text>
    </TouchableOpacity>}
    <TouchableOpacity style={styles.linkButton} accessibilityRole="button" accessibilityState={{ expanded: showHelp }}
      onPress={() => setShowHelp(value => !value)}><Text style={styles.link}>{t('cleanSettingsServiceHelp')}</Text></TouchableOpacity>
    {showHelp && <View style={styles.recovery}>
      <Text style={styles.body}>{t('accessibilityMicLimits')}</Text>
      {step === 'permission' && <Text style={styles.body}>{t('accessibilityMicPermissionHelp')}</Text>}
      {step === 'connecting' && <Text style={styles.body}>{t('accessibilityMicConnectingHelp')}</Text>}
      {step === 'ready' && <Text style={styles.body}>{t('accessibilityMicReadyHelp')}</Text>}
      {step === 'unsupported' && <Text style={styles.body}>{t('accessibilityMicUnsupported')}</Text>}
      {step === 'connecting' && <TouchableOpacity style={styles.linkButton} disabled={disabled} accessibilityRole="button"
        onPress={() => { void run(openAccessibilityMicSetup); }}><Text style={styles.link}>{t('accessibilityMicOpenSettings')}</Text></TouchableOpacity>}
      {showFallback && mode === 'accessibilityMic' && <TouchableOpacity style={styles.linkButton} disabled={disabled} accessibilityRole="button"
        onPress={returnToSystem}><Text style={styles.link}>{t('accessibilityMicReturnSystem')}</Text></TouchableOpacity>}
    </View>}
    {error && <Text style={ui.warning} accessibilityLiveRegion="polite">{localizedError(error)}</Text>}
  </View>;
}

const baseStyles = StyleSheet.create({
  card: { ...ui.card, padding: 20, marginBottom: 14 },
  title: { ...ui.label, fontSize: 17, marginBottom: 12 },
  body: { ...ui.body, fontSize: 14, marginBottom: 12 },
  note: { ...ui.subtitle, fontSize: 12, marginBottom: 12 },
  primary: { ...ui.primaryButton, marginTop: 4 }, secondary: { ...ui.secondaryButton, marginTop: 4 },
  recovery: { marginTop: 18, paddingTop: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  linkButton: { minHeight: 48, justifyContent: 'center', paddingVertical: 12 },
  link: { color: colors.green, textAlign: 'right', writingDirection: 'rtl', fontSize: 13, lineHeight: 21 },
});
