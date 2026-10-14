import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useRecording } from '../context/RecordingContext';
import { recorderErrorMessage } from '../services/NativeRecorder';
import type { TranslationKey } from '../i18n/catalog';
import { localizedError, t, useLocalizedStyles } from '../i18n';
import { colors, ui } from '../theme';

const progressKeys: Record<string, TranslationKey> = {
  enabling: 'offlineRecoveryChecking', hotspot: 'offlineRecoveryHotspot',
  discovering: 'offlineRecoveryDiscovering', connecting: 'offlineRecoveryConnecting',
  bootstrap: 'offlineRecoveryStarting', authenticating: 'offlineRecoveryAuthenticating',
  handoff: 'offlineRecoveryHandoff', restoring: 'offlineRecoveryRestoring',
  verifying: 'offlineRecoveryVerifying',
};

export default function OfflineRecoveryCard({ onOpenSetup, compact = false }: {
  onOpenSetup: () => void; compact?: boolean;
}) {
  const styles = useLocalizedStyles(baseStyles);
  const { systemAccessStatus: access, isBusy, isRecording, setOfflineRecoveryEnabled,
    requestOfflineRecoveryPermission, connectSystemRecorderOffline, cancelOfflineRecovery,
    openSystemAccessSetup } = useRecording();
  const recovery = access.offlineRecovery;
  const [pending, setPending] = useState<'enable' | 'disable' | 'activate' | 'permission' | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const mounted = useRef(true);
  // Navigation may leave Settings mounted while another app screen is shown.
  // Settled work must clear its local busy state even while this card is blurred.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const running = recovery?.running === true;
  const busy = isBusy || pending !== null || running || canceling;
  const disabled = busy || isRecording || !recovery?.supported;
  const prepared = recovery?.enabled === true && recovery.secureSettingsGranted && access.paired;
  const requiresInitialSetup = !access.paired ||
    (recovery?.secureSettingsGranted !== true && !access.wirelessDebuggingEnabled);
  const attemptPending = running || pending === 'activate' || pending === 'enable' || canceling;

  const perform = async (action: 'enable' | 'disable' | 'activate' | 'permission', work: () => Promise<void>) => {
    if (busy || isRecording) return;
    setPending(action); setLocalError(null);
    try { await work(); }
    catch (failure) { if (mounted.current) setLocalError(localizedError(failure, 'offlineRecoveryFailed')); }
    finally { if (mounted.current) setPending(null); }
  };

  const explainPermission = () => Alert.alert(t('offlineRecoveryNearbyTitle'), t('offlineRecoveryNearbyHelp'), [
    { text: t('copy012'), style: 'cancel' },
    { text: t('offlineRecoveryNearbyAction'), onPress: () => { void perform('permission', requestOfflineRecoveryPermission); } },
  ]);
  const explainPreparation = () => Alert.alert(t('offlineRecoveryConsentTitle'), t('offlineRecoveryConsent'), [
    { text: t('copy012'), style: 'cancel' },
    { text: t('offlineRecoveryApprove'), onPress: () => { void perform('enable', () => setOfflineRecoveryEnabled(true)); } },
  ]);
  const cancel = async () => {
    if (canceling) return;
    setCanceling(true); setLocalError(null);
    try { await cancelOfflineRecovery(); }
    catch (failure) { if (mounted.current) setLocalError(localizedError(failure, 'offlineRecoveryFailed')); }
    finally { if (mounted.current) setCanceling(false); }
  };
  const errorCode = recovery?.errorCode;
  const error = localError || (errorCode ? recorderErrorMessage(errorCode) : null);
  // Only authoritative helperConnected after the native attempt finishes is ready.
  const statusKey: TranslationKey = canceling ? 'offlineRecoveryCancelling'
    : running ? progressKeys[recovery.stage] ?? 'offlineRecoveryChecking'
      : pending ? 'offlineRecoveryChecking'
        : !recovery ? 'offlineRecoveryUnavailable'
          : !recovery.supported ? 'offlineRecoveryUnsupported'
            : requiresInitialSetup ? 'offlineRecoverySetupRequired'
              : !recovery.enabled ? 'offlineRecoveryOff'
                : !recovery.secureSettingsGranted ? 'offlineRecoveryGrantRequired'
                  : !recovery.nearbyWifiGranted ? 'offlineRecoveryNearbyRequired'
                    : access.helperConnected ? 'offlineRecoveryReady'
                      : 'offlineRecoveryPrepared';
  const nextKey: TranslationKey = requiresInitialSetup ? 'offlineRecoveryInitialSetup'
    : !prepared ? 'offlineRecoveryPrepare'
      : !recovery?.nearbyWifiGranted ? 'offlineRecoveryNearbyAction'
        : access.helperConnected ? 'offlineRecoveryContinueSetup'
          : errorCode === 'OFFLINE_WIFI_DISABLED' ? 'offlineRecoveryWifiSettings'
            : 'offlineRecoveryActivate';
  const openWifi = () => {
    void openSystemAccessSetup('wifi').catch(failure => {
      if (mounted.current) setLocalError(localizedError(failure));
    });
  };
  const openInitialSetup = () => {
    if (!access.paired) { onOpenSetup(); return; }
    // A connected ordinary helper does not supply the one-time ADB grant.
    // Opening the general wizard may skip directly to Auto while this is missing.
    void openSystemAccessSetup('wireless').catch(failure => {
      if (mounted.current) setLocalError(localizedError(failure));
    });
  };
  const next = () => {
    if (disabled) return;
    if (requiresInitialSetup) openInitialSetup();
    else if (nextKey === 'offlineRecoveryContinueSetup') onOpenSetup();
    else if (!prepared) explainPreparation();
    else if (!recovery?.nearbyWifiGranted) explainPermission();
    else if (nextKey === 'offlineRecoveryWifiSettings') openWifi();
    else void perform('activate', connectSystemRecorderOffline);
  };

  return <View style={[styles.card, compact && styles.compact]}>
    <View style={styles.heading}>
      <Text style={styles.title}>{t('offlineRecoveryTitle')}</Text>
      <Text style={styles.badge}>{t('offlineRecoveryExperimental')}</Text>
    </View>
    <Text style={styles.body}>{t(compact ? 'offlineRecoveryCompactHelp' : 'offlineRecoveryHelp')}</Text>
    <View style={styles.statusRow}>
      {busy && <ActivityIndicator color={colors.green} />}
      <Text style={styles.status} accessibilityLiveRegion="polite">{t(statusKey)}</Text>
    </View>
    {attemptPending && <TouchableOpacity style={[styles.secondary, canceling && ui.disabled]}
      disabled={canceling} onPress={() => { void cancel(); }} accessibilityRole="button">
      <Text style={ui.secondaryText}>{t('offlineRecoveryCancel')}</Text>
    </TouchableOpacity>}
    {recovery?.supported && !attemptPending && <>
      <TouchableOpacity style={[styles.primary, disabled && ui.disabled]} disabled={disabled}
        onPress={next} accessibilityRole="button">
        <Text style={ui.primaryText}>{t(nextKey)}</Text>
      </TouchableOpacity>
      {prepared && !recovery.nearbyWifiGranted &&
        <TouchableOpacity style={[styles.linkButton, disabled && ui.disabled]} disabled={disabled}
          onPress={() => { void Linking.openSettings().catch(() => {
            if (mounted.current) setLocalError(t('offlineRecoveryFailed'));
          }); }} accessibilityRole="button">
          <Text style={styles.link}>{t('offlineRecoveryAppSettings')}</Text>
        </TouchableOpacity>}
      {access.helperConnected && nextKey !== 'offlineRecoveryContinueSetup' &&
        <Text style={styles.note}>{t('offlineRecoveryConnectedNeedsPreparation')}</Text>}
      {nextKey !== 'offlineRecoveryInitialSetup' && nextKey !== 'offlineRecoveryContinueSetup' && (!compact || recovery.enabled) &&
        <TouchableOpacity style={[styles.linkButton, disabled && ui.disabled]} disabled={disabled}
          onPress={access.helperConnected || recovery.secureSettingsGranted ? onOpenSetup : openInitialSetup} accessibilityRole="button"><Text style={styles.link}>{t(access.helperConnected ? 'offlineRecoveryContinueSetup' : 'offlineRecoveryNormalSetup')}</Text></TouchableOpacity>}
    </>}
    {(!compact || recovery?.enabled) && <View style={styles.preference}>
      <Text style={styles.preferenceLabel}>{t('offlineRecoveryEnable')}</Text>
      <Switch value={recovery?.enabled === true} disabled={disabled}
        onValueChange={enabled => {
          if (disabled) return;
          if (enabled) explainPreparation();
          else void perform('disable', () => setOfflineRecoveryEnabled(false));
        }} trackColor={{ false: colors.border, true: colors.green }} thumbColor={colors.surface}
        accessibilityLabel={t('offlineRecoveryEnable')} accessibilityState={{ disabled }} />
    </View>}
    {isRecording && <Text style={styles.note}>{t('offlineRecoveryRecordingBusy')}</Text>}
    {error && <Text style={styles.error} accessibilityLiveRegion="polite">{localizedError(error, 'offlineRecoveryFailed')}</Text>}
  </View>;
}

const baseStyles = StyleSheet.create({
  card: { ...ui.card, padding: 20, marginTop: 24 },
  compact: { backgroundColor: colors.background, marginTop: 12, padding: 16 },
  heading: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  title: { ...ui.label, fontSize: 17, flex: 1 },
  badge: { ...ui.subtitle, color: colors.amber, fontSize: 12 },
  body: { ...ui.body, fontSize: 14, marginTop: 12, marginBottom: 12 },
  statusRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  status: { ...ui.subtitle, flex: 1, fontSize: 13 },
  primary: { ...ui.primaryButton, marginTop: 16 },
  secondary: { ...ui.secondaryButton, marginTop: 12 },
  preference: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginTop: 12 },
  preferenceLabel: { ...ui.subtitle, fontSize: 12, flex: 1 },
  linkButton: { minHeight: 48, justifyContent: 'center', paddingVertical: 12 },
  link: { ...ui.subtitle, color: colors.green, fontWeight: '600', fontSize: 13 },
  note: { ...ui.subtitle, fontSize: 12, marginTop: 8 },
  error: { ...ui.warning, marginTop: 10 },
});
