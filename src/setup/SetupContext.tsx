import { localizedError, t } from '../i18n/core';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { NativeRecorder, SystemAccessStatus } from '../services/NativeRecorder';
import { deriveSetupReadiness, EMPTY_SETUP_READINESS, SetupEvidence, SetupReadiness } from './readiness';

const COMPLETION_KEY = 'recorder_setup_completion_v1';
const CHECK_ERROR = () => t('copy417');

interface SetupSnapshot {
  evidence: SetupEvidence;
  nativeAvailable: boolean;
  error: string | null;
}

export interface SetupContextValue {
  loading: boolean;
  completed: boolean;
  readiness: SetupReadiness;
  refresh(): Promise<void>;
  completeOnboarding(): Promise<void>;
  completeManualOnboarding(): Promise<void>;
  setupError: string | null;
  supported: boolean | null;
  systemAccessStatus: SystemAccessStatus | null;
}

const SetupContext = createContext<SetupContextValue | undefined>(undefined);

async function readSnapshot(): Promise<SetupSnapshot> {
  const android = Platform.OS === 'android';
  const results = await Promise.allSettled([
    android ? PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO) : Promise.resolve(false),
    android ? Number(Platform.Version) < 33 ? Promise.resolve(true)
      : PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS) : Promise.resolve(false),
    NativeRecorder.getSystemAccessStatus(),
    NativeRecorder.getAutoRecordingStatus(),
    NativeRecorder.getStatus(),
    NativeRecorder.getAccessibilityMicStatus(),
  ]);
  const [microphone, notifications, system, automatic, recorder, accessibility] = results;
  const experimental = automatic.status === 'fulfilled' && automatic.value.mode === 'accessibilityMic';
  return {
    evidence: {
      nativeAvailable: android && recorder.status === 'fulfilled',
      microphoneGranted: microphone.status === 'fulfilled' ? microphone.value : null,
      notificationsGranted: notifications.status === 'fulfilled' ? notifications.value : null,
      system: system.status === 'fulfilled' ? system.value : null,
      automatic: automatic.status === 'fulfilled' ? automatic.value : null,
      accessibility: accessibility.status === 'fulfilled' ? accessibility.value : null,
    },
    nativeAvailable: android && recorder.status === 'fulfilled',
    // The unused capture route is not an onboarding prerequisite.
    error: results.some((result, index) => result.status === 'rejected' &&
      (experimental ? index !== 2 : index !== 5)) ? CHECK_ERROR() : null,
  };
}

export function SetupProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [completed, setCompleted] = useState(false);
  const [readiness, setReadiness] = useState(EMPTY_SETUP_READINESS);
  const [systemAccessStatus, setSystemAccessStatus] = useState<SystemAccessStatus | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const mounted = useRef(true);
  const revision = useRef(0);

  const observe = useCallback(async (): Promise<SetupSnapshot> => {
    const request = ++revision.current;
    const snapshot = await readSnapshot();
    if (mounted.current && request === revision.current) {
      setReadiness(deriveSetupReadiness(snapshot.evidence));
      setSystemAccessStatus(snapshot.evidence.system as SystemAccessStatus | null);
      setSetupError(snapshot.error);
    }
    return snapshot;
  }, []);
  const refresh = useCallback(async () => { await observe(); }, [observe]);

  const persistCompletion = useCallback(async (mode: 'full' | 'manual') => {
    // This records an explicit finished walkthrough, never cached permissions or readiness.
    await AsyncStorage.setItem(COMPLETION_KEY, JSON.stringify({ version: 1, mode }));
    if (mounted.current) setCompleted(true);
  }, []);

  const completeOnboarding = useCallback(async () => {
    const snapshot = await observe();
    if (!snapshot.nativeAvailable || !deriveSetupReadiness(snapshot.evidence).allReady)
      throw new Error(t('copy418'));
    await persistCompletion('full');
  }, [observe, persistCompletion]);

  const completeManualOnboarding = useCallback(async () => {
    if (Platform.OS !== 'android') throw new Error(t('copy338'));
    // A manual choice explicitly revokes automatic mode; polling never changes it.
    await NativeRecorder.setAutoRecordingEnabled(false);
    const snapshot = await observe();
    const verified = deriveSetupReadiness(snapshot.evidence);
    if (!snapshot.nativeAvailable || !verified.microphone || !verified.notifications ||
      snapshot.evidence.automatic?.enabled !== false || snapshot.evidence.automatic.armed !== false)
      throw new Error(t('copy419'));
    await persistCompletion('manual');
  }, [observe, persistCompletion]);

  useEffect(() => {
    mounted.current = true;
    let interval: ReturnType<typeof setInterval> | undefined;
    let bootstrapped = false;
    const initialize = async () => {
      try {
        const [saved] = await Promise.all([AsyncStorage.getItem(COMPLETION_KEY), observe()]);
        if (!mounted.current) return;
        if (saved) {
          const value: unknown = JSON.parse(saved);
          if (value && typeof value === 'object' && 'version' in value && value.version === 1 &&
            'mode' in value && (value.mode === 'full' || value.mode === 'manual')) setCompleted(true);
        }
      } catch {
        if (mounted.current) setSetupError(t('copy420'));
      } finally {
        bootstrapped = true;
        if (mounted.current) setLoading(false);
      }
    };
    void initialize();
    const update = (active: boolean) => {
      if (interval) clearInterval(interval);
      interval = undefined;
      if (active) {
        if (bootstrapped) void refresh();
        interval = setInterval(() => { if (bootstrapped) void refresh(); }, 3000);
      }
    };
    update(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', state => update(state === 'active'));
    return () => { mounted.current = false; if (interval) clearInterval(interval); subscription.remove(); };
  }, [observe, refresh]);

  return <SetupContext.Provider value={{ loading, completed, readiness, refresh, completeOnboarding,
    completeManualOnboarding, setupError: setupError ? localizedError(setupError) : null, supported: systemAccessStatus?.available ?? null,
    systemAccessStatus }}>{children}</SetupContext.Provider>;
}

export function useSetup(): SetupContextValue {
  const context = useContext(SetupContext);
  if (!context) throw new Error('useSetup must be used inside SetupProvider.');
  return context;
}
