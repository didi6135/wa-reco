package com.didi4164.WhatsAppCallRecorder;

import org.junit.Test;
import static org.junit.Assert.*;

public class AccessibilityMicRouteTest {
  @Test public void builtinInputDoesNotInventSpeakerOrEarpieceOutput() {
    assertEquals("builtin_mic", AccessibilityMicRoute.input(15));
    assertEquals("unknown", AccessibilityMicRoute.output(15));
  }
  @Test public void communicationOutputsRemainDistinct() {
    assertEquals("earpiece", AccessibilityMicRoute.output(1));
    assertEquals("speaker", AccessibilityMicRoute.output(2));
    assertEquals("headset", AccessibilityMicRoute.output(7));
  }
  @Test public void inputKindsContainNoDeviceIdentity() {
    assertEquals("wired", AccessibilityMicRoute.input(3));
    assertEquals("bluetooth", AccessibilityMicRoute.input(7));
    assertEquals("usb", AccessibilityMicRoute.input(22));
  }
  @Test public void unsupportedAndAbsentDevicesAreUnknown() {
    for (int value : new int[] {0, -1, 1000}) {
      assertEquals("unknown", AccessibilityMicRoute.input(value));
      assertEquals("unknown", AccessibilityMicRoute.output(value));
    }
  }
}
