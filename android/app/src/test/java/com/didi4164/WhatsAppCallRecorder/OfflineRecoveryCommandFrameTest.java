package com.didi4164.WhatsAppCallRecorder;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.junit.Test;
import static org.junit.Assert.*;

public class OfflineRecoveryCommandFrameTest {
  private static final String MARKER = "WA_RECO_RESULT_0123456789abcdef0123456789abcdef";
  private static byte[] bytes(String text) { return text.getBytes(StandardCharsets.UTF_8); }
  private static String frame(String output, String status) { return output + "\n" + MARKER + ":" + status + "\n"; }
  private static final class PeerCloseStream extends InputStream {
    final byte[] bytes; final int chunk; int offset, reads, closedReads;
    PeerCloseStream(String text, int chunk) { bytes = bytes(text); this.chunk = chunk; }
    @Override public int read(byte[] target, int start, int length) throws IOException {
      reads++;
      if (offset == bytes.length) { closedReads++; throw new IOException("Stream closed."); }
      int count = Math.min(Math.min(length, chunk), bytes.length - offset);
      System.arraycopy(bytes, offset, target, start, count); offset += count; return count;
    }
    @Override public int read() throws IOException {
      byte[] one = new byte[1]; read(one, 0, 1); return one[0] & 255;
    }
  }
  @Test public void normalPeerClseAfterCompleteOutputDoesNotRequireAnotherRead() throws Exception {
    PeerCloseStream stream = new PeerCloseStream(frame("2000\n", "0"), 256);
    OfflineRecoveryCommandFrame.Result result = OfflineRecoveryCommandFrame.read(stream, MARKER);
    assertTrue(result.succeeded()); assertEquals("2000\n", result.output);
    assertEquals(1, stream.reads); assertEquals(0, stream.closedReads);
  }
  @Test public void completionSplitAcrossArbitraryChunksIsAccepted() throws Exception {
    for (int chunk : new int[] {1, 6, 17, 31}) {
      PeerCloseStream stream = new PeerCloseStream(frame("2000\n", "0"), chunk);
      OfflineRecoveryCommandFrame.Result result = OfflineRecoveryCommandFrame.read(stream, MARKER);
      assertTrue(result.succeeded()); assertEquals("2000\n", result.output); assertEquals(0, stream.closedReads);
    }
  }
  @Test public void permissionGrantCanSucceedWithNoCommandOutput() throws Exception {
    OfflineRecoveryCommandFrame.Result result = OfflineRecoveryCommandFrame.read(
      new PeerCloseStream(frame("", "0"), 7), MARKER);
    assertTrue(result.succeeded()); assertEquals("", result.output);
  }
  @Test public void nonzeroExitIsCompleteButCannotBeTreatedAsSuccessful() throws Exception {
    OfflineRecoveryCommandFrame.Result result = OfflineRecoveryCommandFrame.read(
      new PeerCloseStream(frame("Permission denied\n", "1"), 11), MARKER);
    assertFalse(result.succeeded()); assertEquals(1, result.exitCode);
  }
  @Test public void eofBeforeMarkerDoesNotAuthorizeEvenAnExactUidPayload() throws Exception {
    assertRejected("2000\n");
    assertRejected("2000\n\n" + MARKER + ":0");
  }
  @Test public void peerCloseBeforeCompletionFails() throws Exception {
    try { OfflineRecoveryCommandFrame.read(new PeerCloseStream("2000\n", 256), MARKER); fail("Missing completion"); }
    catch (IOException expected) { }
  }
  @Test public void wrongNonceIsRejectedRatherThanInferredFromExitText() throws Exception {
    assertRejected("2000\n\nWA_RECO_RESULT_ffffffffffffffffffffffffffffffff:0\n");
  }
  @Test public void outputOverflowFailsEvenWithAValidMarkerAtTheEnd() throws Exception {
    StringBuilder output = new StringBuilder();
    while (output.length() <= OfflineRecoveryCommandFrame.MAX_BYTES) output.append('x');
    assertRejected(frame(output.toString(), "0"));
  }
  @Test public void malformedStatusOrTrailingDataIsRejected() throws Exception {
    for (String status : new String[] {"", "-1", "+0", "00", "256", "0 extra", " 0", "0\rX"}) {
      assertRejected(frame("2000\n", status));
    }
    assertRejected(frame("2000\n", "0") + "unexpected");
  }
  @Test public void shellPtyCrLfDoesNotChangeTheUidOrCompletionStatus() throws Exception {
    String text = frame("2000\n", "0").replace("\n", "\r\n");
    OfflineRecoveryCommandFrame.Result result = OfflineRecoveryCommandFrame.read(new PeerCloseStream(text, 3), MARKER);
    assertTrue(result.succeeded()); assertEquals("2000\n", result.output);
  }
  @Test public void markerMustBeginItsOwnLineAndHaveAFramingSeparator() throws Exception {
    assertRejected("2000" + MARKER + ":0\n");
    assertRejected(MARKER + ":0\n");
  }
  @Test public void incrementalParserRejectsLaterDataAfterCompletion() throws Exception {
    OfflineRecoveryCommandFrame parser = new OfflineRecoveryCommandFrame(MARKER);
    byte[] valid = bytes(frame("", "0")); parser.accept(valid, 0, valid.length);
    assertTrue(parser.completed());
    try { parser.accept(bytes("x"), 0, 1); fail("Trailing output"); }
    catch (IOException expected) { }
    assertFalse(parser.completed());
  }
  private static void assertRejected(String text) throws Exception {
    try { OfflineRecoveryCommandFrame.read(new ByteArrayInputStream(bytes(text)), MARKER); fail("Invalid frame accepted"); }
    catch (IOException expected) { }
  }
}
