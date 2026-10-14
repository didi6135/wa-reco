package com.didi4164.WhatsAppCallRecorder;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** Bounded completion for two internal shell commands; normal ADB CLSE is not an exit-status signal. */
public final class OfflineRecoveryCommandFrame {
  public static final int MAX_BYTES = 1024;
  private static final String PREFIX = "WA_RECO_RESULT_";
  public static final class Result {
    public final String output;
    public final int exitCode;
    private Result(String output, int exitCode) { this.output = output; this.exitCode = exitCode; }
    public boolean succeeded() { return exitCode == 0; }
  }
  private final String marker;
  private final ByteArrayOutputStream line = new ByteArrayOutputStream();
  private final ByteArrayOutputStream output = new ByteArrayOutputStream();
  private int total;
  private boolean invalid;
  private Result result;

  public OfflineRecoveryCommandFrame(String marker) {
    if (marker == null || !marker.matches(PREFIX + "[0-9a-f]{32}")) {
      throw new IllegalArgumentException("Invalid fixed-command marker");
    }
    this.marker = marker;
  }
  public void accept(byte[] bytes, int offset, int count) throws IOException {
    if (bytes == null || offset < 0 || count < 0 || offset > bytes.length - count) {
      throw new IllegalArgumentException("Invalid command-output slice");
    }
    if (invalid) throw new IOException("Invalid fixed-command completion");
    for (int i = offset; i < offset + count; i++) {
      if (result != null) fail("Unexpected data after fixed-command completion");
      if (++total > MAX_BYTES) fail("Fixed-command output exceeded its bound");
      byte value = bytes[i];
      if (value == '\n') finishLine();
      else line.write(value);
    }
  }
  private void finishLine() throws IOException {
    byte[] bytes = line.toByteArray(); line.reset();
    int length = bytes.length;
    // ADB's shell PTY can convert printf's LF into CRLF; only that final CR is normalized.
    if (length > 0 && bytes[length - 1] == '\r') length--;
    String text = new String(bytes, 0, length, StandardCharsets.US_ASCII);
    if (text.startsWith(PREFIX)) {
      String expected = marker + ":";
      if (!text.startsWith(expected)) fail("Unexpected fixed-command marker");
      String status = text.substring(expected.length());
      if (!status.matches("0|[1-9][0-9]{0,2}")) fail("Malformed fixed-command exit status");
      int exitCode = Integer.parseInt(status);
      if (exitCode > 255) fail("Invalid fixed-command exit status");
      byte[] payload = output.toByteArray();
      // printf begins with one framing separator. It is not part of the command's stdout.
      if (payload.length == 0 || payload[payload.length - 1] != '\n') fail("Missing fixed-command separator");
      result = new Result(new String(payload, 0, payload.length - 1, StandardCharsets.UTF_8), exitCode);
    } else {
      output.write(bytes, 0, length); output.write('\n');
    }
  }
  private void fail(String message) throws IOException {
    invalid = true; result = null; throw new IOException(message);
  }
  public boolean completed() { return !invalid && result != null; }
  public Result result() throws IOException {
    if (!completed()) throw new IOException("Incomplete fixed-command completion");
    return result;
  }
  /** Stop at authenticated framing, before a normal peer CLSE can make AdbStream.read throw. */
  public static Result read(InputStream input, String marker) throws IOException {
    OfflineRecoveryCommandFrame frame = new OfflineRecoveryCommandFrame(marker);
    byte[] buffer = new byte[256];
    while (!frame.completed()) {
      int count = input.read(buffer);
      if (count < 0) throw new IOException("Peer closed before fixed-command completion");
      if (count > 0) frame.accept(buffer, 0, count);
    }
    return frame.result();
  }
}
