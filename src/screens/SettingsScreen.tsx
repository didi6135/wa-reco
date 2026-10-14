import { localizedError, t, useLocalization, useLocalizedStyles } from '../i18n';
import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useRecording } from '../context/RecordingContext';
import { useSetup } from '../setup/SetupContext';
import { BottomNav } from '../components/Visuals';
import { colors, ui } from '../theme';
import DriveBackupCard from '../components/DriveBackupCard';
import TelegramBackupCard from '../components/TelegramBackupCard';
import CallNameCard from '../components/CallNameCard';
import AutoRecordingCard from '../components/AutoRecordingCard';
import OfflineRecoveryCard from '../components/OfflineRecoveryCard';

type Section = 'connection' | 'automatic' | 'backups' | 'names' | 'language';
type BackupSection = 'drive' | 'telegram';

function Disclosure({ title, detail, expanded, onPress, children, nested = false }: {
  title: string; detail?: string; expanded: boolean; onPress: () => void; children: React.ReactNode; nested?: boolean;
}) {
  const styles = useLocalizedStyles(baseStyles);
  const { isRTL } = useLocalization();
  return <View style={[styles.section, nested && styles.nestedSection]}>
    <TouchableOpacity style={styles.row} onPress={onPress} accessibilityRole="button"
      accessibilityLabel={title} accessibilityState={{ expanded }}>
      <View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text>
        {!!detail && <Text style={styles.rowDetail}>{detail}</Text>}</View>
      <Text style={styles.chevron} importantForAccessibility="no">{expanded ? '−' : isRTL ? '‹' : '›'}</Text>
    </TouchableOpacity>
    {expanded && <View style={styles.sectionContent}>{children}</View>}
  </View>;
}

export default function SettingsScreen() {
  const styles = useLocalizedStyles(baseStyles);
  const { language, selectLanguage, error: languageError } = useLocalization();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList, 'Settings'>>();
  const insets = useSafeAreaInsets();
  const { isBusy, isRecording, autoRecordingStatus } = useRecording();
  const { loading, readiness, refresh, setupError } = useSetup();
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [section, setSection] = useState<Section | null>(null);
  const [backupSection, setBackupSection] = useState<BackupSection | null>(null);
  const waiting = loading || checking;
  // Optional Auto must not make a ready manual recording mode appear broken.
  // Actual connection is distinct from two-party audibility, which needs a call test.
  const restoreSystem = readiness.mode === 'accessibilityMic' || autoRecordingStatus.mode === 'accessibilityMic';
  const manualReady = !restoreSystem && !setupError && readiness.captureReady && readiness.microphone && readiness.notifications;
  const automaticReady = manualReady && readiness.automatic;
  const title = waiting ? 'cleanSettingsChecking' : isRecording ? 'cleanSettingsRecording'
    : restoreSystem ? 'pairedSetupRestoreTitle' : setupError ? 'cleanSettingsNeedsCheck' : automaticReady ? 'cleanSettingsAutomaticReady'
      : manualReady ? 'cleanSettingsManualReady' : 'cleanSettingsNeedsSetup';
  const body = waiting ? 'cleanSettingsCheckingHelp' : isRecording ? 'cleanSettingsRecordingHelp'
    : restoreSystem ? 'pairedSetupRestoreHelp' : setupError ? 'cleanSettingsNeedsCheckHelp' : automaticReady ? 'cleanSettingsAutomaticHelp'
      : manualReady ? 'cleanSettingsManualHelp' : 'cleanSettingsSetupHelp';
  const autoLabel = restoreSystem ? t('pairedSetupRestoreTitle') : readiness.automatic ? t('cleanSettingsAutoOn')
    : autoRecordingStatus.enabled ? t('cleanSettingsAutoNeedsAction') : t('cleanSettingsAutoOff');

  const checkAgain = async () => {
    if (waiting) return;
    setChecking(true); setCheckError(null);
    try { await refresh(); }
    catch { setCheckError(t('copy303')); }
    finally { setChecking(false); }
  };
  const toggle = (next: Section) => setSection(current => current === next ? null : next);
  const toggleBackup = (next: BackupSection) => setBackupSection(current => current === next ? null : next);

  return <View style={styles.container}>
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: Math.max(24, insets.top + 18) }]}>
      <Text style={styles.title}>{t('copy195')}</Text>
      <Text style={styles.subtitle}>{t('cleanSettingsSubtitle')}</Text>
      <View style={[styles.summary, (!manualReady || setupError) && styles.summaryPending]} accessibilityLiveRegion="polite">
        {waiting && <ActivityIndicator color={colors.green} style={styles.spinner} />}
        <Text style={styles.summaryTitle}>{t(title)}</Text>
        <Text style={styles.summaryBody}>{t(body)}</Text>
        {manualReady && <Text style={styles.summaryNote}>{t('systemReadyTestHint')}</Text>}
        <TouchableOpacity style={[styles.button, (waiting || isBusy || isRecording) && ui.disabled]}
          onPress={() => { if (!waiting && !isBusy && !isRecording) navigation.navigate('Setup'); }}
          disabled={waiting || isBusy || isRecording} accessibilityRole="button">
          <Text style={ui.primaryText}>{t(restoreSystem ? 'pairedSetupRestoreAction' : manualReady ? 'cleanSettingsManageRecording' : 'cleanSettingsCompleteSetup')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.refresh, waiting && ui.disabled]} onPress={() => { void checkAgain(); }}
          disabled={waiting} accessibilityRole="button" accessibilityLabel={t('copy326')}>
          <Text style={styles.refreshText}>{checking ? t('copy302') : t('cleanSettingsCheckAgain')}</Text>
        </TouchableOpacity>
        {(checkError || setupError) && <Text style={styles.error} accessibilityLiveRegion="polite">{localizedError(checkError || setupError)}</Text>}
      </View>
      <Disclosure title={t('offlineRecoveryTitle')} expanded={section === 'connection'} onPress={() => toggle('connection')}>
        {restoreSystem ? <View>
          <Text style={styles.summaryBody}>{t('pairedSetupRestoreHelp')}</Text>
          <TouchableOpacity style={[styles.button, (waiting || isBusy || isRecording) && ui.disabled]}
            onPress={() => { if (!waiting && !isBusy && !isRecording) navigation.navigate('Setup'); }}
            disabled={waiting || isBusy || isRecording} accessibilityRole="button">
            <Text style={ui.primaryText}>{t('pairedSetupRestoreAction')}</Text>
          </TouchableOpacity>
        </View> : <OfflineRecoveryCard onOpenSetup={() => {
          if (!waiting && !isBusy && !isRecording) navigation.navigate('Setup');
        }} />}
      </Disclosure>
      <Disclosure title={t('copy015')} detail={autoLabel} expanded={section === 'automatic'} onPress={() => toggle('automatic')}>
        <AutoRecordingCard />
      </Disclosure>
      <Disclosure title={t('cleanSettingsBackups')} detail={t('cleanSettingsBackupsHelp')} expanded={section === 'backups'} onPress={() => toggle('backups')}>
        <Disclosure nested title="Google Drive" expanded={backupSection === 'drive'} onPress={() => toggleBackup('drive')}>
          <DriveBackupCard isRecording={isRecording} recorderBusy={isBusy} />
        </Disclosure>
        <Disclosure nested title="Telegram" expanded={backupSection === 'telegram'} onPress={() => toggleBackup('telegram')}>
          <TelegramBackupCard isRecording={isRecording} recorderBusy={isBusy} />
        </Disclosure>
      </Disclosure>
      <Disclosure title={t('callNameTitle')} detail={t('cleanSettingsNamesHelp')} expanded={section === 'names'} onPress={() => toggle('names')}>
        <CallNameCard isRecording={isRecording} recorderBusy={isBusy} />
      </Disclosure>
      <Disclosure title={t('languageTitle')} detail={t(language === 'he' ? 'languageHebrew' : 'languageEnglish')}
        expanded={section === 'language'} onPress={() => toggle('language')}>
        <View style={styles.languageChoices}>
          {(['he', 'en'] as const).map(next => <TouchableOpacity key={next} style={[styles.languageChoice, language === next && styles.languageSelected, savingLanguage && ui.disabled]} disabled={savingLanguage}
            accessibilityRole="radio" accessibilityState={{ selected: language === next, disabled: savingLanguage }} onPress={() => {
              if (savingLanguage || next === language) return;
              setSavingLanguage(true);
              void selectLanguage(next).finally(() => setSavingLanguage(false));
            }}><Text style={[styles.languageName, language === next && styles.languageSelectedText]}>{t(next === 'he' ? 'languageHebrew' : 'languageEnglish')}</Text></TouchableOpacity>)}
        </View>
        {savingLanguage && <Text style={styles.note}>{t('languageSaving')}</Text>}
        {languageError && <Text style={styles.error} accessibilityLiveRegion="polite">{t(languageError)}</Text>}
      </Disclosure>
    </ScrollView>
    <BottomNav current="Settings" />
  </View>;
}

