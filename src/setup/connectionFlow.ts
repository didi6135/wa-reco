import type { RecordingMode } from '../services/NativeRecorder';

export type SetupConnectionFlow = 'loading' | 'checking' | 'restore' | 'system';

/** Presentation only: observing an installation never changes its recording mode. */
export function setupConnectionFlow(input: {
  loading: boolean;
  mode: RecordingMode;
}): SetupConnectionFlow {
  if (input.loading) return 'loading';
  if (input.mode === 'accessibilityMic') return 'restore';
  return input.mode === 'system' ? 'system' : 'checking';
}

/** A saved experimental selection needs an explicit restore even after an earlier completed setup. */
export function setupInitialRoute(completed: boolean, mode: RecordingMode): 'Home' | 'Setup' {
  return completed && mode === 'system' ? 'Home' : 'Setup';
}

/** A consent callback belongs to the visible screen lifetime in which it opened. */
export function setupActionAllowed(input: {
  mounted: boolean;
  focused: boolean;
  active: boolean;
  generation: number;
  expectedGeneration: number;
  busy: boolean;
  recording: boolean;
  audioMode: number;
  connecting: boolean;
  recovering: boolean;
}, changesCapture = true): boolean {
  return input.mounted && input.focused && input.active && input.generation === input.expectedGeneration &&
    !input.busy && (!changesCapture || (!input.recording && input.audioMode === 0 && !input.connecting && !input.recovering));
}
