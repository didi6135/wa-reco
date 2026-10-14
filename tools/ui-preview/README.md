# wa-reco screen previews

## Current actual-source preview (19-01)

Run `node tools/ui-preview/render-current.cjs` then `python tools/ui-preview/capture-current.py` from the original checkout. Fixed output is `artifacts/ui-preview/current.html`, `current-source.json`, `current-manifest.json` and `current-*.png`. The renderer loads the actual React Native Settings, Setup and nested component TSX/styles, with bounded synthetic recording/permission/connection contexts. It never calls device, permission, capture or provider APIs.

The current capture checks Hebrew and English, 320/390/430px and 1.3x text, hashing every loaded source and rejecting stale input. Manual-ready/Auto-off, missing connection, first setup, service approval, optional Auto and retained paired setup have separate fixtures. The preview is a host render: Android font metrics, system dialogs, navigation and actual recording behavior need device verification. The earlier mirror below is historical; do not label it the current design.

## Historical browser mirror

The08-01 addition includes synthetic Google Drive Settings states: append `?screen=Settings&drive=disconnected|paused|ready|needsConsent|uploading|configuration&focusDrive=1` (choose one drive value). The account/folder/explicit enable controls simulate local visual states only; they never connect Google or upload files. Current native/component behavior is in DriveBackupCard/NativeDriveBackup and requires the separate Cloud/device acceptance. Root's36 width/text/state captures are in the ignored artifacts/drive-ui-preview directory.

This is a browser mirror of the React Native screens for reviewing the cleanup before an Android installation. It uses synthetic recordings, permission states and meter levels. It never records audio, opens device settings, reads phone data, or requests browser permissions.

Open `index.html` locally. The controls above the phone switch the screen and the synthetic state. The app navigation and setup buttons also work within the preview.

Run `python tools/ui-preview/capture.py` from the checkout to create the three-screen and onboarding review images plus the responsive-check manifest in `artifacts/ui-preview`. The capture requires a locally installed Python Playwright package and Chromium. No package is installed or added to the application.

The preview reproduces selected source copy, colors, spacing and screen structure at UI source819bcc9. The activation example shows the developer-options substep; wireless debugging, pairing and connection repair remain implemented in the Android application. The preview does not simulate every Android activation branch. Browser fonts and text metrics, permission dialogs, React Native navigation, keyboard behavior, accessibility services and actual recording/setup behavior still require Android verification.

Captures include the three main screens, five setup stages, completion and all six setup views at320/390/430 pixels with normal and1.3x text. Scrollable vertical content is intentional; the capture checks horizontal overflow and browser errors. The manifest hashes every listed React Native source and fails on a missing source path.
