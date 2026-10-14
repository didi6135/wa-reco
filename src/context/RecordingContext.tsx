import { formatDuration, localizedError, t } from '../i18n/core';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  EMPTY_RECORDER_STATUS,
  EMPTY_SYSTEM_ACCESS_STATUS,
  EMPTY_AUTO_RECORDING_STATUS,
  AutoRecordingStatus,
  AccessibilityMicStatus,
  RecordingMode,
  CaptureSource,
  NativeRecorder,
  NativeRecording,
  NativeRecordingStatus,
  RecorderDeviceInfo,
  RecorderStatus,
  SystemAccessStatus,
} from '../services/NativeRecorder';
import {
  checkPermissions,
  requestPermissions as requestMicrophonePermissions,
  requestNotificationPermission,
} from '../utils/permissions';

export interface Recording {
  id: string;
  title: string;
  date: string;
  duration: string;
  durationMs?: number;
  filePath: string;
  fileSize: number;
  status: NativeRecordingStatus | 'legacy';
  wasSilenced: boolean;
  source: 'native' | 'legacy';
  captureSource?: CaptureSource;
  channels?: number;
  outputSoundMs?: number;
  microphoneSoundMs?: number;
  startedAutomatically?: boolean;
  callDisplayName?: string;
  callPackage?: string;
  exportFileName?: string;
}

export interface RecordingContextType {
  accessibilityMicStatus: AccessibilityMicStatus | null;
  refreshAccessibilityMicStatus: () => Promise<void>;
  setRecordingMode: (mode: RecordingMode) => Promise<void>;
  openAccessibilityMicSetup: () => Promise<void>;
  openAccessibilityMicAppInfo: () => Promise<void>;
  autoRecordingStatus: AutoRecordingStatus;
  refreshAutoRecordingStatus: () => Promise<void>;
  enableAutoRecording: () => Promise<void>;
  resumeAutoRecordingAfterRestart: () => Promise<void>;
  disableAutoRecording: () => Promise<void>;
  openNotificationAccessSetup: () => Promise<void>;
  recordings: Recording[];
  isRecording: boolean;
  recordingTime: string;
  status: RecorderStatus;
  deviceInfo: RecorderDeviceInfo | null;
  systemAccessStatus: SystemAccessStatus;
  refreshSystemAccessStatus: () => Promise<void>;
  prepareSystemPairing: () => Promise<void>;
  pairSystemRecorder: (pairingPort: number, pairingCode: string) => Promise<void>;
  connectSystemRecorder: (connectionPort?: number) => Promise<void>;
  setOfflineRecoveryEnabled: (enabled: boolean) => Promise<void>;
  requestOfflineRecoveryPermission: () => Promise<void>;
  connectSystemRecorderOffline: () => Promise<void>;
  cancelOfflineRecovery: () => Promise<void>;
  openSystemAccessSetup: (destination?: 'developer' | 'wireless' | 'about' | 'wifi') => Promise<void>;
  isBusy: boolean;
  error: string | null;
  startRecording: (captureSource?: CaptureSource) => Promise<void>;
  stopRecording: () => Promise<Recording | null>;
  deleteRecording: (id: string) => Promise<void>;
  shareRecording: (id: string) => Promise<void>;
  openWhatsApp: () => Promise<void>;
  loadRecordings: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  hasPermissions: boolean;
  requestPermissions: () => Promise<boolean>;
  clearAllRecordings: () => Promise<void>;
}

const RecordingContext = createContext<RecordingContextType | undefined>(undefined);

const foregroundRequired = () => new Error(t('copy196'));

