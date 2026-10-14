import { localizedError, t } from '../i18n/core';
import type { TranslationKey } from '../i18n/catalog';
import { NativeModules, Platform } from 'react-native';

export type NativeRecordingStatus = 'captured' | 'silent' | 'interrupted' | 'recovered';
export type CaptureSource = 'microphone' | 'usb' | 'accessibilityMic';
export type RecordingMode = 'system' | 'accessibilityMic';
export type InputRoute = 'builtin_mic' | 'wired' | 'bluetooth' | 'usb' | 'unknown';
export type OutputRoute = 'speaker' | 'headset' | 'earpiece' | 'unknown';
export interface AccessibilityMicStatus {
  supported: boolean;
  enabled: boolean;
  connected: boolean;
  selected: boolean;
  automaticSupported: boolean;
  /** Navigation help availability only; this does not diagnose a blocked permission. */
  appInfoRecoverySupported?: boolean;
  source: 'voice_recognition';
  experimental: true;
  route: OutputRoute;
  routeKnown: boolean;
}
export const EMPTY_ACCESSIBILITY_MIC_STATUS: AccessibilityMicStatus = {
  supported: false, enabled: false, connected: false, selected: false, automaticSupported: false,
  appInfoRecoverySupported: false,
  source: 'voice_recognition', experimental: true, route: 'unknown', routeKnown: false,
};
export interface CallNameStatus { enabled: boolean }
export interface AutoRecordingStatus {
  mode?: RecordingMode;
  modeReady?: boolean;
  enabled: boolean;
  armed: boolean;
  notificationAccessGranted: boolean;
  notificationsEnabled: boolean;
  listenerConnected: boolean;
  helperConnected: boolean;
  state: 'off' | 'needs_access' | 'needs_activation' | 'ready' | 'recording' | 'paused' | 'error';
  error: string | null;
  errorCode?: string | null;
}
export const EMPTY_AUTO_RECORDING_STATUS: AutoRecordingStatus = {
  enabled: false, armed: false, notificationAccessGranted: false, listenerConnected: false,
  notificationsEnabled: false,
  helperConnected: false, state: 'off', error: null,
};

export interface RecorderStatus {
  isRecording: boolean;
  elapsedMs: number;
  /** Normalized combined RMS, from 0 to 1. */
  level: number;
  usbConnected: boolean;
  source: CaptureSource;
  /** Normalized RMS of the USB output and local microphone channels. */
  outputLevel: number;
  microphoneLevel: number;
  isSilenced: boolean;
  /** False/absent means there has been no authoritative Android silencing observation. */
  silencingKnown?: boolean;
  inputRoute?: InputRoute;
  route?: OutputRoute;
  silentForMs: number;
  audioMode: number;
  error: string | null;
  errorCode?: string | null;
}

export interface NativeRecording {
  id: string;
  title: string;
  date: string;
  durationMs: number;
  filePath: string;
  fileSize: number;
  status: NativeRecordingStatus;
  wasSilenced: boolean;
  captureSource?: CaptureSource;
  channels?: number;
  outputSoundMs?: number;
  microphoneSoundMs?: number;
  startedAutomatically?: boolean;
  callDisplayName?: string;
  callPackage?: string;
  exportFileName?: string;
  experimental?: boolean;
  audioSource?: 'voice_recognition';
  remoteAudioVerified?: false;
  silencingKnown?: boolean;
  inputRoute?: InputRoute;
  routeAtStart?: OutputRoute;
  routeAtEnd?: OutputRoute;
  routeChanged?: boolean;
}

export interface RecorderDeviceInfo {
  manufacturer: string;
  model: string;
  androidVersion: string;
  sdk: number;
}

export interface OfflineRecoveryStatus {
  supported: boolean;
  enabled: boolean;
  secureSettingsGranted: boolean;
  nearbyWifiGranted: boolean;
  running: boolean;
  /** Native progress only. A stage is never evidence of helper readiness. */
  stage: string;
  errorCode?: string | null;
}

export interface SystemAccessStatus {
  available: boolean;
  experimental?: boolean;
  paired: boolean;
  wirelessDebuggingEnabled: boolean;
  developerOptionsEnabled?: boolean;
  helperConnected: boolean;
  connecting: boolean;
  error: string | null;
  errorCode?: string | null;
  /** Optional for compatibility with builds that predate this experiment. */
  offlineRecovery?: OfflineRecoveryStatus;
  pairingSetup?: {
    active: boolean;
    discovering: boolean;
    pairing: boolean;
    error: string | null;
    errorCode?: string | null;
    localPortAvailable: boolean;
  };
}

