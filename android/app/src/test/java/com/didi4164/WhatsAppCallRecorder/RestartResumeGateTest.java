package com.didi4164.WhatsAppCallRecorder;

import org.junit.Test;
import static org.junit.Assert.*;

public class RestartResumeGateTest {
  @Test public void ordinaryLaunchNeverCreatesAuthority() {
    RestartResumeGate gate = new RestartResumeGate(); Object activity = new Object();
    assertFalse(gate.consume(activity, 100, true, true));
    assertEquals(-1, gate.beginArming(activity, 100, true, true));
  }
  @Test public void initialNotYetFocusedDeliveryWaitsForTheSameActivity() {
    RestartResumeGate gate = new RestartResumeGate(); Object activity = new Object();
    assertTrue(gate.queue(activity, 100));
    assertFalse(gate.consume(activity, 101, true, false));
    assertTrue(gate.consume(activity, 102, true, true));
    assertFalse(gate.consume(activity, 103, true, true));
  }
  @Test public void anotherActivityCannotConsumeOrArmTheRequest() {
    RestartResumeGate gate = new RestartResumeGate(); Object activity = new Object(), other = new Object();
    gate.queue(activity, 100);
    assertFalse(gate.consume(other, 101, true, true));
    assertTrue(gate.consume(activity, 102, true, true));
    assertEquals(-1, gate.beginArming(other, 103, true, true));
    assertTrue(gate.beginArming(activity, 104, true, true) >= 0);
  }
  @Test public void actualPauseRevokesRatherThanDeferringUntilLaterResume() {
    RestartResumeGate gate = new RestartResumeGate(); Object activity = new Object();
    gate.queue(activity, 100); assertFalse(gate.consume(activity, 101, true, false));
    assertTrue(gate.clearFor(activity));
    assertFalse(gate.consume(activity, 102, true, true));
  }
  @Test public void disablingAutoOrChangingModeRevokesPendingDelivery() {
    RestartResumeGate gate = new RestartResumeGate(); Object activity = new Object();
    gate.queue(activity, 100); assertFalse(gate.consume(activity, 101, false, true));
    assertFalse(gate.consume(activity, 102, true, true));
  }
  @Test public void pendingRequestHasABoundedMonotonicLifetime() {
    RestartResumeGate gate = new RestartResumeGate(); Object activity = new Object();
    gate.queue(activity, 100);
    assertFalse(gate.consume(activity, 100 + RestartResumeGate.REQUEST_MAX_AGE_MS, true, true));
    gate.queue(activity, 100); assertFalse(gate.consume(activity, 99, true, true));
  }
  @Test public void oneConsumedTapPermitsOnlyOneArmingAttempt() {
    RestartResumeGate gate = new RestartResumeGate(); Object activity = new Object();
    gate.queue(activity, 100); assertTrue(gate.consume(activity, 101, true, true));
    long authorization = gate.beginArming(activity, 102, true, true);
    assertTrue(authorization >= 0); assertEquals(-1, gate.beginArming(activity, 103, true, true));
    assertTrue(gate.permitsArming(activity, authorization, 104, true, true));
  }
  @Test public void disableAfterConsumedTapCannotBeReenabledByALateArm() {
    RestartResumeGate gate = new RestartResumeGate(); Object activity = new Object();
    gate.queue(activity, 100); gate.consume(activity, 101, true, true);
    assertEquals(-1, gate.beginArming(activity, 102, false, true));
    assertEquals(-1, gate.beginArming(activity, 103, true, true));
  }
  @Test public void pauseDuringAsyncArmingRevokesTheCommitGuard() {
    RestartResumeGate gate = new RestartResumeGate(); Object activity = new Object();
    gate.queue(activity, 100); gate.consume(activity, 101, true, true);
    long authorization = gate.beginArming(activity, 102, true, true);
    gate.clearFor(activity);
    assertFalse(gate.permitsArming(activity, authorization, 103, true, true));
  }
  @Test public void lossOfEligibilityOrFocusDuringArmingCannotRevive() {
    for (boolean eligibilityLoss : new boolean[] {false, true}) {
      RestartResumeGate gate = new RestartResumeGate(); Object activity = new Object();
      gate.queue(activity, 100); gate.consume(activity, 101, true, true);
      long authorization = gate.beginArming(activity, 102, true, true);
      assertFalse(gate.permitsArming(activity, authorization, 103, !eligibilityLoss, eligibilityLoss));
      assertFalse(gate.permitsArming(activity, authorization, 104, true, true));
    }
  }
  @Test public void consumedTapExpiresEvenIfTheActivityStaysVisible() {
    RestartResumeGate gate = new RestartResumeGate(); Object activity = new Object();
    gate.queue(activity, 100); gate.consume(activity, 101, true, true);
    assertEquals(-1, gate.beginArming(activity, 101 + RestartResumeGate.ARM_MAX_AGE_MS, true, true));
  }
  @Test public void cancellationAndSuccessfulCompletionBothClearAuthority() {
    RestartResumeGate gate = new RestartResumeGate(); Object activity = new Object();
    gate.queue(activity, 100); gate.consume(activity, 101, true, true);
    long authorization = gate.beginArming(activity, 102, true, true);
    gate.clear(); assertFalse(gate.permitsArming(activity, authorization, 103, true, true));
  }
  @Test public void staleGuardCannotConsumeAReplacementRequest() {
    RestartResumeGate gate = new RestartResumeGate(); Object activity = new Object();
    gate.queue(activity, 100); gate.consume(activity, 101, true, true);
    long old = gate.beginArming(activity, 102, true, true);
    gate.queue(activity, 103);
    assertFalse(gate.permitsArming(activity, old, 104, true, true));
    assertTrue(gate.consume(activity, 105, true, true));
    long replacement = gate.beginArming(activity, 106, true, true);
    assertNotEquals(old, replacement);
  }
  @Test public void otherActivityDestructionDoesNotRevokeTheOwner() {
    RestartResumeGate gate = new RestartResumeGate(); Object activity = new Object();
    gate.queue(activity, 100); assertFalse(gate.clearFor(new Object()));
    assertTrue(gate.consume(activity, 101, true, true));
  }
  @Test public void initialFocusWaitIsNotRevokedByAnUnfocusedWindowCallback() {
    RestartResumeGate gate = new RestartResumeGate(); Object activity = new Object();
    gate.queue(activity, 100);
    assertFalse(gate.revokeConsumedFor(activity));
    assertFalse(gate.consume(activity, 101, true, false));
    assertTrue(gate.consume(activity, 102, true, true));
  }
  @Test public void transientWindowBlurAfterConsumeCannotReviveArming() {
    for (boolean begun : new boolean[] {false, true}) {
      RestartResumeGate gate = new RestartResumeGate(); Object activity = new Object();
      gate.queue(activity, 100); gate.consume(activity, 101, true, true);
      long authorization = begun ? gate.beginArming(activity, 102, true, true) : -1;
      assertTrue(gate.revokeConsumedFor(activity));
      assertEquals(-1, gate.beginArming(activity, 103, true, true));
      assertFalse(gate.permitsArming(activity, authorization, 103, true, true));
    }
  }
}