// Android may resolve a permission request before its Activity resumes. Wait
// only briefly for that return; ordinary background starts remain prohibited.
const waitForActiveForeground = async (afterPermissionDialog = false): Promise<void> => {
  const initialState = AppState.currentState;
  if (initialState === 'active') return;
  if (initialState === 'background' && !afterPermissionDialog) throw foregroundRequired();

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let subscription: ReturnType<typeof AppState.addEventListener> | undefined;
    const finish = (failure?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      subscription?.remove();
      if (failure) reject(failure);
      else resolve();
    };
    const timeout = setTimeout(() => finish(foregroundRequired()), 2000);
    const inspectState = (state: typeof AppState.currentState) => {
      if (state === 'active') finish();
      else if (state === 'background' && !afterPermissionDialog) finish(foregroundRequired());
    };
    subscription = AppState.addEventListener('change', inspectState);
    // Close the gap between the initial read and event registration.
    inspectState(AppState.currentState);
  });
};

export const formatRecordingDuration = formatDuration;

const nativeRecording = (recording: NativeRecording): Recording => ({
  ...recording,
  duration: formatRecordingDuration(recording.durationMs),
  source: 'native',
  captureSource: recording.captureSource || 'microphone',
  channels: recording.channels ?? 1,
});

const readLegacyRecordings = async (): Promise<Recording[]> => {
  const saved = await AsyncStorage.getItem('recordings');
  if (!saved) return [];

  const parsed: unknown = JSON.parse(saved);
  if (!Array.isArray(parsed)) throw new Error(t('copy197'));

  return parsed.flatMap((entry: unknown, index: number): Recording[] => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.filePath !== 'string' || !item.filePath) return [];

    return [{
      // A distinct namespace prevents old timestamp IDs from shadowing native IDs.
      id: `legacy:${index}:${item.id}`,
      title: typeof item.title === 'string' ? item.title : t('copy198'),
      date: typeof item.date === 'string' ? item.date : '',
      duration: typeof item.duration === 'string' ? item.duration : '00:00:00',
      durationMs: typeof item.durationMs === 'number' ? item.durationMs : undefined,
      filePath: item.filePath,
      fileSize: typeof item.fileSize === 'number' ? item.fileSize : 0,
      status: 'legacy',
      wasSilenced: false,
      source: 'legacy',
    }];
  });
};

const messageFor = (failure: unknown): string => localizedError(failure);

const dateValue = (recording: Recording): number => {
  const value = Date.parse(recording.date);
  return Number.isFinite(value) ? value : 0;
};

