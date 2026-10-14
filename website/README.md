# wa-reco presentation website

Buildless Hebrew/English site for `https://wa-reco.codaki.com/`. Serve `dist/` directly; no package installation or build step is needed. Site registration, access, deployment, and the signed public APK are managed separately by the release owner. Local source or working DNS does not establish a public deployment.

The existing white/blue design and public audience are retained. On 2026-10-14 the owner authorized publication of 1.5.12. Site source `c8c5a7f74027aff252bb1c6a1e5fbaeec04be2f1` updates the three download links, repository name and bilingual reboot/local-recovery guidance. All 593 local browser checks passed. The APK and source/notices remain the exact previously verified release bytes. Local Inter/Assistant assets retain their OFL licenses and attribution in `dist/assets/fonts-notice.txt`.

## Local preview

From the repository root:

```powershell
python -m http.server 8768 --bind 127.0.0.1 --directory website/dist
```

Open `http://127.0.0.1:8768/`. The language preference is saved locally and shared with `privacy.html` and `terms.html`. All illustrative app details are synthetic: the page never accesses the microphone, Android permissions, notifications, or audio files.

Run the existing Python Playwright installation without adding dependencies:

```powershell
python website/check_site.py --url http://127.0.0.1:8768/ --output artifacts/website --browser-channel chrome
```

## Public download metadata

The release owner updates `dist/release-metadata.json` when a release is published, after verifying the signed public APK and its source-and-notice companion. Before publication it can contain `{"status":"pending"}`; that state leaves downloads disabled. A published release uses verified metadata such as:

```json
{
  "status": "ready",
  "url": "https://example.com/releases/wa-reco.apk",
  "version": "1.5.12",
  "sizeBytes": 12345678,
  "sha256": "<exact 64-character hexadecimal SHA-256>",
  "filename": "wa-reco.apk",
  "companion": {
    "url": "https://example.com/releases/wa-reco-source-and-notices.zip",
    "filename": "wa-reco-source-and-notices.zip",
    "sizeBytes": 12345678,
    "sha256": "<exact 64-character hexadecimal ZIP SHA-256>"
  },
  "applicationSource": {
    "url": "https://example.com/releases/wa-reco-application-source.zip",
    "filename": "wa-reco-application-source.zip",
    "sizeBytes": 1234567,
    "sha256": "<exact 64-character hexadecimal ZIP SHA-256>"
  },
  "sourceUrl": "https://github.com/didi6135/wa-reco/tree/<exact 40-character public source commit>"
}
```

The example is a schema illustration, not release evidence. The page requires both the APK and companion ZIP metadata, plus a source URL for the exact 40-character public GitHub commit. It accepts HTTPS file URLs or same-origin relative paths, a bounded version label, integer file sizes from 1 byte to 512 MiB, and exact 64-character hexadecimal checksums. Optional filenames must be safe ASCII names ending in the matching `.apk` or `.zip` extension. Invalid, missing, or pending metadata leaves every release download disabled. Rendering does not download or independently verify either file; the release owner verifies the published bytes, source correspondence, notices, and checksums.

The optional `applicationSource` object exposes the exact application source ZIP in addition to the companion. It uses the same ZIP validation; if present but invalid, all release downloads remain disabled. The companion includes source, license notices and modification/relinking instructions and remains required.

The browser checker checks actual served 1.5.12 metadata against independently pinned URLs, filenames, version, sizes, checksums and exact source commit, then isolates invalid/pending/network fixtures. It checks both languages, keyboard interactions, five widths, enlarged fonts, persistent policy navigation and no-JavaScript/storage fallback. These DOM checks do not download or verify APK/ZIP bytes; full published-byte verification is release-owner evidence. Use `--browser-channel chrome` or `msedge` to use an installed browser when Playwright's bundled browser is unavailable.

## Claim boundaries

- ARM64 Android7/API24+: installation and ordinary microphone recording; same-phone both-party WhatsApp capture has a higher requirement.
- Samsung S26 Ultra / Android 16: automatic recording and the correct optional call name were confirmed by the owner on that device. This does not establish all routes or devices.
- Android 14 / 15: experimental, requires device and audio verification.
- Android 13 and earlier: microphone only; no supported both-party same-device WhatsApp route.
- iPhone: this app provides no same-phone WhatsApp call recording.
- Initial helper activation needs Wi-Fi and Wireless debugging. An activated detached helper can continue without Wi-Fi; reboot or helper loss requires foreground reactivation before the call. Optional prepared local recovery is experimental and needs the Wi-Fi radio, but no external access point. Version 1.5.12 can show a reboot reminder; Android may require renewed consent and a retry. Boot alone does not start recording. WhatsApp still needs Internet.
- Local recording files remain on the phone. Optional call names default off, use a single eligible live notification label and fall back to a generic title; future recording/export names can contain that label. Older files are unchanged.
- Each installer chooses their own Drive account/folder or private Telegram bot. Connection alone does not upload; explicit backup enablement includes completed existing and future recordings. Three actual owner-selected-folder Drive uploads were verified in1.5.2. Default-folder/new-named uploads and real personal Telegram provider/device uploads remain separate acceptance. Local implementation and synthetic tests do not establish provider acceptance.

The public GitHub repository remains `didi6135/WhatsAppCallRecorder`. This website contains no OAuth credentials, bot tokens, backend, analytics, or external fonts.
