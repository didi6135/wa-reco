import { localizedError, t, useLocalizedStyles } from '../i18n';
import React, { useState } from 'react';
import { Alert, Linking, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRecording } from '../context/RecordingContext';
import { WaveMark } from './Visuals';
import { colors, ui } from '../theme';
import { SystemAccessStatus } from '../services/NativeRecorder';
import { phoneSetupStep } from '../setup/readiness';
import OfflineRecoveryCard from './OfflineRecoveryCard';

const messageOf = (failure: unknown) => localizedError(failure);
const readPort = (value: string): number | null => {
  if (!/^\d{1,5}$/.test(value.trim())) return null;
  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : null;
};

export default function SystemSetupWizard({ compact = false, focused = false, onShowDetails, accessOverride, onStatusChanged }: {
  compact?: boolean; focused?: boolean; onShowDetails?: () => void;
  accessOverride?: SystemAccessStatus | null; onStatusChanged?: () => Promise<void>;
}) {
  const styles = useLocalizedStyles(baseStyles);
  const { systemAccessStatus: storedAccess, deviceInfo, isBusy, isRecording, prepareSystemPairing,
    pairSystemRecorder, connectSystemRecorder, openSystemAccessSetup, refreshSystemAccessStatus } = useRecording();
  const access = accessOverride ?? storedAccess;
  const [showManualPairing, setShowManualPairing] = useState(false);
  const [showManualConnection, setShowManualConnection] = useState(false);
  const [showOrdinaryActivation, setShowOrdinaryActivation] = useState(false);
  const [showSetupDetails, setShowSetupDetails] = useState(false);
  const [pairingPort, setPairingPort] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [connectionPort, setConnectionPort] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const pairingSetup = access.pairingSetup;
  const developerEnabled = access.developerOptionsEnabled ?? access.wirelessDebuggingEnabled;
  const canPair = developerEnabled && access.wirelessDebuggingEnabled;
  const disabled = isBusy || isRecording || access.connecting || access.offlineRecovery?.running === true || pairingSetup?.pairing === true;
  const compatibilityText = deviceInfo && (deviceInfo.sdk === 34 || deviceInfo.sdk === 35)
    ? t('copy090')
    : deviceInfo && deviceInfo.sdk > 36
      ? t('copy091')
      : null;

  const openSetup = async (destination: 'about' | 'developer' | 'wireless') => {
    try { await openSystemAccessSetup(destination); }
    catch (failure) { setLocalError(messageOf(failure)); }
  };

  const beginPairing = async () => {
    setLocalError(null);
    try {
      await prepareSystemPairing();
      await openSystemAccessSetup('wireless');
    } catch (failure) {
      setLocalError(messageOf(failure));
      setShowManualPairing(true);
    }
  };

  const showPairingInstructions = () => Alert.alert(
    t('copy092'),
    t('copy093'),
    [
      { text: t('copy012'), style: 'cancel' },
      { text: t('copy094'), onPress: () => { void beginPairing(); } },
    ],
  );

  const pairManually = async () => {
    const port = readPort(pairingPort);
    if (port === null || !/^\d{6}$/.test(pairingCode)) {
      setLocalError(t('copy095'));
      return;
    }
    setLocalError(null);
    try {
      await pairSystemRecorder(port, pairingCode);
      setPairingCode('');
      await refreshSystemAccessStatus();
      await onStatusChanged?.();
    } catch (failure) { setLocalError(messageOf(failure)); }
  };

  const connect = async (manual: boolean) => {
    const port = manual ? readPort(connectionPort) : 0;
    if (port === null) {
      setLocalError(t('copy096'));
      return;
    }
    setLocalError(null);
    try {
      await connectSystemRecorder(port);
      await refreshSystemAccessStatus();
      await onStatusChanged?.();
    } catch (failure) {
      setLocalError(messageOf(failure));
      setShowManualConnection(true);
    }
  };

  const statusText = access.connecting ? t('copy097')
    : access.helperConnected ? t('copy098')
    : pairingSetup?.pairing ? t('copy099')
      : access.paired ? t('copy100')
        : pairingSetup?.active && pairingSetup.localPortAvailable ? t('copy101')
          : pairingSetup?.active && pairingSetup.discovering ? t('copy102')
            : pairingSetup?.active ? t('copy103')
        : access.wirelessDebuggingEnabled ? t('copy104')
          : t('copy105');
  const pairingError = !access.paired || pairingSetup?.active ? pairingSetup?.error : null;
  const errorText = localError || pairingError || access.error;

  if (focused) {
    const step = phoneSetupStep(accessOverride === null ? null : access);
    const recoveryAvailable = access.paired && access.offlineRecovery?.supported &&
      (step === 'wireless' || step === 'connect');
    // Ordinary activation stays first until the user explicitly prepares recovery.
    // Once opted in, show its next action without a competing activation block.
    if (recoveryAvailable && access.offlineRecovery?.enabled && !showOrdinaryActivation)
      return <OfflineRecoveryCard compact onOpenSetup={() => setShowOrdinaryActivation(true)} />;
    const text = {
      checking: [t('copy106'), t('copy107')],
      ready: [t('copy108'), t('copy109')],
      unsupported: [t('copy110'), t('copy111')],
      developer: [t('copy112'), t('copy113')],
      wireless: [t('copy114'), t('copy115')],
      pair: [t('copy116'), t('copy117')],
      connect: [t('copy118'), t('copy119')],
    }[step];
    return <View style={styles.card}>
      <Text style={styles.title}>{text[0]}</Text>
      <Text style={[styles.body, { marginTop: 12 }]}>{text[1]}</Text>
      {compatibilityText && <Text style={styles.small}>{compatibilityText}</Text>}
      {step === 'developer' && <TouchableOpacity style={[styles.primaryButton, disabled && styles.disabled]} onPress={() => { void openSetup('about'); }} disabled={disabled} accessibilityRole="button"><Text style={styles.primaryText}>{t('copy120')}</Text></TouchableOpacity>}
      {step === 'wireless' && <TouchableOpacity style={[styles.primaryButton, disabled && styles.disabled]} onPress={() => { void openSetup('wireless'); }} disabled={disabled} accessibilityRole="button"><Text style={styles.primaryText}>{t('copy121')}</Text></TouchableOpacity>}
      {step === 'checking' && <TouchableOpacity style={styles.secondaryButton} onPress={() => { void onStatusChanged?.(); }} accessibilityRole="button"><Text style={styles.secondaryText}>{t('copy122')}</Text></TouchableOpacity>}
      {step === 'pair' && <>
        {pairingSetup?.active && <Text style={styles.small} accessibilityLiveRegion="polite">{pairingSetup.pairing ? t('copy123') : pairingSetup.localPortAvailable ? t('copy124') : t('copy125')}</Text>}
        <TouchableOpacity style={[styles.primaryButton, disabled && styles.disabled]} onPress={showPairingInstructions} disabled={disabled} accessibilityRole="button"><Text style={styles.primaryText}>{t('copy126')}</Text></TouchableOpacity>
        <TouchableOpacity style={styles.textButton} onPress={() => setShowManualPairing(value => !value)} disabled={disabled} accessibilityRole="button"><Text style={styles.link}>{showManualPairing ? t('copy127') : t('copy128')}</Text></TouchableOpacity>
      </>}
      {step === 'connect' && <>
        <TouchableOpacity style={[styles.primaryButton, disabled && styles.disabled]} onPress={() => { void connect(false); }} disabled={disabled} accessibilityRole="button"><Text style={styles.primaryText}>{access.connecting ? t('copy129') : t('copy130')}</Text></TouchableOpacity>
        <TouchableOpacity style={styles.textButton} onPress={() => setShowManualConnection(value => !value)} disabled={disabled} accessibilityRole="button"><Text style={styles.link}>{showManualConnection ? t('copy131') : t('copy132')}</Text></TouchableOpacity>
        {showManualConnection && <View style={styles.fallback}>
          <Text style={styles.body}>{t('copy133')}</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => { void openSetup('wireless'); }} disabled={disabled} accessibilityRole="button"><Text style={styles.secondaryText}>{t('copy134')}</Text></TouchableOpacity>
          <TextInput style={styles.input} value={connectionPort} onChangeText={value => setConnectionPort(value.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={5} editable={!disabled} placeholder={t('copy135')} placeholderTextColor={colors.muted} accessibilityLabel={t('copy136')} />
          <TouchableOpacity style={[styles.primaryButton, disabled && styles.disabled]} onPress={() => { void connect(true); }} disabled={disabled} accessibilityRole="button"><Text style={styles.primaryText}>{t('copy137')}</Text></TouchableOpacity>
        </View>}
        {errorText && <TouchableOpacity style={styles.textButton} onPress={showPairingInstructions} disabled={disabled} accessibilityRole="button"><Text style={styles.link}>{t('copy138')}</Text></TouchableOpacity>}
        {(pairingSetup?.active || showManualPairing) && <TouchableOpacity style={styles.textButton} onPress={() => setShowManualPairing(value => !value)} disabled={disabled} accessibilityRole="button"><Text style={styles.link}>{showManualPairing ? t('copy127') : t('copy128')}</Text></TouchableOpacity>}
      </>}
      {(step === 'pair' || step === 'connect') && showManualPairing && <View style={styles.fallback}>
        <Text style={styles.body}>{t('copy139')}</Text>
        <Text style={styles.label}>{t('copy140')}</Text>
        <TextInput style={styles.input} value={pairingPort} onChangeText={value => setPairingPort(value.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={5} editable={!disabled} placeholder={t('copy141')} placeholderTextColor={colors.muted} accessibilityLabel={t('copy142')} />
        <Text style={styles.label}>{t('copy143')}</Text>
        <TextInput style={styles.input} value={pairingCode} onChangeText={value => setPairingCode(value.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={6} editable={!disabled} secureTextEntry placeholder={t('copy144')} placeholderTextColor={colors.muted} accessibilityLabel={t('copy145')} />
        <TouchableOpacity style={[styles.primaryButton, disabled && styles.disabled]} onPress={() => { void pairManually(); }} disabled={disabled} accessibilityRole="button"><Text style={styles.primaryText}>{t('copy146')}</Text></TouchableOpacity>
      </View>}
      {recoveryAvailable && !access.offlineRecovery?.enabled && step === 'connect' &&
        <OfflineRecoveryCard compact onOpenSetup={() => { void openSetup('wireless'); }} />}
      {recoveryAvailable && access.offlineRecovery?.enabled && showOrdinaryActivation &&
        <TouchableOpacity style={styles.textButton} onPress={() => setShowOrdinaryActivation(false)} disabled={disabled} accessibilityRole="button">
          <Text style={styles.link}>{t('offlineRecoveryReturn')}</Text>
        </TouchableOpacity>}
      {errorText && <Text style={styles.error} accessibilityLiveRegion="polite">{localizedError(errorText)}</Text>}
    </View>;
  }

  if (!access.available) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{t('copy149')}</Text>
        <Text style={styles.body}>{Platform.OS !== 'android' ? t('copy150') : deviceInfo ? t('copy151') : t('copy152')}</Text>
        <Text style={styles.small}>{t('copy153')}</Text>
        {errorText && <Text style={styles.error}>{localizedError(errorText)}</Text>}
      </View>
    );
  }

  if (compact && onShowDetails) {
    return <View style={styles.card}>
      <View style={styles.heading}><WaveMark size={38} /><Text style={styles.title}>{t('copy154')}</Text></View>
      <Text style={styles.body}>{access.connecting ? t('copy097') : access.paired ? t('copy155') : t('copy156')}</Text>
      {compatibilityText && <Text style={styles.small}>{compatibilityText}</Text>}
      <TouchableOpacity style={[styles.primaryButton, disabled && styles.disabled]} onPress={access.paired && canPair ? () => { void connect(false); } : onShowDetails} disabled={disabled} accessibilityRole="button"><Text style={styles.primaryText}>{access.connecting ? t('copy157') : access.paired && canPair ? t('copy158') : t('copy159')}</Text></TouchableOpacity>
      {errorText && <Text style={styles.error} accessibilityLiveRegion="polite">{localizedError(errorText)}</Text>}
    </View>;
  }

  return (
    <View style={styles.card}>
      <View style={styles.heading}><WaveMark size={38} /><Text style={styles.title}>{t('copy149')}</Text></View>
      {!access.helperConnected && <View style={styles.progress}>{[developerEnabled, access.wirelessDebuggingEnabled, access.paired].map((complete, index) => <View key={index} style={[styles.progressStep, complete && styles.progressComplete]} />)}</View>}
      <Text style={[styles.status, access.helperConnected && styles.ready]} accessibilityLiveRegion="polite">{statusText}</Text>
      {compatibilityText && <Text style={styles.small}>{compatibilityText}</Text>}
      {!compact && <Text style={styles.body}>{access.helperConnected
        ? t('copy160')
        : t('copy161')}</Text>}
      {!access.helperConnected && <Text style={styles.body}>{t('copy162')}</Text>}
      {!access.helperConnected && <>
        {developerEnabled && <Text style={styles.completed}>{t('copy163')}</Text>}
        {access.wirelessDebuggingEnabled && <Text style={styles.completed}>{t('copy164')}</Text>}
        {(!developerEnabled || (!compact && showSetupDetails)) && <>
        <Text style={styles.step}>{t('copy165')}</Text>
        <Text style={styles.body}>{t('copy166')}</Text>
        <TouchableOpacity style={[styles.secondaryButton, disabled && styles.disabled]} onPress={() => { void openSetup('about'); }} disabled={disabled} accessibilityRole="button"><Text style={styles.secondaryText}>{t('copy120')}</Text></TouchableOpacity>
        </>}
        {(developerEnabled && !access.wirelessDebuggingEnabled || (!compact && showSetupDetails)) && <>
        <Text style={styles.step}>{t('copy167')}</Text>
        <Text style={styles.body}>{t('copy168')}</Text>
        <TouchableOpacity style={[styles.secondaryButton, disabled && styles.disabled]} onPress={() => { void openSetup('wireless'); }} disabled={disabled} accessibilityRole="button"><Text style={styles.secondaryText}>{t('copy169')}</Text></TouchableOpacity>
        </>}
        {canPair && !access.paired && <>
        <Text style={styles.step}>{t('copy170')}</Text>
        <Text style={styles.body}>{t('copy171')}</Text>
        </>}
        {!compact && developerEnabled && <TouchableOpacity style={styles.textButton} onPress={() => setShowSetupDetails(!showSetupDetails)} accessibilityRole="button"><Text style={styles.link}>{showSetupDetails ? t('copy172') : t('copy173')}</Text></TouchableOpacity>}
      </>}
      {!access.paired && canPair && <TouchableOpacity style={[styles.primaryButton, disabled && styles.disabled]} onPress={showPairingInstructions} disabled={disabled} accessibilityRole="button"><Text style={styles.primaryText}>{pairingSetup?.pairing ? t('copy174') : t('copy175')}</Text></TouchableOpacity>}
      {access.paired && !access.helperConnected && <>
        {canPair && <>
        <TouchableOpacity style={[styles.primaryButton, disabled && styles.disabled]} onPress={() => { void connect(false); }} disabled={disabled} accessibilityRole="button"><Text style={styles.primaryText}>{access.connecting ? t('copy157') : t('copy176')}</Text></TouchableOpacity>
        <Text style={styles.small}>{t('copy177')}</Text>
        <TouchableOpacity style={[styles.secondaryButton, disabled && styles.disabled]} onPress={showPairingInstructions} disabled={disabled} accessibilityRole="button"><Text style={styles.secondaryText}>{t('copy178')}</Text></TouchableOpacity>
        </>}
      </>}
      {compact && onShowDetails && <TouchableOpacity style={styles.textButton} onPress={onShowDetails} accessibilityRole="button"><Text style={styles.link}>{t('copy179')}</Text></TouchableOpacity>}
      {!compact && !access.helperConnected && <>
        <TouchableOpacity style={styles.textButton} onPress={() => setShowManualPairing(!showManualPairing)} accessibilityRole="button"><Text style={styles.link}>{showManualPairing ? t('copy127') : t('copy180')}</Text></TouchableOpacity>
        {showManualPairing && <View style={styles.fallback}>
          <Text style={styles.step}>{t('copy181')}</Text>
          <Text style={styles.body}>{t('copy182')}</Text>
          <TouchableOpacity style={[styles.secondaryButton, disabled && styles.disabled]} onPress={() => { void openSetup('wireless'); }} disabled={disabled} accessibilityRole="button"><Text style={styles.secondaryText}>{t('copy183')}</Text></TouchableOpacity>
          <Text style={styles.label}>{t('copy184')}</Text>
          <Text style={styles.small}>{t('copy185')}</Text>
          <TextInput style={styles.input} value={pairingPort} onChangeText={value => setPairingPort(value.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={5} editable={!disabled} placeholder={t('copy141')} placeholderTextColor="#777" accessibilityLabel={t('copy142')} />
          <Text style={styles.label}>{t('copy143')}</Text>
          <TextInput style={styles.input} value={pairingCode} onChangeText={value => setPairingCode(value.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={6} editable={!disabled} secureTextEntry placeholder={t('copy186')} placeholderTextColor="#777" accessibilityLabel={t('copy145')} />
          <TouchableOpacity style={[styles.primaryButton, disabled && styles.disabled]} onPress={() => { void pairManually(); }} disabled={disabled} accessibilityRole="button"><Text style={styles.primaryText}>{t('copy187')}</Text></TouchableOpacity>
          <TouchableOpacity style={styles.textButton} onPress={() => { void Linking.openSettings().catch(failure => setLocalError(messageOf(failure))); }} accessibilityRole="button"><Text style={styles.link}>{t('copy188')}</Text></TouchableOpacity>
        </View>}
        {access.paired && <TouchableOpacity style={styles.textButton} onPress={() => setShowManualConnection(!showManualConnection)} accessibilityRole="button"><Text style={styles.link}>{showManualConnection ? t('copy189') : t('copy190')}</Text></TouchableOpacity>}
        {access.paired && showManualConnection && <View style={styles.fallback}>
          <Text style={styles.body}>{t('copy191')}</Text>
          <TextInput style={styles.input} value={connectionPort} onChangeText={value => setConnectionPort(value.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={5} editable={!disabled} placeholder={t('copy135')} placeholderTextColor="#777" accessibilityLabel={t('copy136')} />
          <TouchableOpacity style={[styles.primaryButton, disabled && styles.disabled]} onPress={() => { void connect(true); }} disabled={disabled} accessibilityRole="button"><Text style={styles.primaryText}>{t('copy137')}</Text></TouchableOpacity>
        </View>}
      </>}
      {errorText && <Text style={styles.error} accessibilityLiveRegion="polite">{localizedError(errorText)}</Text>}
      {!compact && <Text style={styles.small}>{t('copy192')}</Text>}
    </View>
  );
}

const baseStyles = StyleSheet.create({
  card: { ...ui.card, padding: 20, marginBottom: 14 },
  heading: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, marginBottom: 18 },
  title: { ...ui.label, fontSize: 17, flex: 1 },
  status: { ...ui.body, fontSize: 14, color: colors.amber, marginBottom: 8 },
  ready: { color: colors.green },
  completed: { color: colors.green, fontSize: 13, textAlign: 'right', writingDirection: 'rtl', marginBottom: 8 },
  body: { ...ui.body, fontSize: 14, marginBottom: 12 },
  small: { ...ui.subtitle, fontSize: 12, marginBottom: 8 },
  step: { ...ui.label, marginTop: 16, marginBottom: 8 },
  primaryButton: { ...ui.primaryButton, marginVertical: 8 },
  primaryText: ui.primaryText,
  secondaryButton: { ...ui.secondaryButton, marginVertical: 6 },
  secondaryText: ui.secondaryText,
  textButton: { minHeight: 48, paddingVertical: 14, justifyContent: 'center' },
  link: { color: colors.green, fontSize: 13, fontWeight: '600', textAlign: 'right', writingDirection: 'rtl' },
  disabled: { opacity: 0.4 },
  fallback: { backgroundColor: colors.background, borderRadius: 18, padding: 16, marginTop: 6 },
  label: { ...ui.label, fontSize: 14, marginTop: 10, marginBottom: 8 },
  input: { minHeight: 54, borderWidth: 1, borderColor: '#BACBC3', borderRadius: 14, backgroundColor: colors.surface, paddingHorizontal: 16, fontSize: 16, color: colors.ink, textAlign: 'right', writingDirection: 'ltr', marginBottom: 10 },
  error: { ...ui.warning, marginVertical: 8 },
  progress: { flexDirection: 'row-reverse', gap: 6, marginBottom: 18 },
  progressStep: { flex: 1, height: 4, borderRadius: 4, backgroundColor: colors.border },
  progressComplete: { backgroundColor: colors.green },
});
