# Release verification and delivery

Use the original checkout and the existing Android outputs. `release.py` never builds, installs or publishes. Every mode requires the exact tested source commit and explicit version/code; these must match the frozen application source and actual signed APK. The persistent publisher key and separate modified-build key remain private operator inputs.

There is one active output directory, `artifacts/release/`, with fixed names:

- `wa-reco.apk`, `application-source.zip`, `source-and-notices.zip`.
- `normal-verification.json`, `release-pins.json`, `delivery-pins.json`, `runtime-inventory.json`.
- `normal-snapshot/`: only the bundle/map, resolved runtime, successful normal build log and required Cxx evidence.
- `telegram-apk-caption.txt`, `telegram-companion-caption.txt`: reviewed operator captions beginning with the exact `wa-reco <version> ` prefix.

Existing approved release files, notice/source inputs and immutable Telegram attempt/receipt files stay in their existing locations. The exact publisher archive cache is reused at `artifacts/release-1.5.5/publisher-archives/`; it is not copied into a new version directory. Frozen active files remain exclusive by default. The deliberate preservation flow below permits the next final release to reuse those same filenames.

## Preserve an accepted release before output reuse

`retain-approved` creates the single fixed `artifacts/release/approved-release.zip`. It contains only the latest owner-approved APK/source/companion, exact normal and modified-build evidence, all29 normal snapshot files, reviewed captions and the four already verified Telegram attempt/receipt files. It does not collect ENV, private signing keys, recordings, dependency caches, arbitrary project files or a copied checkout. It is private rollback evidence: never public-export or send this archive.

The operator must supply the exact existing release-pins SHA256 and explicitly attest owner acceptance. The helper verifies the delivered Git source and signed APK, all existing pins/snapshots, the modified rebuild, ready companion and matching delivery receipts without requiring the older runtime source to equal the newer checkout. It then rechecks all input bytes before writing the archive. No active release file or Telegram receipt is deleted or moved. Unrecognized output files, links/junctions, incomplete evidence and incorrect pins fail closed.

```powershell
python tools/release-compliance/release.py retain-approved --source-commit 011ebe38270165ebb32f5856a506ef7359add444 --version 1.5.6 --version-code 17 --approved-release-pins-sha 52a93c3187d7aad651a5b2fc01ccff79044ac7b15b7d17ba1d844799848fde95 --owner-accepted
$recoApprovedSha = '<approvedArchive.sha256 returned by retain-approved>'
```

Only `--replace-approved $recoApprovedSha` permits canonical successor output creation. Each mutation rehashes the preserved archive and its members, checks that untouched outputs still equal the preserved bytes and checks already produced successor outputs against the source/version-bound replacement journal. Unknown, missing or changed output files block the next mutation. Each new-source output can be written once; repeated or interrupted operations require review. Newly produced stage files live only in the existing `scratch/` directory and are promoted to the same canonical filenames. A failure between output and journal promotion fails closed rather than guessing recovery.

The archive holds one accepted release, not an accumulating history. A later owner-accepted release can replace that archive only with an explicit `--previous-approved-sha` pin, after all current evidence and receipts have passed the same retention checks. The exclusive fixed archive stage is parsed and every member/identity compared with the current evidence before promotion; the previous archive and all current bytes are rechecked and the stage's final byte pin must still match. Interrupted or tampered stages preserve the previous rollback and require review. Earlier immutable receipt files and historical publisher/source inputs remain unchanged.

```powershell
python tools/release-compliance/release.py retain-approved --source-commit 4f7974a670c44308b9bb7d3e9f58557211f4eb83 --version 1.5.7 --version-code 18 --approved-release-pins-sha 2cafbbda4c29a6142792f2bd5ca4c67b43bfc77ef8527b6cc12d44cc49d39a39 --previous-approved-sha 6e0f3f2b4d4516562fd8fa00f3d9ef78db61852eebee5a46eaaf6c89fecfce17 --owner-accepted
$recoApprovedSha = '<new approvedArchive.sha256 returned by retain-approved>'
```

## Delivered release without owner acceptance

Do not attest acceptance just to reuse the canonical output. When the current
delivered release is still pending acceptance, keep `approved-release.zip`
unchanged and preserve the current candidate in one fixed private
`artifacts/release/delivered-candidate.zip`. It uses the same source/signature,
normal snapshot, modified rebuild, ready companion, journal and four immutable
Telegram receipt/attempt checks. Its manifest says `ownerAccepted: false` and
binds both exact current release/delivery pins and the approved archive SHA.
Neither private archive is public-exported or sent. No version directory,
copied checkout or deletion is involved.