export const EMPTY_SYSTEM_ACCESS_STATUS: SystemAccessStatus = {
  available: false,
  paired: false,
  wirelessDebuggingEnabled: false,
  helperConnected: false,
  connecting: false,
  error: null,
};

interface CallRecorderModule {
  consumeRestartResumeRequest?(): Promise<boolean>;
  resumeAutoRecordingAfterRestart?(): Promise<void>;
  getAccessibilityMicStatus?(): Promise<AccessibilityMicStatus>;
  setRecordingMode?(mode: RecordingMode): Promise<AccessibilityMicStatus>;
  openAccessibilityMicSetup?(): Promise<void>;
  openAccessibilityMicAppInfo?(): Promise<void>;
  getCallNameStatus(): Promise<CallNameStatus>;
  setCallNameEnabled(enabled: boolean): Promise<CallNameStatus>;
  getAutoRecordingStatus(): Promise<AutoRecordingStatus>;
  setAutoRecordingEnabled(enabled: boolean): Promise<void>;
  openNotificationAccessSetup(): Promise<void>;
  getStatus(): Promise<RecorderStatus>;
  startRecording(source: string): Promise<RecorderStatus>;
  stopRecording(): Promise<RecorderStatus>;
  listRecordings(): Promise<NativeRecording[]>;
  deleteRecording(id: string): Promise<void>;
  shareRecording(id: string): Promise<void>;
  openWhatsApp(): Promise<void>;
  getDeviceInfo(): Promise<RecorderDeviceInfo>;
  getSystemAccessStatus(): Promise<SystemAccessStatus>;
  prepareSystemPairing(): Promise<void>;
  pairSystemRecorder(pairingPort: number, pairingCode: string): Promise<void>;
  connectSystemRecorder(connectionPort: number): Promise<void>;
  setOfflineRecoveryEnabled(enabled: boolean): Promise<SystemAccessStatus>;
  connectSystemRecorderOffline(): Promise<void>;
  cancelOfflineRecovery(): Promise<void>;
  openSystemAccessSetup(destination: 'developer' | 'wireless' | 'about' | 'wifi'): Promise<void>;
}

export const EMPTY_RECORDER_STATUS: RecorderStatus = {
  isRecording: false,
  elapsedMs: 0,
  level: 0,
  usbConnected: false,
  source: 'microphone',
  outputLevel: 0,
  microphoneLevel: 0,
  isSilenced: false,
  silentForMs: 0,
  audioMode: 0,
  error: null,
};

const getModule = (): CallRecorderModule => {
  if (Platform.OS !== 'android') {
    throw new Error(t('copy415'));
  }

  const recorder = NativeModules.CallRecorder as CallRecorderModule | undefined;
  if (!recorder) {
    throw new Error(t('copy416'));
  }

  return recorder;
};

