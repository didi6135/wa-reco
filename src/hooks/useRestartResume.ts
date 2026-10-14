import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useRecording } from '../context/RecordingContext';
import { NativeRecorder } from '../services/NativeRecorder';

/** Foreground probing is read-only. Only a genuine one-use native tap can act. */
export function useRestartResume(ready: boolean, openSetup: () => void): void {
  const { isBusy, resumeAutoRecordingAfterRestart } = useRecording();
  const probeRunning = useRef(false);
  const restoring = useRef(false);
  const focused = useRef(true);
  const revision = useRef(0);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const mayObserve = () => alive && ready && !isBusy &&
      AppState.currentState === 'active' && focused.current;
    const mayProbe = () => mayObserve() && !restoring.current;
    const probe = async () => {
      if (!mayProbe() || probeRunning.current) return;
      probeRunning.current = true;
      const current = revision.current;
      try {
        const requested = await NativeRecorder.consumeRestartResumeRequest();
        if (!requested || current !== revision.current || !mayProbe()) return;
        restoring.current = true;
        openSetup();
        // runAction owns visible progress/errors; a failure is consumed and has
        // no retry on a later focus, settings return or ordinary launch.
        await resumeAutoRecordingAfterRestart();
      } catch {
        // A failed probe carries no authority. Action failures remain in Setup.
      } finally {
        restoring.current = false;
        probeRunning.current = false;
      }
    };
    const update = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
      if (mayObserve()) {
        void probe();
        // Warm notification delivery can occur without an AppState change.
        timer = setInterval(() => { void probe(); }, 500);
      }
    };
    const change = AppState.addEventListener('change', state => {
      if (state !== 'active') revision.current += 1;
      update();
    });
    const blur = AppState.addEventListener('blur', () => {
      revision.current += 1;
      focused.current = false;
      update();
    });
    const focus = AppState.addEventListener('focus', () => { focused.current = true; update(); });
    update();
    return () => {
      alive = false;
      revision.current += 1;
      if (timer) clearInterval(timer);
      change.remove(); blur.remove(); focus.remove();
    };
  }, [isBusy, openSetup, ready, resumeAutoRecordingAfterRestart]);
}