For the delivered1.5.8/code19 with accepted1.5.7 retained:

```powershell
$recoApprovedSha = 'f9df93035ecc4e8934e95b21705fabc5ab0631c3fa1654c2fb3cc2dea2bf4a03'
python tools/release-compliance/release.py retain-candidate --source-commit f3db18a9807968c33e36b26866d2f8b624840598 --version 1.5.8 --version-code 19 --current-release-pins-sha 7b58dd556b8d8e20aaad3df5bfc05e29cd47ad593b25a8f88f767b8da4145565 --current-delivery-pins-sha 0092ee085dadbc9b9d75d4d0a75a8edc718df766e0d9d8083712764b9cee8451 --approved-archive-sha $recoApprovedSha
$recoCandidateSha = '<candidateArchive.sha256 returned by retain-candidate>'
```

The fixed exclusive candidate stage is verified before atomic promotion. All
current evidence/receipt bytes, the active file set, the approved archive and
the staged final pin are rechecked immediately before promotion. Interrupted
or changed files fail closed. Existing candidate replacement requires its exact
`--previous-candidate-sha` and a strictly later version/code/source; unknown
existing bytes cannot be overwritten.

For the successor use both `--replace-approved $recoApprovedSha` and
`--replace-candidate $recoCandidateSha` on every canonical creation mode below.
Untouched expected bytes come from the preserved candidate; the first mutation
accepts only its exact saved old journal and starts a new source/version-bound
journal. Both archives are verified before every mutation, and each successor
output can be written once. The new normal proof also retains the candidate
SHA, so later verification does not depend on CLI replacement flags. Its
physical acceptance remains pending. A candidate can never be read as an
owner-approved rollback.

## Final source and normal build

Finish the actual runtime/UI checks and commit before exporting. Do not export preliminary source snapshots.

```powershell
$recoFrozenCommit = '<exact-tested-application-commit>'
$recoVersion = '1.5.9'
$recoCode = 20
$recoReleaseArgs = @('--source-commit', $recoFrozenCommit, '--version', $recoVersion, '--version-code', $recoCode)
$recoReplaceArgs = @('--replace-approved', $recoApprovedSha)
# When advancing a delivered but unaccepted candidate, also bind its exact SHA:
if ($recoCandidateSha) { $recoReplaceArgs += @('--replace-candidate', $recoCandidateSha) }
python tools/release-compliance/release.py export-source @recoReleaseArgs @recoReplaceArgs
python tools/release-compliance/release.py review-draft @recoReleaseArgs @recoReplaceArgs
```

Read the actual frozen changes listed in `artifacts/release/input-review-draft.json`. Prepare `artifacts/release/scratch/reviewed-inputs.json` with that exact source/hash-bound row set and set its review flags only after checking the build/export/license effects. `accept-review` validates those rows before installing the canonical receipt. Dependency coordinates, lock contents and runtime graph changes cannot be waived by that receipt. The clean-tree/source guard allows only committed `.planning/` metadata after the freeze. `export-source` additionally requires the exact final frozen HEAD, so export before a later metadata commit.

```powershell
python tools/release-compliance/release.py accept-review @recoReleaseArgs @recoReplaceArgs --review-file artifacts/release/scratch/reviewed-inputs.json
```

```powershell
$env:JAVA_HOME = 'C:/Program Files/Android/Android Studio/jbr'
$env:WA_RECORDER_SIGNING_PROPERTIES = Join-Path $env:LOCALAPPDATA 'Codaki/WhatsAppRecorderRelease/signing.properties'
& ./tools/build-android.ps1 -ReplaceLog -Tasks @(':app:assembleRelease', ':app:writeReleaseRedistributionInputs') -GradleArguments @('--offline', '--console=plain', '--max-workers=2', '--no-daemon', '--init-script', '../tools/release-compliance/recombine.init.gradle', '-PwaReco.inventoryOutput=../artifacts/release/scratch/release-stage-runtime.json')
python tools/release-compliance/release.py accept-inventory @recoReleaseArgs @recoReplaceArgs --inventory-file artifacts/release/scratch/release-stage-runtime.json --build-alias W
python tools/release-compliance/release.py snapshot-normal @recoReleaseArgs @recoReplaceArgs --build-alias W --build-log artifacts/workspace/android-build/native-build.log --review-file artifacts/release/input-review.json
python tools/release-compliance/release.py freeze @recoReleaseArgs @recoReplaceArgs
python tools/release-compliance/release.py verify @recoReleaseArgs
```