// Lifecycle, WAV finalization, and metadata belong to the Android service.
// JavaScript only asks for actions and reads the authoritative native state.
const activationErrorKeys: Record<string, TranslationKey> = {
  ACTIVATION_DISCOVERY_FAILED: 'activationDiscoveryFailed',
  ACTIVATION_ADB_CONNECTION_FAILED: 'activationAdbConnectionFailed',
  ACTIVATION_BOOTSTRAP_FAILED: 'activationBootstrapFailed',
  ACTIVATION_AUTHENTICATION_FAILED: 'activationAuthenticationFailed',
  ACTIVATION_HANDOFF_FAILED: 'activationHandoffFailed',
  ACTIVATION_DETACH_FAILED: 'activationDetachFailed',
  ACTIVATION_LIVENESS_FAILED: 'activationLivenessFailed',
  ACTIVATION_READINESS_OWNER_FAILED: 'activationReadinessOwnerFailed',
};
const errorKeys: Record<string, TranslationKey> = {
  ACCESSIBILITY_UNSUPPORTED: 'accessibilityMicUnsupported',
  ACCESSIBILITY_MIC_UNSUPPORTED: 'accessibilityMicUnsupported',
  ACCESSIBILITY_MIC_REQUIRED: 'accessibilityMicSetupRequired',
  ACCESSIBILITY_SETUP_FAILED: 'accessibilityMicSettingsFailed',
  ACCESSIBILITY_APP_INFO_UNSUPPORTED: 'accessibilityMicAppInfoUnsupported',
  ACCESSIBILITY_APP_INFO_FAILED: 'accessibilityMicAppInfoFailed',
  ACCESSIBILITY_MIC_MODE_REQUIRED: 'accessibilityMicModeRequired',
  CALL_ACTIVE: 'accessibilityMicSwitchBusy',
  INVALID_RECORDING_MODE: 'accessibilityMicSettingsFailed',
  ACCESSIBILITY_SETUP_REQUIRED: 'accessibilityMicSetupRequired',
  ACCESSIBILITY_NOT_CONNECTED: 'accessibilityMicNotConnected',
  ACCESSIBILITY_MIC_PERMISSION: 'copy211',
  ACCESSIBILITY_SETTINGS_FAILED: 'accessibilityMicSettingsFailed',
  RECORDING_MODE_BUSY: 'accessibilityMicSwitchBusy',
  RECORDING_MODE_SAVE_FAILED: 'accessibilityMicSettingsFailed',
  ACCESSIBILITY_AUTO_UNSUPPORTED: 'accessibilityMicAutoUnsupported',
  ...activationErrorKeys,
  RECORDING_BUSY: 'callNameRecordingBusy', SETTINGS_SAVE_FAILED: 'callNameSaveFailed',
  FOREGROUND_REQUIRED: 'copy196', NOTIFICATION_SETUP_FAILED: 'copy337',
  SYSTEM_CONNECTION_FAILED: 'copy206', SETUP_FAILED: 'copy337', LOAD_FAILED: 'copy285',
  DELETE_FAILED: 'copy289', SHARE_FAILED: 'copy260', WHATSAPP_UNAVAILABLE: 'whatsappUnavailable',
  AUTO_SETUP_REQUIRED: 'copy418', AUTO_ACTIVATION_CANCELLED: 'activationCancelled', AUTO_ACTIVATION_FAILED: 'copy206',
  RESTART_RESUME_UNAVAILABLE: 'activationCancelled', RESTART_RESUME_REVOKED: 'activationCancelled',
  PAIRING_FAILED: 'copy148', PAIRING_SETUP: 'copy148', PAIRING_BUSY: 'pairingBusy', NOTIFICATION_PERMISSION: 'copy202',
  UNSUPPORTED_ANDROID: 'copy203', INVALID_ACTIVATION: 'copy337', OWNER_STOPPING: 'recorderShuttingDown',
  ACTIVATION_SETUP_REQUIRED: 'copy205', ACTIVATION_BUSY: 'copy201', ACTIVATION_FAILED: 'copy206', READINESS_OWNER_FAILED: 'copy206',
  ALREADY_RECORDING: 'alreadyRecording', INVALID_SOURCE: 'invalidSource', RECORDER_SHUTTING_DOWN: 'recorderShuttingDown',
  USB_DISCONNECTED: 'copy204', MIC_PERMISSION: 'copy211', START_FAILED: 'copy222', STOP_FAILED: 'stopFailed',
  START_CANCELLED: 'activationCancelled', RECORDING_FAILED: 'copy226',
  OFFLINE_UNSUPPORTED: 'offlineRecoveryUnsupported',
  OFFLINE_DISABLED: 'offlineRecoveryDisabled',
  OFFLINE_SETUP_REQUIRED: 'offlineRecoverySetupRequired',
  OFFLINE_PERMISSION_REQUIRED: 'offlineRecoveryGrantRequired',
  OFFLINE_GRANT_FAILED: 'offlineRecoveryGrantFailed',
  OFFLINE_NEARBY_PERMISSION_REQUIRED: 'offlineRecoveryNearbyRequired',
  OFFLINE_PAIRING_REQUIRED: 'offlineRecoverySetupRequired',
  OFFLINE_ADMIN_RESTRICTED: 'offlineRecoveryAdminRestricted',
  OFFLINE_HOTSPOT_FAILED: 'offlineRecoveryHotspotFailed',
  OFFLINE_TIMEOUT: 'offlineRecoveryTimeout',
  OFFLINE_CANCELED: 'offlineRecoveryCancelled',
  OFFLINE_ACTIVATION_BUSY: 'offlineRecoveryBusy',
  RECORDER_PREPARING: 'offlineRecoveryBusy',
  OFFLINE_RECORDING_BUSY: 'offlineRecoveryRecordingBusy',
  OFFLINE_FOREGROUND_REQUIRED: 'copy196',
  OFFLINE_ADB_FAILED: 'offlineRecoveryAdbFailed',
  OFFLINE_SHELL_IDENTITY_FAILED: 'offlineRecoveryAdbFailed',
  OFFLINE_BOOTSTRAP_FAILED: 'offlineRecoveryFailed',
  OFFLINE_AUTHENTICATION_FAILED: 'offlineRecoveryFailed',
  OFFLINE_HANDOFF_FAILED: 'offlineRecoveryFailed',
  OFFLINE_HEARTBEAT_FAILED: 'offlineRecoveryLivenessFailed',
  OFFLINE_OWNER_FAILED: 'activationReadinessOwnerFailed',
  OFFLINE_RESTORE_FAILED: 'offlineRecoveryCleanupFailed',
  OFFLINE_SETTINGS_SAVE_FAILED: 'offlineRecoverySettingsFailed',
  OFFLINE_WIFI_DISABLED: 'offlineRecoveryWifiDisabled',
};
export const recorderErrorMessage = (code: unknown, message?: unknown): string =>
  typeof code === 'string' && Object.prototype.hasOwnProperty.call(errorKeys, code) ? t(errorKeys[code]) : localizedError(message);
