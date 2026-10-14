# Repository history and release snapshots

On 2026-10-07 the existing public repository was renamed from
`didi6135/WhatsAppCallRecorder` to [didi6135/wa-reco](https://github.com/didi6135/wa-reco).
It is the same GitHub repository, ID 1407834133. Its existing Git history, release
tags and release assets were retained; this was not a replacement repository or
an export of private development history.

Use the new address for clones and links:

```sh
git remote set-url origin https://github.com/didi6135/wa-reco.git
```

GitHub redirects the former repository address. Old 1.5.4 download links were
checked against the same asset bytes and SHA256 values as the new URLs. New
links should use the canonical address rather than depend on those redirects.

Published releases are frozen distribution snapshots. Renaming the repository
does not change an APK, application-source ZIP, corresponding-source/notices
ZIP, tag commit or checksum. Existing archives and their embedded manifests are
not rewritten just to update an address. For example, `v1.5.4` remains bound to
public commit `d1c9118494edef482ffa3d725fde5f6a7ec5e0f7` and its original three
release assets.

`SOURCE_MANIFEST.json` records the source snapshot used for that release. Later
documentation commits on `main` can differ from those recorded file hashes;
the manifest is not silently updated to claim that those documentation changes
were present in the already published APK. Use the release tag and matching
archives when checking an exact distribution. Future application releases need
their own newly exported source, manifests and verified artifacts.
