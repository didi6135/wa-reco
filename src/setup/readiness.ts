import type { AccessibilityMicStatus, RecordingMode } from '../services/NativeRecorder';

export interface SetupReadiness {
  mode: RecordingMode;
  captureReady: boolean;
  automaticSupported: boolean;
  microphone: boolean;
  notifications: boolean;
  callAccess: boolean;
  helper: boolean;
  automatic: boolean;
  allReady: boolean;
}

export interface PhoneEvidence {
  available: boolean;
  helperConnected: boolean;
  developerOptionsEnabled?: boolean;
  wirelessDebuggingEnabled: boolean;
  paired: boolean;
}

export interface SetupEvidence {
  accessibility?: AccessibilityMicStatus | null;
  nativeAvailable: boolean | null;
  microphoneGranted: boolean | null;
  notificationsGranted: boolean | null;
  system: PhoneEvidence | null;
  automatic: {
    mode?: RecordingMode;
    modeReady?: boolean;
    enabled: boolean;
    armed: boolean;
    notificationAccessGranted: boolean;
    listenerConnected: boolean;
    notificationsEnabled: boolean;
    helperConnected: boolean;
    state: string;
  } | null;
}

export const EMPTY_SETUP_READINESS: SetupReadiness = {
  mode: 'system', captureReady: false, automaticSupported: true,
  microphone: false, notifications: false, callAccess: false,
  helper: false, automatic: false, allReady: false,
};

export function deriveSetupReadiness(evidence: SetupEvidence): SetupReadiness {
  const microphone = evidence.microphoneGranted === true;
  const notifications = evidence.notificationsGranted === true && evidence.automatic?.notificationsEnabled === true;
  const callAccess = evidence.automatic?.notificationAccessGranted === true && evidence.automatic.listenerConnected === true;
  const helper = evidence.system?.available === true && evidence.system.helperConnected === true;
  const mode = evidence.automatic?.mode === 'accessibilityMic' ? 'accessibilityMic' : 'system';
  const modeKnown = evidence.automatic?.mode === undefined || ['system', 'accessibilityMic'].includes(evidence.automatic.mode);
  const mic = evidence.accessibility;
  const captureReady = modeKnown && (mode === 'accessibilityMic'
    ? mic?.supported === true && mic.selected === true && mic.enabled === true && mic.connected === true
    : helper);
  const automaticSupported = mode === 'system' || mic?.automaticSupported === true;
  const automatic = evidence.automatic?.enabled === true && evidence.automatic.armed === true &&
    (mode === 'accessibilityMic' ? captureReady && evidence.automatic.modeReady === true : evidence.automatic.helperConnected === true) &&
    automaticSupported && ['ready', 'recording'].includes(evidence.automatic.state);
  return { mode, captureReady, automaticSupported, microphone, notifications, callAccess, helper, automatic,
    allReady: evidence.nativeAvailable === true && microphone && notifications && callAccess && captureReady && automatic };
}

export type SetupStep = 'loading' | 'checking' | 'microphone' | 'notifications' | 'activation' | 'call_access' | 'automatic' | 'automatic_unavailable' | 'done';
export function nextSetupStep(readiness: SetupReadiness, loading = false): SetupStep {
  if (loading) return 'loading';
  if (!readiness.microphone) return 'microphone';
  if (!readiness.notifications) return 'notifications';
  if (!readiness.captureReady) return 'activation';
  if (!readiness.automaticSupported) return 'automatic_unavailable';
  if (!readiness.callAccess) return 'call_access';
  if (!readiness.automatic) return 'automatic';
  return readiness.allReady ? 'done' : 'checking';
}

export type PhoneSetupStep = 'checking' | 'ready' | 'unsupported' | 'developer' | 'wireless' | 'pair' | 'connect';
export function phoneSetupStep(access: PhoneEvidence | null): PhoneSetupStep {
  if (access === null) return 'checking';
  if (!access.available) return 'unsupported';
  // A live authenticated helper needs no new Wi-Fi/debugging/ADB session.
  if (access.helperConnected) return 'ready';
  if (!(access.developerOptionsEnabled ?? access.wirelessDebuggingEnabled)) return 'developer';
  if (!access.wirelessDebuggingEnabled) return 'wireless';
  return access.paired ? 'connect' : 'pair';
}

export type AccessibilityMicStep = 'checking' | 'unsupported' | 'choose' | 'permission' | 'connecting' | 'ready';
export function accessibilityMicStep(status: AccessibilityMicStatus | null, mode: RecordingMode): AccessibilityMicStep {
  if (status === null) return 'checking';
  if (!status.supported) return 'unsupported';
  if (mode !== 'accessibilityMic') return 'choose';
  // A stale mode response is not service readiness and must be refreshed.
  if (!status.selected) return 'checking';
  if (!status.enabled) return 'permission';
  return status.connected ? 'ready' : 'connecting';
}
