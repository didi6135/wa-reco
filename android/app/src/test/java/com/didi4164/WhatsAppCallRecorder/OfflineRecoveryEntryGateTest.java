package com.didi4164.WhatsAppCallRecorder;

import java.util.ArrayDeque;
import org.junit.Test;
import static org.junit.Assert.*;

public class OfflineRecoveryEntryGateTest {
  private static final class Fixture implements OfflineRecoveryEntryGate.Scheduler {
    long now; boolean sameActivity = true, resumed = true, focused, sameGeneration = true;
    int actions, rejects; String error;
    Runnable beforeActualAction = () -> {};
    final ArrayDeque<Runnable> queued = new ArrayDeque<>();
    final ArrayDeque<Long> times = new ArrayDeque<>();
    final OfflineRecoveryEntryGate gate = new OfflineRecoveryEntryGate(this,
      () -> new OfflineRecoveryEntryGate.State(sameActivity, resumed, focused, sameGeneration),
      () -> {
        beforeActualAction.run();
        if (OfflineRecoveryEntryGate.permitsAction(new OfflineRecoveryEntryGate.State(sameActivity, resumed, focused, sameGeneration))) actions++;
        else { rejects++; error = "OFFLINE_FOREGROUND_REQUIRED"; }
      }, code -> { rejects++; error = code; });
    public long now() { return now; }
    public void post(Runnable task, long delay) { queued.add(task); times.add(now + delay); }
    void next() { now = times.remove(); queued.remove().run(); }
    void drain() { while (!queued.isEmpty()) next(); }
  }
  @Test public void immediatelyFocusedForegroundExecutesOnce() {
    Fixture f = new Fixture(); f.focused = true;
    f.gate.start(); f.drain(); f.gate.run();
    assertEquals(1, f.actions); assertEquals(0, f.rejects);
  }
  @Test public void alertDismissalMayRestoreFocusWithinTheBound() {
    Fixture f = new Fixture(); f.gate.start(); f.next(); f.next();
    assertEquals(0, f.actions); assertEquals(0, f.rejects);
    f.focused = true; f.drain();
    assertEquals(1, f.actions); assertEquals(0, f.rejects);
    assertTrue(f.now <= OfflineRecoveryEntryGate.TIMEOUT_MS);
  }
  @Test public void aDialogWhichNeverDismissesTimesOutWithoutExecution() {
    Fixture f = new Fixture(); f.gate.start(); f.drain();
    assertEquals(1000, f.now); assertEquals(0, f.actions); assertEquals(1, f.rejects);
    assertEquals("OFFLINE_FOREGROUND_REQUIRED", f.error);
  }
  @Test public void focusAtTheDeadlineIsTooLate() {
    Fixture f = new Fixture(); f.gate.start(); f.next();
    f.now = OfflineRecoveryEntryGate.TIMEOUT_MS; f.focused = true; f.gate.run();
    assertEquals(0, f.actions); assertEquals(1, f.rejects);
  }
  @Test public void pausedHostRejectsImmediatelyAndLaterResumeCannotExecute() {
    Fixture f = new Fixture(); f.gate.start(); f.next();
    f.resumed = false; f.next();
    assertEquals(1, f.rejects); assertTrue(f.now < OfflineRecoveryEntryGate.TIMEOUT_MS);
    f.resumed = true; f.focused = true; f.gate.run(); f.drain();
    assertEquals(0, f.actions); assertEquals(1, f.rejects);
  }
  @Test public void destroyedOrReplacedActivityCannotReceiveTheOldConsent() {
    Fixture f = new Fixture(); f.gate.start(); f.next();
    f.sameActivity = false; f.focused = true; f.next();
    assertEquals(0, f.actions); assertEquals(1, f.rejects);
  }
  @Test public void changedGenerationCannotResurrectEvenIfTheActivityLooksReady() {
    Fixture f = new Fixture(); f.gate.start(); f.next();
    f.sameGeneration = false; f.focused = true; f.next();
    f.sameGeneration = true; f.gate.run();
    assertEquals(0, f.actions); assertEquals(1, f.rejects);
  }
  @Test public void explicitCancelSettlesOnceAndQueuedPollsCannotExecute() {
    Fixture f = new Fixture(); f.gate.start(); f.next();
    f.gate.cancel(); f.gate.cancel(); f.focused = true; f.drain();
    assertEquals(0, f.actions); assertEquals(1, f.rejects);
  }
  @Test public void initiallyBackgroundHostDoesNotWaitForResume() {
    Fixture f = new Fixture(); f.resumed = false; f.gate.start(); f.next();
    assertEquals(0, f.now); assertEquals(1, f.rejects); assertTrue(f.queued.isEmpty());
    f.resumed = true; f.focused = true; f.gate.run(); assertEquals(0, f.actions);
  }
  @Test public void cancellationBetweenReadySampleAndActualActionCannotStartTheOldRequest() {
    Fixture f = new Fixture(); f.focused = true;
    f.beforeActualAction = () -> { f.sameGeneration = false; };
    f.gate.start(); f.drain();
    assertEquals(0, f.actions); assertEquals(1, f.rejects);
    assertEquals("OFFLINE_FOREGROUND_REQUIRED", f.error);
  }
}