Use the actual alias letter if W was unavailable. `accept-inventory` checks the exact reviewed graph and every resolved artifact before promoting the new inventory stage; Gradle never overwrites a retained active release file directly. The wrapper maps the same physical root without copying it. Every invocation uses `artifacts/workspace/android-build/native-build.log`; the legacy `-LogGroup` argument is accepted but does not create another directory. Default execution refuses an existing canonical log. Deliberate `-ReplaceLog` overwrites only that current log, with an exclusive writer; preserve its normal-release proof before the modified build. Old timestamped logs are left unchanged.

Normal verification retains the strict actual signer/package/version/code/nondebuggable/SDK and18 ARM64 ELF/ZIP16KB checks, memory-only configured-value scan, exact frozen Git/source and Metro application binding, fresh147-row runtime graph with actual artifact hashes,446 notice hashes, locked publisher source comparisons,84 generated-source hashes, six exact current Cxx targets and two independent strip reproductions. The other13 native/font entries remain pinned to prior bytes. Expo's492 publisher source files and every actual compiled input are bound individually. No unavailable historical build-tree equivalence is inferred.

`hydrate-reviewed-archives` prints a credential-free missing-archive plan. Only an explicit `--fetch` may fetch exact pinned registry archives, with prior SHA256/size and locked SHA512 checks. Normal verification is network-free and refuses missing or changed archives; do not reinstall dependencies to bypass it.

## Modified-library proof and source companion

Review `docs/rebuild-spake2.md` and current installation instructions. Prepare both current version captions in `scratch/` and use `set-caption` to validate and install them before companion assembly. Describe measured phone results accurately; experimental or pending physical tests must remain explicit. Helper readiness and automatic-recording opt-in are separate actions.

```powershell
$recoApkCaption = 'artifacts/release/scratch/reviewed-apk-caption.txt'
$recoCompanionCaption = 'artifacts/release/scratch/reviewed-companion-caption.txt'
python tools/release-compliance/release.py set-caption @recoReleaseArgs @recoReplaceArgs --kind apk --caption-file $recoApkCaption
python tools/release-compliance/release.py set-caption @recoReleaseArgs @recoReplaceArgs --kind companion --caption-file $recoCompanionCaption
$recoChangedAar = (Resolve-Path -LiteralPath artifacts/workspace/private-build/spake2/android/build/outputs/aar/android-release.aar).Path
$recoOwnSigning = (Resolve-Path -LiteralPath artifacts/workspace/private-build/signing/signing.properties).Path
& ./tools/build-android.ps1 -ReplaceLog -Tasks @(':app:assembleRelease') -GradleArguments @('--offline', '--console=plain', '--max-workers=2', '--no-daemon', '--init-script', '../tools/release-compliance/recombine.init.gradle', ('-PwaReco.spake2Aar=' + $recoChangedAar), ('-PwaRecorder.signingProperties=' + $recoOwnSigning))
python tools/release-compliance/release.py prepare-companion @recoReleaseArgs @recoReplaceArgs --installation-instructions-reviewed
```

The helper checks actual separate own-key signing, identical frozen app JS, exact modified-library source/AAR and recombination evidence. The companion's existing mechanical checks and `require_ready` gates stay mandatory. Its temporary staging remains inside the same canonical output. It contains no normal private build snapshots/logs, ENV, private keys or recordings. Mechanical verification is not legal certification or physical phone acceptance.

## Authorized Telegram delivery

Root must decide to perform the send under the owner's standing delivery instruction. Without `--send`, the helper prints a plan and reads no credentials. Each actual send resolves the current configured destination, including when reusing an existing success receipt.

```powershell
python tools/release-compliance/release.py send --source-commit $recoFrozenCommit --version $recoVersion --version-code $recoCode --kind companion
python tools/release-compliance/release.py send --source-commit $recoFrozenCommit --version $recoVersion --version-code $recoCode --kind companion --send
python tools/release-compliance/release.py send --source-commit $recoFrozenCommit --version $recoVersion --version-code $recoCode --kind apk --send
```

The source companion must have a verified receipt for the same destination/source before APK delivery. Attempts and receipts are immutable, version-scoped files under `artifacts/telegram/`. The source/file/caption hashes, exact provider document filename/size, destination and message ID must match. An uncertain attempt blocks automatic retry; private token URLs/provider errors remain suppressed.

## Local checks

```powershell
python tools/release-compliance/test_release.py
python tools/public-source-tests/test_export.py
```

For the existing companion tests, set Python `tempfile.tempdir` to project-local `artifacts/release/scratch/` before running `test_release_bundle.py`; synthetic test files are removed afterward. These checks exercise operator gates; they do not build, send or establish successful recording on a phone.
