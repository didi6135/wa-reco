# wa-reco

Hebrew/English Android recorder with three main screens: record, recordings and settings. The app includes guided setup, optional automatic WhatsApp/WhatsApp Business call detection and optional backup to each user's own Google Drive folder or private Telegram bot. It has no recording upload server. Change language in Settings; recordings and capture state remain in place.

## Use the app

Follow the setup walkthrough on the phone. Microphone permission, notification access and user-approved wireless debugging activation have distinct purposes. Developer options and wireless pairing require the phone owner's actions; ordinary microphone permission does not grant call-audio access. Initial activation needs Wi-Fi; an already activated helper can continue without Wi-Fi, subject to the phone's process lifecycle. Reboot or process termination may require activation again.

Optional **experimental activation without an external Wi-Fi network** adds a guided preparation step and an explicit recovery button after reboot. It requires a previously authorized secure-settings grant and Nearby devices permission, temporarily uses a local-only hotspot, and verifies the detached helper after restoring settings and releasing that hotspot. It is off by default, depends on firmware and does not automatically arm recording after boot. See [setup and limitations](docs/offline-recovery-setup.md).

If paired automatic recording was enabled before a restart, version 1.5.12 posts a **Resume automatic recording** reminder after the phone is unlocked, subject to Android notification settings. Tap it to open the visible setup screen and restore the previously enabled mode using existing grants and prepared activation. Keep the app open until readiness is verified. Missing permissions, an active call or unavailable activation require a manual repair; there is no background retry. The reminder alone never starts a helper or microphone service. With local recovery prepared, the Wi-Fi radio needs to be on during activation but no external Wi-Fi network or computer is required. Physical reboot/reminder behavior on each phone remains a device test.

Google Drive backup is optional. In Settings, connect **your own Google account** to create or reuse this installation's `wa-reco` folder, or choose an existing writable folder with Google's picker. Check the displayed account and folder, then explicitly enable backup of existing and future completed recordings. Uploads go directly from your phone to the selected Drive destination. Disconnecting preserves local recordings and uploaded files. The app publisher's OAuth registration identifies the app; it is not the destination account. See [Drive setup](docs/google-drive-setup.md).

Telegram backup is a separate opt-in. Create a dedicated private bot through BotFather, enter its token in the app, open the connection link and confirm the private chat. Enable backup only after that connection is confirmed. Long recordings are sent as playable lossless WAV parts; the original remains on your phone. A missing receipt is shown as an unknown outcome and requires your confirmation before a potentially duplicate retry. See [Telegram setup](docs/telegram-backup.md). The maintainer's delivery bot is never built into the application.

Read [privacy and data handling](docs/privacy.md) for permissions, local storage, cloud recipients and deletion controls.

Call setup uses the **paired wireless-debugging connection**. The accessibility microphone experiment is no longer offered: it did not provide a separate remote-call audio channel. Installations that selected it are guided through an explicit return to the paired connection, preserving recordings and pairing and requiring separate automatic-mode activation. See [current guided setup](docs/clean-setup.md) and the [historical experiment](docs/no-pairing-experiment.md).

## Compatibility and verification

See the [measured Android 13–16 matrix](docs/android-device-compatibility.md) and
[reproducible probes](tools/android-device-matrix/README.md). Synthetic framework
capture passed on Android14/15/16 emulators; stock OEM WhatsApp calls are a
separate test. The owner accepted1.5.6 and reported recovery after reboot without
USB or an external Wi-Fi network; the agent's separate Samsung/API36 measurement
kept USB debugging enabled. Versions1.5.7 through1.5.9 offered a no-pairing
microphone experiment. Version1.5.10 restores the paired setup after a missing
remote-voice report on another phone; it does not establish that phone's support.
Version1.5.11 restores offline preparation in clean Settings, uses already-prepared
local recovery for explicit activation and shows automatic recording status on Home.
A live helper needs no permanent Wi-Fi connection. After reboot, open the app and
activate before the call; local recovery needs the Wi-Fi radio on but no external network.
Version1.5.12 adds a reboot reminder and guarded one-tap foreground restoration of
previously enabled paired Auto. Native/frontend tests and release checks do not
establish physical reboot notification delivery or two-party audio on another phone.

