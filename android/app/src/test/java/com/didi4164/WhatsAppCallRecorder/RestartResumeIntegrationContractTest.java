package com.didi4164.WhatsAppCallRecorder;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import org.junit.Test;
import static org.junit.Assert.*;

/** Actual-source wiring regressions; these complement pure lifecycle tests, not device acceptance. */
public class RestartResumeIntegrationContractTest {
  private static String source(String name) throws IOException {
    Path directory = Paths.get(System.getProperty("user.dir")).toAbsolutePath();
    for (int i = 0; i < 4 && directory != null; i++, directory = directory.getParent()) {
      for (String base : new String[] {"src/main/java/com/didi4164/WhatsAppCallRecorder/",
          "android/app/src/main/java/com/didi4164/WhatsAppCallRecorder/"}) {
        Path file = directory.resolve(base + name);
        if (Files.isRegularFile(file)) return new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
      }
    }
    throw new IOException("Project source unavailable for restart integration contract");
  }
  private static String section(String value, String start, String end) {
    int from = value.indexOf(start); assertTrue("Missing source checkpoint: " + start, from >= 0);
    int to = value.indexOf(end, from + start.length()); assertTrue("Missing source boundary: " + end, to > from);
    return value.substring(from, to);
  }
  @Test public void realArmingFutureCallbackChecksRevocationBeforeStartingMonitoring() throws Exception {
    String auto = source("AutoRecordingController.kt");
    String callback = section(auto, "RecordingService.armAutomatic(owner).whenComplete", "} catch (_: Exception)");
    assertTrue(callback.indexOf("restartGuard != null && !restartGuard()") < callback.indexOf("enableMonitoring(owner, activation, promise, restartGuard)"));
    assertTrue(callback.contains("activationFailed(owner, activation, promise"));
  }
  @Test public void actualIoReturnAndEvidenceCommitBothCarryTheSameGuard() throws Exception {
    String auto = source("AutoRecordingController.kt");
    String monitoring = section(auto, "private fun enableMonitoring", "private fun awaitKnownObservation");
    String ioReturn = monitoring.substring(monitoring.indexOf("main.post {"));
    assertTrue(ioReturn.indexOf("restartGuard != null && !restartGuard()") < ioReturn.indexOf("awaitKnownObservation(owner, activation, promise, restartGuard)"));
    String evidence = section(auto, "private fun awaitKnownObservation", "private fun activationFailed");
    int guard = evidence.indexOf("restartGuard != null && !restartGuard()");
    assertTrue(guard >= 0 && guard < evidence.indexOf("putBoolean(ENABLED, true)"));
    assertTrue(evidence.contains("activationFailed(owner, activation, promise"));
  }
  @Test public void realPauseCancelsOnlyTheOwnedPendingRestartActivation() throws Exception {
    String controller = source("RestartReminderController.kt");
    String left = section(controller, "fun onActivityLeft", "fun cancelResume");
    assertTrue(left.contains("pending.clearFor(activity)"));
    assertTrue(left.contains("AutoRecordingController.cancelRestartArming"));
    String cancel = section(source("AutoRecordingController.kt"), "fun cancelRestartArming", "private fun enableMonitoring");
    assertTrue(cancel.contains("restartActivation == generation && desiredMonitoring"));
    assertTrue(cancel.contains("pauseArming(initialize(context)"));
    assertTrue(source("MainActivity.kt").contains("RestartReminderController.onActivityLeft(this)"));
    assertTrue(source("MainActivity.kt").contains("if (!hasFocus) RestartReminderController.onActivityFocusLost(this)"));
    String blur = section(controller, "fun onActivityFocusLost", "fun cancelResume");
    assertTrue(blur.contains("pending.revokeConsumedFor(activity)"));
    assertTrue(blur.contains("AutoRecordingController.cancelRestartArming"));
  }
  @Test public void ordinaryBootNotificationDoesNotInvokeCaptureOrActivation() throws Exception {
    String controller = source("RestartReminderController.kt");
    String boot = section(controller, "fun onBoot", "/** Exported Activity extras");
    assertTrue(boot.indexOf("Build.VERSION.SDK_INT < 34") < boot.indexOf("createNotificationChannel("));
    assertTrue(boot.contains("PendingIntent.getActivity"));
    assertTrue(boot.contains("PendingIntent.FLAG_IMMUTABLE"));
    assertTrue(boot.contains("PendingIntent.FLAG_ONE_SHOT"));
    assertTrue(boot.contains("PendingIntent.FLAG_CANCEL_CURRENT"));
    assertFalse(boot.contains("PendingIntent.FLAG_UPDATE_CURRENT"));
    assertTrue(boot.contains("NotificationManager.IMPORTANCE_HIGH"));
    for (String forbidden : new String[] {"startForegroundService", "startService(", "startHelper",
        "startHotspot", "setEnabled(", "setAutoRecording", "AudioRecord", "setWifiEnabled", "fullScreenIntent"})
      assertFalse("Boot must not invoke " + forbidden, boot.contains(forbidden));
    assertTrue(source("RestartReminderReceiver.kt").contains("intent.action == Intent.ACTION_BOOT_COMPLETED"));
  }
  @Test public void resumedArmIsBoundToNativeAuthorityAndFreshCaptureExclusion() throws Exception {
    String module = source("CallRecorderModule.kt");
    String resume = section(module, "@ReactMethod fun resumeAutoRecordingAfterRestart(promise: Promise)", "@ReactMethod fun getAccessibilityMicStatus");
    assertTrue(resume.contains("RestartReminderController.beginArming(activity, foreground())"));
    assertTrue(resume.contains("RestartReminderController.permitsArming(activity, authorization, foreground())"));
    for (String gate : new String[] {"RecordingService.isBusy()", "RecordingService.isArming()",
        "NativeWirelessAudioBridge.isOfflineRecoveryRunning()", "AutoRecordingController.hasObservedCall()",
        "mode == 0", "AutoRecordingController.setEnabled(context, true, promise, allowed)"})
      assertTrue("Missing native resume gate " + gate, resume.contains(gate));
  }
}