export const RecordingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [status, setStatus] = useState<RecorderStatus>(EMPTY_RECORDER_STATUS);
  const [deviceInfo, setDeviceInfo] = useState<RecorderDeviceInfo | null>(null);
  const [systemAccessStatus, setSystemAccessStatus] = useState<SystemAccessStatus>(EMPTY_SYSTEM_ACCESS_STATUS);
  const [autoRecordingStatus, setAutoRecordingStatus] = useState<AutoRecordingStatus>(EMPTY_AUTO_RECORDING_STATUS);
  const [accessibilityMicStatus, setAccessibilityMicStatus] = useState<AccessibilityMicStatus | null>(null);
  const [hasPermissions, setHasPermissions] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const mounted = useRef(true);
  const statusRef = useRef<RecorderStatus>(EMPTY_RECORDER_STATUS);
  const recordingsRef = useRef<Recording[]>([]);
  const busyRef = useRef(false);
  const pollingRef = useRef(false);
  const systemPollingRef = useRef(false);
  const offlineActionRef = useRef(false);
  const offlineCancellationRef = useRef(0);
  const systemAccessRequestRef = useRef(0);
  const accessibilityRequestRef = useRef(0);
  const autoRequestRef = useRef(0);
  const actionRevisionRef = useRef(0);
  const recordingsRequestRef = useRef(0);

  const applyStatus = useCallback((next: RecorderStatus) => {
    statusRef.current = next;
    if (mounted.current) setStatus(next);
  }, []);

  const applyRecordings = useCallback(async (native?: NativeRecording[]): Promise<Recording[]> => {
    const requestId = ++recordingsRequestRef.current;
    const [nativeResult, legacyResult] = await Promise.allSettled([
      native ? Promise.resolve(native) : NativeRecorder.listRecordings(),
      readLegacyRecordings(),
    ]);

    const legacy = legacyResult.status === 'fulfilled' ? legacyResult.value : [];
    if (legacyResult.status === 'rejected' && mounted.current) {
      setActionError(t('legacyReadFailed'));
    }

    const currentNative = nativeResult.status === 'fulfilled'
      ? nativeResult.value.map(nativeRecording)
      : recordingsRef.current.filter(recording => recording.source === 'native');
    const merged = [...currentNative, ...legacy]
      .sort((first, second) => dateValue(second) - dateValue(first));
    if (requestId === recordingsRequestRef.current) {
      recordingsRef.current = merged;
      if (mounted.current) setRecordings(merged);
    }
    if (nativeResult.status === 'rejected') throw nativeResult.reason;
    return merged;
  }, []);

  const loadRecordings = useCallback(async (): Promise<void> => {
    try {
      await applyRecordings();
    } catch (failure) {
      if (mounted.current) setActionError(messageFor(failure));
      throw failure;
    }
  }, [applyRecordings]);

  const refreshStatus = useCallback(async (): Promise<void> => {
    if (pollingRef.current || busyRef.current) return;
    pollingRef.current = true;
    const revision = actionRevisionRef.current;
    try {
      const wasRecording = statusRef.current.isRecording;
      const next = await NativeRecorder.getStatus();
      if (busyRef.current || revision !== actionRevisionRef.current) return;
      applyStatus(next);
      if (wasRecording && !next.isRecording) await applyRecordings();
    } catch (failure) {
      if (mounted.current) setActionError(messageFor(failure));
    } finally {
      pollingRef.current = false;
    }
  }, [applyRecordings, applyStatus]);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    try {
      const granted = await requestMicrophonePermissions();
      if (mounted.current) setHasPermissions(granted);
      if (granted) await waitForActiveForeground(true);
      return granted;
    } catch (failure) {
      if (mounted.current) setActionError(messageFor(failure));
      return false;
    }
  }, []);

  const runAction = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    if (busyRef.current) throw new Error(t('copy201'));
    busyRef.current = true;
    actionRevisionRef.current += 1;
    if (mounted.current) {
      setIsBusy(true);
      setActionError(null);
    }
    try {
      return await action();
    } catch (failure) {
      if (mounted.current) setActionError(messageFor(failure));
      throw failure;
    } finally {
      busyRef.current = false;
      if (mounted.current) setIsBusy(false);
    }
  }, []);

  const readSystemAccess = useCallback(async (): Promise<SystemAccessStatus> => {
    const request = ++systemAccessRequestRef.current;
    const next = await NativeRecorder.getSystemAccessStatus();
    if (mounted.current && request === systemAccessRequestRef.current) setSystemAccessStatus(next);
    return next;
  }, []);

  const refreshSystemAccessStatus = useCallback(async (): Promise<void> => {
    // Recovery stays visible and cancellable while its action owns busyRef.
    if (systemPollingRef.current || (busyRef.current && !offlineActionRef.current)) return;
    systemPollingRef.current = true;
    try {
      await readSystemAccess();
    } catch (failure) {
      if (mounted.current) setActionError(messageFor(failure));
    } finally {
      systemPollingRef.current = false;
    }
  }, [readSystemAccess]);

  const prepareSystemPairing = useCallback(() => runAction(async (): Promise<void> => {
    await waitForActiveForeground();
    const granted = await requestNotificationPermission();
    await waitForActiveForeground(true);
    if (!granted) throw new Error(t('copy202'));
    await NativeRecorder.prepareSystemPairing();
  }), [runAction]);

  const pairSystemRecorder = useCallback((pairingPort: number, pairingCode: string) => runAction(async (): Promise<void> => {
    await waitForActiveForeground();
    await NativeRecorder.pairSystemRecorder(pairingPort, pairingCode);
    await readSystemAccess();
  }), [readSystemAccess, runAction]);

  // Shared by explicit activation, Auto and manual call recording only. Boot never enters here.
  const activateSystemRecorderOffline = useCallback(async () => {
    const cancellation = offlineCancellationRef.current;
    const requireNotCancelled = () => {
      if (cancellation !== offlineCancellationRef.current) throw new Error(t('offlineRecoveryCancelled'));
    };
    await waitForActiveForeground();
    const current = await NativeRecorder.getStatus();
    applyStatus(current);
    if (current.isRecording) throw new Error(t('offlineRecoveryRecordingBusy'));
    if (current.audioMode !== 0) throw new Error(t('offlineRecoveryCallBusy'));
    const access = await readSystemAccess();
    const offline = access.offlineRecovery;
    if (!offline?.supported) throw new Error(t('offlineRecoveryUnsupported'));
    if (!offline.enabled) throw new Error(t('offlineRecoveryDisabled'));
    if (!access.paired) throw new Error(t('offlineRecoverySetupRequired'));
    if (!offline.secureSettingsGranted) throw new Error(t('offlineRecoveryGrantRequired'));
    if (!offline.nearbyWifiGranted) throw new Error(t('offlineRecoveryNearbyRequired'));
    requireNotCancelled();
    offlineActionRef.current = true;
    try {
      await NativeRecorder.connectSystemRecorderOffline();
      requireNotCancelled();
      const ready = await readSystemAccess();
      const next = await NativeRecorder.getStatus();
      applyStatus(next);
      requireNotCancelled();
      // Native verifies post-cleanup authenticated heartbeat. No stage/mDNS inference.
      if (!ready.helperConnected || !next.usbConnected) throw new Error(t('offlineRecoveryLivenessFailed'));
    } finally {
      offlineActionRef.current = false;
      await readSystemAccess().catch(() => undefined);
    }
    requireNotCancelled();
  }, [applyStatus, readSystemAccess]);

  // Called only by an explicit connection/record action, never by polling.
  const ensureSystemRecorder = useCallback(async (connectionPort = 0): Promise<void> => {
    await waitForActiveForeground();
    const access = await readSystemAccess();
    if (!access.available) throw new Error(t('copy203'));
    if (access.offlineRecovery?.running) throw new Error(t('offlineRecoveryBusy'));
    // An authenticated live helper needs neither Wi-Fi nor a new ADB session.
    if (!access.helperConnected) {
      if (!access.paired) throw new Error(t('copy204'));
      const offline = access.offlineRecovery;
      // Honor the user's prepared recovery preference, just as the setup wizard does.
      // A manual port explicitly chooses ordinary activation; no automatic fallback/retry.
      if (connectionPort === 0 && offline?.supported && offline.enabled &&
        offline.secureSettingsGranted && offline.nearbyWifiGranted) {
        await activateSystemRecorderOffline();
      } else {
        if (!access.wirelessDebuggingEnabled) throw new Error(t('copy205'));
        await NativeRecorder.connectSystemRecorder(connectionPort);
      }
    }
    const ready = await readSystemAccess();
    const next = await NativeRecorder.getStatus();
    applyStatus(next);
    if (!ready.helperConnected || !next.usbConnected) throw new Error(t('copy206'));
  }, [activateSystemRecorderOffline, applyStatus, readSystemAccess]);

  const connectSystemRecorder = useCallback((connectionPort = 0) => runAction(() => ensureSystemRecorder(connectionPort)), [ensureSystemRecorder, runAction]);
  const setOfflineRecoveryEnabled = useCallback((enabled: boolean) => runAction(async () => {
    await waitForActiveForeground();
    if (statusRef.current.isRecording) throw new Error(t('offlineRecoveryRecordingBusy'));
    offlineActionRef.current = true;
    try {
      const next = await NativeRecorder.setOfflineRecoveryEnabled(enabled);
      if (mounted.current) setSystemAccessStatus(next);
    } finally {
      offlineActionRef.current = false;
      await readSystemAccess().catch(() => undefined);
    }
  }), [readSystemAccess, runAction]);

  // The card explains this request before calling it. Never ask on load/polling.
  const requestOfflineRecoveryPermission = useCallback(() => runAction(async () => {
    await waitForActiveForeground();
    if (Platform.OS !== 'android' || Number(Platform.Version) < 33) throw new Error(t('offlineRecoveryUnsupported'));
    const permission = PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES;
    const alreadyGranted = await PermissionsAndroid.check(permission);
    const result = alreadyGranted ? PermissionsAndroid.RESULTS.GRANTED : await PermissionsAndroid.request(permission);
    await waitForActiveForeground(!alreadyGranted);
    const access = await readSystemAccess();
    if (result !== PermissionsAndroid.RESULTS.GRANTED || access.offlineRecovery?.nearbyWifiGranted !== true)
      throw new Error(t('offlineRecoveryNearbyRequired'));
  }), [readSystemAccess, runAction]);

  const connectSystemRecorderOffline = useCallback(() => runAction(activateSystemRecorderOffline),
    [activateSystemRecorderOffline, runAction]);

  // Cancellation must bypass runAction: the running attempt already owns it.
  const cancelOfflineRecovery = useCallback(async (): Promise<void> => {
    // Cancel also revokes an explicit action's follow-up capture/Auto continuation.
    offlineCancellationRef.current += 1;
    try {
      await NativeRecorder.cancelOfflineRecovery();
      await readSystemAccess();
    } catch (failure) {
      if (mounted.current) setActionError(messageFor(failure));
      throw failure;
    }
  }, [readSystemAccess]);
  const openSystemAccessSetup = useCallback((destination: 'developer' | 'wireless' | 'about' | 'wifi' = 'wireless') => runAction(() => NativeRecorder.openSystemAccessSetup(destination)), [runAction]);
  const refreshAutoRecordingStatus = useCallback(async () => {
    const request = ++autoRequestRef.current;
    const next = await NativeRecorder.getAutoRecordingStatus();
    if (mounted.current && request === autoRequestRef.current) setAutoRecordingStatus(next);
  }, []);
  const refreshAccessibilityMicStatus = useCallback(async () => {
    const request = ++accessibilityRequestRef.current;
    try {
      const next = await NativeRecorder.getAccessibilityMicStatus();
      if (mounted.current && request === accessibilityRequestRef.current) setAccessibilityMicStatus(next);
    } catch (failure) {
      if (mounted.current && request === accessibilityRequestRef.current) setAccessibilityMicStatus(null);
      throw failure;
    }
  }, []);
  const setRecordingMode = useCallback((mode: RecordingMode) => runAction(async () => {
    if (mode !== 'system') throw new Error(t('pairedSetupRestoreHelp'));
    await waitForActiveForeground();
    const current = await NativeRecorder.getStatus();
    applyStatus(current);
    if (current.isRecording || current.audioMode !== 0) throw new Error(t('accessibilityMicSwitchBusy'));
    autoRequestRef.current += 1;
    accessibilityRequestRef.current += 1;
    await NativeRecorder.setRecordingMode(mode);
    await Promise.all([refreshAccessibilityMicStatus(), refreshAutoRecordingStatus()]);
    // Native persists an explicit choice and disarms Auto. Never arm or capture here.
  }), [applyStatus, refreshAccessibilityMicStatus, refreshAutoRecordingStatus, runAction]);
  const openAccessibilityMicSetup = useCallback(() => runAction(async () => {
    await waitForActiveForeground();
    const current = await NativeRecorder.getStatus();
    applyStatus(current);
    if (current.isRecording || current.audioMode !== 0) throw new Error(t('accessibilityMicSwitchBusy'));
    await NativeRecorder.openAccessibilityMicSetup();
  }), [applyStatus, runAction]);
  const openAccessibilityMicAppInfo = useCallback(() => runAction(async () => {
    await waitForActiveForeground();
    const current = await NativeRecorder.getStatus();
    applyStatus(current);
    if (current.isRecording || current.audioMode !== 0) throw new Error(t('accessibilityMicSwitchBusy'));
    // User-reported recovery opens only this installation's Android App info.
    // A disabled service never proves a restriction, and approval remains in Android.
    await NativeRecorder.openAccessibilityMicAppInfo();
  }), [applyStatus, runAction]);
  const enableAutoRecording = useCallback(() => runAction(async () => {
    const cancellation = offlineCancellationRef.current;
    await waitForActiveForeground();
    const access = await NativeRecorder.getAutoRecordingStatus();
    if (access.mode !== 'system') throw new Error(t('pairedSetupRestoreHelp'));
    if (!access.notificationAccessGranted) throw new Error(t('copy207'));
    if (!(await requestPermissions())) throw new Error(t('copy208'));
    const notifications = await requestNotificationPermission();
    await waitForActiveForeground(true);
    if (!notifications) throw new Error(t('copy209'));
    await ensureSystemRecorder();
    if (cancellation !== offlineCancellationRef.current) throw new Error(t('offlineRecoveryCancelled'));
    await NativeRecorder.setAutoRecordingEnabled(true);
    await refreshAutoRecordingStatus();
  }), [ensureSystemRecorder, refreshAutoRecordingStatus, requestPermissions, runAction]);
  // Called only after consuming a genuine reminder tap. This restores existing
  // consent; it never asks for permissions or enables a disabled preference.
  const resumeAutoRecordingAfterRestart = useCallback(() => runAction(async () => {
    const cancellation = offlineCancellationRef.current;
    let foregroundLost = false;
    const change = AppState.addEventListener('change', state => {
      if (state !== 'active') foregroundLost = true;
    });
    const blur = AppState.addEventListener('blur', () => { foregroundLost = true; });
    const requireCurrentForeground = () => {
      if (!mounted.current || foregroundLost || AppState.currentState !== 'active') throw foregroundRequired();
      if (cancellation !== offlineCancellationRef.current) throw new Error(t('offlineRecoveryCancelled'));
    };
    const verifyResumeState = async (): Promise<boolean> => {
      requireCurrentForeground();
      const automatic = await NativeRecorder.getAutoRecordingStatus();
      if (automatic.mode !== 'system') throw new Error(t('pairedSetupRestoreHelp'));
      if (!automatic.enabled) return false;
      if (automatic.armed) return false;
      if (!automatic.notificationAccessGranted) throw new Error(t('copy207'));
      if (!automatic.notificationsEnabled) throw new Error(t('copy209'));
      const current = await NativeRecorder.getStatus();
      applyStatus(current);
      if (current.isRecording) throw new Error(t('offlineRecoveryRecordingBusy'));
      if (current.audioMode !== 0) throw new Error(t('offlineRecoveryCallBusy'));
      const microphone = await checkPermissions();
      if (mounted.current) setHasPermissions(microphone);
      if (!microphone) throw new Error(t('copy208'));
      if (Platform.OS !== 'android' || Number(Platform.Version) >= 33 &&
        !(await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)))
        throw new Error(t('copy209'));
      requireCurrentForeground();
      return true;
    };
    try {
      if (!(await verifyResumeState())) return;
      const access = await readSystemAccess();
      requireCurrentForeground();
      if (!access.helperConnected) {
        const offline = access.offlineRecovery;
        const preparedOffline = offline?.supported && offline.enabled &&
          offline.secureSettingsGranted && offline.nearbyWifiGranted;
        // Reuse either already-authorized activation path. Offline preparation
        // is unnecessary when ordinary wireless debugging is already available.
        if (!access.paired || (!preparedOffline && !access.wirelessDebuggingEnabled))
          throw new Error(t('offlineRecoverySetupRequired'));
      }
      await ensureSystemRecorder();
      requireCurrentForeground();
      if (!(await verifyResumeState())) return;
      requireCurrentForeground();
      // Native atomically revalidates consumed-tap authority and persisted Auto,
      // so an intervening disable/background cannot be resurrected by JS.
      await NativeRecorder.resumeAutoRecordingAfterRestart();
      await refreshAutoRecordingStatus();
    } finally {
      change.remove(); blur.remove();
    }
  }), [applyStatus, ensureSystemRecorder, readSystemAccess, refreshAutoRecordingStatus, runAction]);
  const disableAutoRecording = useCallback(() => runAction(async () => {
    await NativeRecorder.setAutoRecordingEnabled(false);
    await refreshAutoRecordingStatus();
    await refreshStatus();
  }), [refreshAutoRecordingStatus, refreshStatus, runAction]);
  const openNotificationAccessSetup = useCallback(() => runAction(async () => {
    await waitForActiveForeground();
    await NativeRecorder.openNotificationAccessSetup();
  }), [runAction]);

  const startRecording = useCallback((captureSource: CaptureSource = 'microphone') => runAction(async () => {
    const cancellation = offlineCancellationRef.current;
    if (captureSource === 'accessibilityMic') throw new Error(t('pairedSetupRestoreHelp'));
    if (Platform.OS !== 'android') {
      throw new Error(t('copy210'));
    }
    await waitForActiveForeground();
    if (captureSource !== 'microphone') {
      // A pre-switch Home/poll response must never activate the other route.
      const selected = await NativeRecorder.getAutoRecordingStatus();
      if (selected.mode !== 'system' || captureSource !== 'usb') {
        await Promise.all([refreshAutoRecordingStatus(), refreshAccessibilityMicStatus()]);
        throw new Error(t('pairedSetupRestoreHelp'));
      }
    }
    const access = await readSystemAccess();
    if (access.offlineRecovery?.running) throw new Error(t('offlineRecoveryBusy'));
    const current = await NativeRecorder.getStatus();
    applyStatus(current);
    if (current.isRecording) return;
    if (captureSource === 'usb' && !current.usbConnected) {
      await ensureSystemRecorder();
    }

    const alreadyGranted = await checkPermissions();
    const granted = alreadyGranted || await requestMicrophonePermissions();
    if (mounted.current) setHasPermissions(granted);
    if (!granted) throw new Error(t('copy211'));

    await waitForActiveForeground(!alreadyGranted);
    if (AppState.currentState !== 'active') throw foregroundRequired();
    if (cancellation !== offlineCancellationRef.current) throw new Error(t('offlineRecoveryCancelled'));
    applyStatus(await NativeRecorder.startRecording(captureSource));
  }), [applyStatus, ensureSystemRecorder, readSystemAccess, refreshAutoRecordingStatus, refreshAccessibilityMicStatus, runAction]);

  const stopRecording = useCallback(() => runAction(async (): Promise<Recording | null> => {
    const current = await NativeRecorder.getStatus();
    applyStatus(current);
    if (!current.isRecording) {
      await applyRecordings();
      return null;
    }

    const before = await NativeRecorder.listRecordings();
    const previousIds = new Set(before.map(recording => recording.id));
    // The promise resolves only after WAV and metadata have been saved natively.
    applyStatus(await NativeRecorder.stopRecording());
    const after = await NativeRecorder.listRecordings();
    const merged = await applyRecordings(after);
    return merged.find(recording => recording.source === 'native' && !previousIds.has(recording.id)) || null;
  }), [applyRecordings, applyStatus, runAction]);

  const findWritableRecording = useCallback((id: string): Recording => {
    const recording = recordingsRef.current.find(item => item.id === id);
    if (!recording) throw new Error(t('copy212'));
    if (recording.source === 'legacy') {
      throw new Error(t('copy213'));
    }
    return recording;
  }, []);

  const deleteRecording = useCallback((id: string) => runAction(async () => {
    const recording = findWritableRecording(id);
    await NativeRecorder.deleteRecording(recording.id);
    await applyRecordings();
  }), [applyRecordings, findWritableRecording, runAction]);

  const shareRecording = useCallback((id: string) => runAction(async () => {
    const recording = findWritableRecording(id);
    await NativeRecorder.shareRecording(recording.id);
  }), [findWritableRecording, runAction]);

  const openWhatsApp = useCallback(() => runAction(() => NativeRecorder.openWhatsApp()), [runAction]);

  const clearAllRecordings = useCallback(() => runAction(async () => {
    // Existing AsyncStorage metadata and legacy files are never modified.
    const native = await NativeRecorder.listRecordings();
    for (const recording of native) await NativeRecorder.deleteRecording(recording.id);
    await applyRecordings();
  }), [applyRecordings, runAction]);

  useEffect(() => {
    mounted.current = true;
    let interval: ReturnType<typeof setInterval> | undefined;
    let systemInterval: ReturnType<typeof setInterval> | undefined;

    const syncActiveState = async () => {
      const results = await Promise.allSettled([
        refreshStatus(),
        loadRecordings(),
        checkPermissions(),
        NativeRecorder.getDeviceInfo(),
        refreshSystemAccessStatus(),
        refreshAutoRecordingStatus(),
        refreshAccessibilityMicStatus(),
      ]);
      if (!mounted.current) return;
      if (results[2].status === 'fulfilled') setHasPermissions(results[2].value);
      if (results[3].status === 'fulfilled') setDeviceInfo(results[3].value);
      for (const result of results) {
        if (result.status === 'rejected') setActionError(messageFor(result.reason));
      }
    };

    const updatePolling = (active: boolean) => {
      if (interval) clearInterval(interval);
      if (systemInterval) clearInterval(systemInterval);
      interval = undefined;
      systemInterval = undefined;
      if (active) {
        void syncActiveState();
        interval = setInterval(() => { void refreshStatus(); }, 500);
        systemInterval = setInterval(() => { void Promise.allSettled([refreshSystemAccessStatus(), refreshAutoRecordingStatus(), refreshAccessibilityMicStatus()]); }, 3000);
        // Status polling is read-only; it never arms or starts a recording.
      }
    };

    updatePolling(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', state => updatePolling(state === 'active'));
    return () => {
      mounted.current = false;
      if (interval) clearInterval(interval);
      if (systemInterval) clearInterval(systemInterval);
      subscription.remove();
      // The visible native notification owns background stop and finalization.
      // Provider unmount must never stop or discard an active recording.
    };
  }, [loadRecordings, refreshStatus, refreshSystemAccessStatus, refreshAutoRecordingStatus, refreshAccessibilityMicStatus]);

  return (
    <RecordingContext.Provider value={{
      recordings,
      isRecording: status.isRecording,
      recordingTime: formatRecordingDuration(status.elapsedMs),
      status,
      deviceInfo,
      systemAccessStatus,
      autoRecordingStatus,
      accessibilityMicStatus,
      refreshAccessibilityMicStatus,
      setRecordingMode,
      openAccessibilityMicSetup,
      openAccessibilityMicAppInfo,
      refreshAutoRecordingStatus,
      enableAutoRecording,
      resumeAutoRecordingAfterRestart,
      disableAutoRecording,
      openNotificationAccessSetup,
      refreshSystemAccessStatus,
      prepareSystemPairing,
      pairSystemRecorder,
      connectSystemRecorder,
      setOfflineRecoveryEnabled,
      requestOfflineRecoveryPermission,
      connectSystemRecorderOffline,
      cancelOfflineRecovery,
      openSystemAccessSetup,
      isBusy,
      error: actionError || status.error ? localizedError(actionError || status.error) : null,
      startRecording,
      stopRecording,
      deleteRecording,
      shareRecording,
      openWhatsApp,
      loadRecordings,
      refreshStatus,
      hasPermissions,
      requestPermissions,
      clearAllRecordings,
    }}>
      {children}
    </RecordingContext.Provider>
  );
};

export const useRecording = (): RecordingContextType => {
  const context = useContext(RecordingContext);
  if (!context) throw new Error('useRecording must be used within a RecordingProvider');
  return context;
};