- Installation: Android 7/API 24 or newer, ARM64. Installation does not imply two-sided call recording support.
- Call-recording helper: Android 14/15 experimental candidates; Android 16 behavior has been exercised on a Samsung S26 Ultra. Other phones, OEM policies, headphones/Bluetooth and call cases require device tests.
- Android 13 and older: the current two-sided call helper rejects these versions. Ordinary microphone recording is separate; the former accessibility experiment is not a supported call-recording alternative.
- Native Drive authorization requires Google Play services and a registered Android OAuth client. The hosted connection has reached a selected account/folder on the tested Samsung; actual upload and the new default-folder route still require device/provider verification. Google services are external dependencies; an open-source app does not make these SDKs or services open source.
- This repository does not provide an iPhone implementation that records both parties of another app's WhatsApp call.

## Build your own Android app

Use Node.js 22, npm, JDK 17 and Android SDK 36/build tools 36.0.0/NDK 28.2.13676358. Local checks used Node.js 22.23.2. The checked-in native project uses React Native 0.77.3, Expo 52, Gradle 8.11.1 and Android Gradle Plugin 8.9.2. Keep the native Android project; `expo prebuild --clean` would replace the custom native services.

```sh
npm ci
npm run typecheck
cd android
./gradlew :app:assembleDebug
```

On Windows, use `gradlew.bat` and quote dotted property arguments, for example `'-PwaRecorder.applicationId=org.example.myrecorder'` in PowerShell. Configure your own Android SDK location through `ANDROID_HOME` or an ignored `android/local.properties`. The debug APK contains its JavaScript bundle and uses the conventional public Android debug key. It must not be used as a release key.

For a release, create your own private keystore and copy [the signing template](docs/signing.properties.example) to a private location outside the checkout. Set `WA_RECORDER_SIGNING_PROPERTIES` to that file's absolute path, then build:

```sh
./gradlew :app:assembleRelease -PwaRecorder.applicationId=org.example.myrecorder
```

The release build adds `.standalone`, producing `org.example.myrecorder.standalone`; debug adds `.diagnostic`. Register that exact installed ID and **your own signing certificate SHA-1** with Google. The Java/Kotlin namespace can remain unchanged. Forks should use a distinct application ID and key; they cannot update the publisher's installed APK with a different signing key. Release builds fail when private signing configuration is missing and never fall back to the debug key. No `.env`, Telegram account, Google API key or Google client secret is required to build or run the app.

To print a built APK's public certificate fingerprint, use Android SDK `apksigner verify --print-certs path/to/app-release.apk`. Certificate fingerprints are public; keystore passwords and private keys are not.

## Source distribution

Original project code uses [0BSD](LICENSE). Dependencies retain their own licenses, including Apache/BSD/MIT and LGPL; read [third-party notices](THIRD_PARTY_NOTICES.md) before distributing modified binaries.

For a public source snapshot, run `python tools/export-public-source.py --output artifacts/whatsapp-recorder-source.zip` after committing the intended changes. The exporter uses committed files, excludes private planning/Git history, recordings, environment/signing files and local artifacts, and rejects obvious credential material. Inspect its manifest before creating a new public repository. The development checkout's private Git history is not the public source snapshot.

The sanitized public source is at [GitHub](https://github.com/didi6135/wa-reco). The bilingual presentation/download website source is in [website](website/README.md). APK download links are enabled only with verified release metadata and accompanying source/notices. See [repository history and frozen release snapshots](docs/repository-history.md).

Local compile/unit checks are separate from real phone recording, Google OAuth and cloud upload acceptance. Existing-folder Drive uploads were verified on the owner's S26 in1.5.2. Default-folder creation/reuse, personal-bot Telegram pairing/upload and actual call-label availability remain separate device/provider checks. This source package does not establish Google branding/domain verification or compatibility with every device.

## Optional call names

Enable **Save call names** in Settings to include a display label supplied by a live WhatsApp/Business call notification in future recording titles and shared/cloud filenames. This setting starts off on new and updated installations. No new contacts permission is requested. Labels are not verified identities; missing or ambiguous names keep a generic title, and a group call may not expose all participants. Internal local recording IDs and paths, old recordings and existing provider receipts remain unchanged. Disabling affects future recordings and does not remove already shared filenames.
