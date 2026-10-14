# wa-reco privacy and data handling

Updated 2026-10-12. This describes the source implementation; successful device recording and provider uploads require separate testing.

## Recording and permissions

Audio and recording metadata are saved in the app's private storage on your phone. The app has no maintainer recording server or shared backup destination. Manual capture starts when you press Record. Automatic capture requires you to enable it and uses supported WhatsApp/WhatsApp Business call notifications and fresh Android call/audio ownership signals. Recording has a visible Android foreground notification and can be stopped.

Android notification access is broad. The app filters WhatsApp and WhatsApp Business call notifications; it does not read message content or request access to your contact database. Optional **Save call names** is off by default. If you enable it, the app reads a bounded display label supplied by a single eligible live call notification and stores it with that recording. A label can itself be a name or a phone-like number; it is not a verified identity. The app does not extract participant account/phone URIs or promise all group participants. Ambiguous or unavailable labels keep the generic recording title. Microphone access records audio. Developer settings and wireless debugging activate a local helper with Android's shell permissions after your approval; the app does not obtain WhatsApp encryption keys or private WhatsApp files.

Saved call labels appear in recording titles and filenames used when you share or back up a named recording. With a backup enabled, the receiving provider therefore also receives that filename. Disabling name saving affects future recordings; it does not rewrite existing recordings or provider copies. Older recordings have no saved participant identity to fill automatically.

Optional experimental offline activation is off by default. After an explicit preparation action, an already authorized ADB connection grants this installation `WRITE_SECURE_SETTINGS`, a broad protected Android setting permission. This feature uses it only to temporarily enable wireless debugging and restore the prior setting. Nearby devices permission allows requesting a local-only hotspot; the app does not derive location from Wi-Fi. Recovery starts from a visible user action, uses the existing private pairing identity and closes its owned hotspot on completion or cancellation. It sends no recording START command. Disabling the option prevents further use but does not necessarily revoke the protected grant at Android level. See [offline activation setup](offline-recovery-setup.md).

After a phone restart, wa-reco may post a generic local reminder if you previously enabled paired automatic recording. It uses Android's boot-completed broadcast and your saved Auto preference, without reading call names, messages, contacts or audio. The reminder obeys Android notification permission and channel settings. Its explicit action opens the visible app and requests a single restoration of the existing choice after fresh permission, activity, idle-call and connection checks. Restart delivery or an ordinary app launch does not start capture, activate the helper or arm Auto. Turning Auto off revokes a pending restoration. No restart data is sent to a maintainer server.

The former **accessibility microphone experiment** is no longer offered in normal setup or call controls. Legacy installations are guided through an explicit return to the paired system-helper connection; changing modes disarms Auto and preserves recordings and pairing. The legacy service definition remains for compatibility and does not retrieve screen/window content, subscribe to UI events or click/approve settings. No new accessibility approval is requested by current setup. Permission approval, pairing and helper connection do not start capture or arm Auto. Existing experimental recordings remain labeled with unverified remote audio; they are not converted to verified two-party recordings. See [current setup](clean-setup.md) and the [historical experiment](no-pairing-experiment.md).

App diagnostics may contain recording IDs, duration, byte counts, channel/silencing/gap status and app-owned error codes. They do not intentionally log call labels, audio, bot tokens, Google access tokens, private-chat messages or raw provider responses. Do not post credentials or private recordings in public issue reports.

## Optional cloud backup

Google Drive and Telegram are independent and off until you explicitly enable the corresponding backup. Enabling includes existing and future completed recordings. Each service receives the audio you choose to back up; review that choice before enabling.

- **Google Drive:** Google handles account selection and authorization. The app uses the resulting access grant only for the selected Drive backup destination and permitted file operations. It sends finalized audio directly to Google's API. Existing-folder uploads were verified on the owner's S26 in1.5.2; other accounts/devices and the new default-folder path remain separate checks. Google's own terms and privacy policy apply.
- **Telegram:** You provide a dedicated bot token and confirm a private chat with a temporary Start link. The app verifies bot/chat identity and sends finalized audio directly to Telegram as lossless WAV parts. Bot credentials, private-chat binding, temporary challenges and upload receipts are stored in an authenticated AES-GCM journal with an Android Keystore key, in storage excluded from Android backup. Private bot chats are Telegram cloud chats, not Secret Chats. Telegram's own terms and privacy policy apply.

The app's normal Android automatic backup is disabled. Tokens and keys are not included in the public source, APK release metadata or app status. No maintainer `.env` credential is embedded in the APK.

## Your controls

You can listen, share or delete local recordings in the app. Sharing gives the chosen receiving app access to that file. Disable a backup to stop scheduled uploads, or disconnect its account/bot to remove the active connection. An in-progress request already accepted by the provider cannot be recalled. These actions do not delete files already uploaded to Drive or Telegram; manage those in your own provider account.

Telegram's encrypted receipt history is retained after disconnect so confirmed parts are not silently resent when you reconnect the same destination. Reinstalling or clearing app data removes local settings, credentials and local files, subject to Android's storage behavior; it does not delete provider copies. Revoke a compromised bot token through BotFather and revoke Google access through your Google account controls.

## Website and third-party services

The presentation website uses local browser storage for its language preference. It has no project analytics, recording upload form or microphone access. Hosting providers handle their own platform/network data. Download/source/issue links lead to GitHub; bot setup leads to Telegram; cloud connection uses Google services.

Service policies: [Google](https://policies.google.com/privacy), [Telegram](https://telegram.org/privacy), [GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Source and questions: [project repository](https://github.com/didi6135/wa-reco).