const baseStyles = StyleSheet.create({
  container: ui.screen, content: { ...ui.content, paddingBottom: 24 },
  title: { ...ui.title, fontSize: 28, lineHeight: 38 },
  subtitle: { ...ui.subtitle, marginTop: 5, marginBottom: 24 },
  summary: { padding: 20, borderRadius: 22, backgroundColor: colors.mintSoft, borderWidth: 1, borderColor: '#D4EBDD', marginBottom: 20 },
  summaryPending: { backgroundColor: colors.surface, borderColor: colors.border },
  summaryTitle: { ...ui.label, fontSize: 19, lineHeight: 29 },
  summaryBody: { ...ui.subtitle, marginTop: 8 },
  summaryNote: { ...ui.subtitle, fontSize: 12, marginTop: 8 },
  spinner: { alignSelf: 'flex-end', marginBottom: 10 },
  button: { ...ui.primaryButton, marginTop: 20 },
  refresh: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  refreshText: { color: colors.green, fontWeight: '600', fontSize: 14, writingDirection: 'rtl', textAlign: 'center' },
  section: { ...ui.card, padding: 0, marginBottom: 10, overflow: 'hidden' },
  nestedSection: { borderWidth: 0, marginBottom: 0, backgroundColor: colors.background },
  row: { minHeight: 72, flexDirection: 'row-reverse', alignItems: 'center', gap: 12, padding: 18 },
  rowCopy: { flex: 1 }, rowTitle: { ...ui.label, fontSize: 15, lineHeight: 24 },
  rowDetail: { ...ui.subtitle, fontSize: 12, marginTop: 3 },
  chevron: { color: colors.muted, fontSize: 25 },
  sectionContent: { paddingHorizontal: 12, paddingBottom: 12 },
  note: { ...ui.subtitle, fontSize: 12, textAlign: 'center', marginTop: 8 },
  error: { ...ui.warning, marginTop: 10 },
  languageChoices: { flexDirection: 'row-reverse', gap: 10, paddingVertical: 6 },
  languageChoice: { flex: 1, minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', padding: 12 },
  languageSelected: { backgroundColor: colors.mintSoft, borderColor: colors.green },
  languageName: { color: colors.muted, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  languageSelectedText: { color: colors.green },
});
