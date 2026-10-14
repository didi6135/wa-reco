# Offline restart recovery research

Checked on 2026-10-08. Scope: restore wa-reco's authorized helper after a phone reboot without an external Wi-Fi network, preferably with one APK and no Root.

## Finding

There is a credible **experimental local-hotspot recovery candidate**. An original Shizuku fork maintainer confirmed it, and Shizuku-Next implements a related approach. It combines a temporary local-only hotspot with repeated protected wireless-debugging setting changes. It is an undocumented timing workaround, not a supported Android guarantee. The previous conclusion that a same-phone hotspot cannot help was too broad: it does not satisfy the normal AOSP station check, but OEM behavior or this timing workaround can provide another path. [Maintainer confirmation](https://github.com/thedjchi/Shizuku/issues/165#issuecomment-4104485910), [pinned implementation](https://github.com/rushiranpise/Shizuku-Next/blob/97bb4d90903343edbbbadea823e7f98ca0875572/manager/src/main/java/moe/shizuku/manager/start/ForcedWirelessDebugging.kt).

Recommendation: investigate this as an optional, foreground **“Activate without Wi-Fi”** experiment. First prove authenticated helper restoration without recording audio. Do not advertise universal support, silent reboot recovery or automatic recording after boot.

## What actually needs restoration

Current wa-reco starts a detached helper through authorized ADB and requires actual shell UID 2000. Losing the transport need not kill a running helper, but reboot kills its process. Saved pairing keys authenticate a client; they do not start a disabled ADB daemon. Launching `app_process` from an ordinary app retains the app's privileges. [Android sandbox](https://source.android.com/docs/security/app-sandbox).

Current implementation anchors:

- `NativeWirelessAudioBridge` reconnects or starts the shell helper using saved pairing.
- `tools/usb-audio-helper/src/com/codaki/usbaudio/ShellAudioCompatibility.java` and `ShellAudioBootstrap.java` reject other UIDs.
- `tools/android-device-matrix/src/com/codaki/usbaudio/RuntimeAudioProbe.java --metadata-only` returns before audio capture initialization.
- The main app manifest does not currently declare the additional secure-settings/hotspot permissions for this experiment. No boot receiver is declared.

The AOSP 14, 15 and 16 release sources inspect an actual Wi-Fi station connection, including network ID and AP identity. Android 16's service enables ADB before delegating to its debugging manager; the manager clears the setting if the connection check fails. This ordering is compatible with the published timing explanation, but static inspection cannot prove that a race will succeed on a phone. The inspected AP check does not require internet reachability. [Android 14 manager](https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-14.0.0_r1/services/core/java/com/android/server/adb/AdbDebuggingManager.java), [Android 15 manager](https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-15.0.0_r1/services/core/java/com/android/server/adb/AdbDebuggingManager.java), [Android 16 manager](https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r1/services/core/java/com/android/server/adb/AdbDebuggingManager.java), [Android 16 service](https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r1/services/core/java/com/android/server/adb/AdbService.java).

## Candidate: a temporary local-only hotspot

The phone hosts a real temporary access point; it does not connect to itself. Android exposes `LocalOnlyHotspot` for local communication without internet. That API alone does not authorize wireless debugging. [WifiManager API](https://developer.android.com/reference/android/net/wifi/WifiManager#startLocalOnlyHotspot(android.net.wifi.WifiManager.LocalOnlyHotspotCallback,%20android.os.Handler)).

Shizuku-Next's pinned source repeatedly writes `adb_wifi_enabled` while a temporary hotspot provides an interface for endpoint discovery. Its retry window is bounded; the worker calls hotspot cleanup in `finally`. The hotspot class does not close a reservation delivered after callback cancellation, so normal cleanup is not proof that every timeout is covered. Its comments identify this as a platform timing bug. This is source evidence for an approach, not a wa-reco execution result. [Actual implementation, revision 97bb4d9](https://github.com/rushiranpise/Shizuku-Next/blob/97bb4d90903343edbbbadea823e7f98ca0875572/manager/src/main/java/moe/shizuku/manager/start/ForcedWirelessDebugging.kt), [worker cleanup](https://github.com/rushiranpise/Shizuku-Next/blob/97bb4d90903343edbbbadea823e7f98ca0875572/manager/src/main/java/moe/shizuku/manager/worker/AdbStartWorker.kt#L80-L92).

Automation needs `WRITE_SECURE_SETTINGS`, granted through an already authorized ADB session. It is not a normal permission dialog that a newly installed app can display. The fork checks and obtains it through an existing privileged server. A wa-reco experiment would need an explicit optional step during its initial successful setup, plus the appropriate hotspot permissions and a grant check on every recovery. [Grant implementation](https://github.com/rushiranpise/Shizuku-Next/blob/97bb4d90903343edbbbadea823e7f98ca0875572/manager/src/main/java/moe/shizuku/manager/start/StartPermissions.kt), [Android permission definition](https://developer.android.com/reference/android/Manifest.permission#WRITE_SECURE_SETTINGS).

Proposed user experience: after reboot, unlock the phone, open wa-reco and press one recovery button. The app explains any missing permission, temporarily creates the hotspot, attempts authenticated local ADB startup, verifies its own helper, then closes the hotspot. This could avoid an external network and an extra installed app. It still uses the Wi-Fi radio and previously approved debugging access. Successful recovery and subsequent network-independent operation must both be measured.

Published results differ by device:

| Device/build reported | Original evidence | Confidence |
| --- | --- | --- |
| Oppo Find N2 Flip / ColorOS / Android 16 | Hotspot reportedly allows wireless debugging directly, without repeated writes. [Report](https://github.com/thedjchi/Shizuku/issues/165#issuecomment-4105185851) | User report; not our test. |
| Galaxy S23+ / One UI 8.5 / Android 16 | Automation reportedly succeeds; same contributor later confirms Shizuku-Next works. [Initial report](https://github.com/thedjchi/Shizuku/issues/165#issuecomment-5116577200), [follow-up](https://github.com/thedjchi/Shizuku/issues/165#issuecomment-5904093228) | User report; not our test. |
| Oppo A15 / ColorOS 12.1 / Android 12 | Same contributor reports failure. [Report](https://github.com/thedjchi/Shizuku/issues/165#issuecomment-5116577200) | Demonstrates limits; also below wa-reco's current capture candidate boundary. |
| One UI 9 / Android 17 | Fork author suspects the workaround was patched. [October 6 comment](https://github.com/thedjchi/Shizuku/issues/165#issuecomment-6016098532) | Tentative author comment, not established behavior for all Android 17 devices. |

There is no wa-reco device result for this method. Android 14/15 source inspection does not establish recovery support on those versions. Recording capability and recovery capability are separate acceptance gates.

## Other routes

| Route | Research conclusion | Product implication |
| --- | --- | --- |
| Another phone's hotspot or a portable AP | Provides a real station connection; the inspected AOSP gate does not check internet reachability. | Useful fallback; exact offline-network flow still needs phone tests. |
| Second Android phone + USB data/OTG cable | Phone-to-phone ADB is documented by tool authors. A host could launch the existing detached helper directly, without TCP mode. [USB host API](https://developer.android.com/develop/connectivity/usb/host), [Bugjaeger FAQ](https://sisik.eu/bugjaeger_faq). | Could add “activate another phone” to the same APK; needs a second device and protocol/cable tests. |
| Small USB activation accessory | An active USB host can implement authenticated ADB; the author's example does so. [EspUsbHost](https://github.com/tanakamasayuki/EspUsbHost). | Separate hardware experiment, not a passive cable or a ready product. |
| Root / Magisk / Sui | Boot services can provide persistent privileged startup. [Magisk boot scripts](https://topjohnwu.github.io/Magisk/guides.html#boot-scripts), [Sui](https://github.com/RikkaApps/Sui). | Separate optional architecture. Current helper rejects UID 0; an adapter and device tests are required. |
| Manufacturer integration | Privileged permissions require the relevant firmware/allowlisting. [AOSP privileged allowlist](https://source.android.com/docs/core/permissions/perms-allowlist). | Requires manufacturer/custom-ROM cooperation. |
| VPN / imaginary Wi-Fi / self-connection | VPN creates a virtual interface; STA/AP concurrency does not establish self-association. No supported route found that supplies the ADB station identity this way. [VPN API](https://developer.android.com/reference/android/net/VpnService), [STA/AP concurrency](https://source.android.com/docs/core/connect/wifi-sta-ap-concurrency). | Do not pursue as a general recovery solution. |
| `adb tcpip 5555` once | Writes a volatile property; persistent fallback is not normally writable by app/shell under stock SELinux. [Restart source](https://android.googlesource.com/platform/packages/modules/adb/+/refs/tags/android-16.0.0_r1/daemon/restart_service.cpp), [adbd fallback](https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/daemon/main.cpp), [property mapping](https://android.googlesource.com/platform/system/sepolicy/+/refs/tags/android-16.0.0_r1/private/property_contexts), [property policy](https://android.googlesource.com/platform/system/sepolicy/+/refs/tags/android-16.0.0_r1/private/property.te). | Does not solve ordinary reboot recovery. UID 1000 alone also does not guarantee a SELinux property grant. |
| Device Owner / Dhizuku | DPC global-setting control does not confer shell identity or signature capture permissions. [DevicePolicyManager](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setGlobalSetting(android.content.ComponentName,%20java.lang.String,%20java.lang.String)), [Dhizuku](https://github.com/iamr0s/Dhizuku). | Device enrollment is not an equivalent recording privilege route. |
| Samsung FOTA system launch | The fork describes its route as an exploit, with foreground/device constraints. [Author README](https://github.com/rushiranpise/Shizuku-Next#readme). | Exclude from the proposed general consumer approach. |

## Bounded experiment to implement after owner choice

1. On an owner-controlled, unmanaged spare Android 14–16 phone, first try the normal hotspot-host wireless-debugging flow. Prefer a supported OEM behavior if it works.
2. If needed, build an isolated diagnostic APK with no recording permission. Use an explicit opt-in and the previously approved secure-settings grant. Refuse administrator restrictions; preserve existing pairing rather than bypassing authentication.
3. After an owner-performed reboot with no external AP, run a cancellable, bounded foreground recovery attempt. Verify an authenticated command executes as actual UID 2000, then run only `RuntimeAudioProbe --metadata-only`. This proves shell identity/capabilities, not helper restoration. A setting value, socket, mDNS advertisement or successful hotspot callback is insufficient evidence.
4. Launch the actual detached helper without sending any capture START command. Close every owned hotspot reservation, including callbacks arriving after cancellation/timeout. Stop retries and restore changed debugging state on every exit. Verify the helper's HMAC-authenticated readiness after that cleanup. If restoring state kills it, record failure rather than silently leaving debugging enabled.
5. Test at least Samsung, Pixel and one additional OEM across available Android 14/15/16 builds. Require five consecutive offline cold-boot recoveries per tested build, with cancellation, revoked-grant, locked-screen and hotspot-conflict cases. Record model/build, stage outcomes and elapsed time only. Audio/real-call tests follow separately after recovery passes.

Helper recovery is not automatic recording readiness. Android restricts launching microphone foreground services from the background or `BOOT_COMPLETED`; the initial experiment deliberately starts from a visible user action after unlock. Any later automatic boot flow needs its own platform and OEM validation. [Foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types), [background start restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start).

## Evidence and current status

Thirteen public primary-source files were downloaded inside `artifacts/research/offline-reboot-20261008/`; byte counts and SHA-256 hashes were verified against `primary-source-manifest.json`. AOSP sources pin release tags; fork source pins commit `97bb4d90903343edbbbadea823e7f98ca0875572`. The issue snapshot includes 57 comments. No fork binary was installed or executed.

No physical phone was available for this research. No reboot, permission/network change, call recording, APK build, Telegram delivery, public Git push or site deployment occurred. All project-specific evidence remains inside the original project folder. The research is complete; implementation of a new protected-setting recovery flow awaits the owner's architectural choice under the supplied GSD instructions.