const activationDetailCode = (failure: unknown): string | null => {
  if (!failure || typeof failure !== 'object' || !('code' in failure) ||
    typeof failure.code !== 'string' || !['ACTIVATION_FAILED', 'READINESS_OWNER_FAILED'].includes(failure.code) ||
    !Object.prototype.hasOwnProperty.call(failure, 'userInfo') || !('userInfo' in failure)) return null;
  const details = failure.userInfo;
  if (!details || typeof details !== 'object' || Array.isArray(details) ||
    !Object.prototype.hasOwnProperty.call(details, 'errorCode') || !('errorCode' in details)) return null;
  const code = details.errorCode;
  if (typeof code !== 'string' || !Object.prototype.hasOwnProperty.call(activationErrorKeys, code)) return null;
  const readiness = code === 'ACTIVATION_READINESS_OWNER_FAILED';
  return readiness === (failure.code === 'READINESS_OWNER_FAILED') ? code : null;
};
async function call<T>(action: (module: CallRecorderModule) => Promise<T>): Promise<T> {
  try { return await action(getModule()); }
  catch (failure) {
    const code = failure && typeof failure === 'object' && 'code' in failure ? failure.code : null;
    const detailCode = activationDetailCode(failure);
    const error = new Error(recorderErrorMessage(detailCode ?? code, failure));
    throw Object.assign(error, { code: typeof code === 'string' && Object.prototype.hasOwnProperty.call(errorKeys, code) ? code : 'RECORDER_ACTION_FAILED',
      ...(detailCode ? { errorCode: detailCode } : {}) });
  }
}
const localizeStatus = <T extends { error: string | null; errorCode?: string | null }>(status: T): T =>
  ({ ...status, error: status.error ? recorderErrorMessage(status.errorCode, status.error) : null });
export const NativeRecorder = {
  // A false/missing bridge never authorizes restoration. Only native validates
  // the one-use private notification handoff; launcher/deep-link data is ignored.
  consumeRestartResumeRequest: async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return false;
    const module = NativeModules.CallRecorder as CallRecorderModule | undefined;
    if (!module?.consumeRestartResumeRequest || !module.resumeAutoRecordingAfterRestart) return false;
    return (await module.consumeRestartResumeRequest()) === true;
  },
  resumeAutoRecordingAfterRestart: async (): Promise<void> => call(module => {
    if (!module.resumeAutoRecordingAfterRestart) throw new Error(t('copy418'));
    return module.resumeAutoRecordingAfterRestart();
  }),
  getAccessibilityMicStatus: async (): Promise<AccessibilityMicStatus> => {
    const value = await call(module => module.getAccessibilityMicStatus?.() ?? Promise.resolve(EMPTY_ACCESSIBILITY_MIC_STATUS));
    if (!value || !['supported', 'enabled', 'connected', 'selected', 'automaticSupported', 'routeKnown'].every(key =>
      typeof value[key as keyof AccessibilityMicStatus] === 'boolean') || value.source !== 'voice_recognition' ||
      value.experimental !== true || !['speaker', 'headset', 'earpiece', 'unknown'].includes(value.route) ||
      value.appInfoRecoverySupported !== undefined && typeof value.appInfoRecoverySupported !== 'boolean')
      throw new Error(t('accessibilityMicReadFailed'));
    return { ...value, appInfoRecoverySupported: value.appInfoRecoverySupported === true };
  },
  setRecordingMode: async (mode: RecordingMode): Promise<void> => { await call(module => {
    if (!module.setRecordingMode) throw new Error(t('accessibilityMicUnsupported'));
    return module.setRecordingMode(mode);
  }); },
  openAccessibilityMicSetup: async (): Promise<void> => call(module => {
    if (!module.openAccessibilityMicSetup) throw new Error(t('accessibilityMicUnsupported'));
    return module.openAccessibilityMicSetup();
  }),
  openAccessibilityMicAppInfo: async (): Promise<void> => call(module => {
    if (!module.openAccessibilityMicAppInfo) throw new Error(t('accessibilityMicAppInfoUnsupported'));
    return module.openAccessibilityMicAppInfo();
  }),
  getCallNameStatus: async (): Promise<CallNameStatus> => {
    const value = await call(module => module.getCallNameStatus());
    if (!value || typeof value.enabled !== 'boolean') throw new Error(t('callNameReadFailed'));
    return { enabled: value.enabled };
  },
  setCallNameEnabled: async (enabled: boolean): Promise<CallNameStatus> => {
    const value = await call(module => module.setCallNameEnabled(enabled));
    if (!value || typeof value.enabled !== 'boolean' || value.enabled !== enabled) throw new Error(t('callNameSaveFailed'));
    return { enabled: value.enabled };
  },
  getAutoRecordingStatus: async (): Promise<AutoRecordingStatus> => {
    const value = await call(module => module.getAutoRecordingStatus());
    if (value.mode !== undefined && !['system', 'accessibilityMic'].includes(value.mode))
      throw new Error(t('accessibilityMicReadFailed'));
    return localizeStatus(value);
  },
  setAutoRecordingEnabled: async (enabled: boolean): Promise<void> => call(module => module.setAutoRecordingEnabled(enabled)),
  openNotificationAccessSetup: async (): Promise<void> => call(module => module.openNotificationAccessSetup()),
  getStatus: async (): Promise<RecorderStatus> => localizeStatus(await call(module => module.getStatus())),
  startRecording: async (source: CaptureSource = 'microphone'): Promise<RecorderStatus> => localizeStatus(await call(module => module.startRecording(source))),
  stopRecording: async (): Promise<RecorderStatus> => localizeStatus(await call(module => module.stopRecording())),
  listRecordings: async (): Promise<NativeRecording[]> => call(module => module.listRecordings()),
  deleteRecording: async (id: string): Promise<void> => call(module => module.deleteRecording(id)),
  shareRecording: async (id: string): Promise<void> => call(module => module.shareRecording(id)),
  openWhatsApp: async (): Promise<void> => call(module => module.openWhatsApp()),
  getDeviceInfo: async (): Promise<RecorderDeviceInfo> => call(module => module.getDeviceInfo()),
  getSystemAccessStatus: async (): Promise<SystemAccessStatus> => {
    const status = localizeStatus(await call(module => module.getSystemAccessStatus()));
    return { ...status, ...(status.pairingSetup ? { pairingSetup: localizeStatus(status.pairingSetup) } : {}) };
  },
  prepareSystemPairing: async (): Promise<void> => call(module => module.prepareSystemPairing()),
  pairSystemRecorder: async (pairingPort: number, pairingCode: string): Promise<void> => call(module => module.pairSystemRecorder(pairingPort, pairingCode)),
  connectSystemRecorder: async (connectionPort = 0): Promise<void> => call(module => module.connectSystemRecorder(connectionPort)),
  setOfflineRecoveryEnabled: async (enabled: boolean): Promise<SystemAccessStatus> => {
    const status = localizeStatus(await call(module => module.setOfflineRecoveryEnabled(enabled)));
    if (!status.offlineRecovery || status.offlineRecovery.enabled !== enabled) throw new Error(t('offlineRecoverySettingsFailed'));
    return status;
  },
  connectSystemRecorderOffline: async (): Promise<void> => call(module => module.connectSystemRecorderOffline()),
  cancelOfflineRecovery: async (): Promise<void> => call(module => module.cancelOfflineRecovery()),
  openSystemAccessSetup: async (destination: 'developer' | 'wireless' | 'about' | 'wifi' = 'wireless'): Promise<void> => call(module => module.openSystemAccessSetup(destination)),
};
