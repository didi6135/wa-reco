"""Source-bound release evidence and explicit owner delivery. Never builds.

Run snapshot-normal BEFORE a modified rebuild. All project-specific snapshots
and strip staging remain in this original checkout. Historical artifacts are
read-only inputs. No mode publishes source, installs an APK or alters a device.
Only `send --send` contacts Telegram; credentials stay in memory.
"""
from __future__ import annotations

import argparse
import base64
import copy
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import redirect_stdout
import datetime as dt
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import struct
import subprocess
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request
import uuid
import zipfile
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/release'
ARTIFACTS = ROOT / 'artifacts'
VERSION, CODE = None, None
# Reuse the existing exact publisher cache in place; do not copy it per release.
PUBLISHER_CACHE = ARTIFACTS / 'release-1.5.5/publisher-archives'
PACKAGE = 'com.didi4164.WhatsAppCallRecorder.standalone'
CERT = '2668e4ec607dba1e1a7639bc5b21e8f366c3e461111a54147a2626efea08922f'
MOD_CERT = '9e0710087b127db1d1aa781acf66c1bfb1bd3079df089e9f7a6e0d1f120067c1'
MOD_AAR = ARTIFACTS / 'workspace/private-build/spake2/android/build/outputs/aar/android-release.aar'
MOD_AAR_SHA = 'ebcca6a4c38bbe499d58041b4db9d57718047d6dfcf8b2db878b19714edd2c36'
STRIP_SHA = '2d411db64e0b45508775e9e8fd436fb6e0af814a9dfbf8aea8fc37ce436c435c'
OLD_COMMIT = 'de083696c93695f3b4e5a50e31a9227b2a47d979'
OLD_NATIVE_PROOF = ARTIFACTS / 'release-1.5.4/native-provenance/native-provenance.json'
OLD_NATIVE_PROOF_SHA = '4c0614c0addef85d0a62373737888d3866f1fd02dfbff262acabac94e5b9f3d8'
BASE_SOURCE_SHA = 'e78468280ea49572a7e0be443989c7cbf0aa0c4994617751d30705787ed635c8'
PINS = {
    'wa-reco-1.5.0.apk': '434c50467d6c5e94d7c5e00866e8960f96fc37d219db9a47f9bdcc498b9f0c7a',
    'wa-reco-1.5.0-application-source.zip': 'e89a1b9c5cd4085e0a30223a3245318715631854cb0f169707898866d21774a2',
    'runtime-inventory-1.5.0-reviewed.json': '6dd3d3822e5224f2c03197306ad79ec507c79abefa51fc89bc0ae74b3867af91',
    'runtime-final-review.json': '957b78b2204de1e73a6f15897e0a80255d65b5ed30de992eeb4951d1e0fc0e4a',
    'runtime-review-1.5.0-signoff.json': 'd3f283678c7f1058892da83fd3bc00592e575c657ea07e2a049d8db14f37d736',
    'runtime-notice-text-manifest.json': 'dd3cfd196afaf8169580609cb610c5a7525c0edeabb894f06173b6566b1892fd',
    'resolved-runtime-final-private.json': '35b01f9c75f5c1ef31eb9209e3ec8a8bd97bd6b7c180cee72d0b62dddabc726e',
    'runtime-packaging-review.json': '06397fc1343473577cebbb92eff989aa10c26a50826702b7a41bff66eea53001',
    'runtime-npm-notice-observations.json': 'a10c4e89e803a0f8105ca6445f19175105bd10b200c9af11e0e2a1d048c1790c',
    'runtime-source-notice-observations.json': '03cadb27bc5bd2e5826cf3b348d69633df5faae0b3866790617ab8c1df9dd0ed',
    'runtime-upstream-provenance.json': '600bc184e1cf79da706fe4abc17f254a293bafb76542c0a6e05a7a7263e41df8',
    'spake2-1.5.0-corresponding-source.zip': 'd2bc11a68340115be6bf6bdf8eaf6def004f231b99d749ff4d17f88e224d6245',
    'modified-spake2-1.5.0-source.zip': '3b0925a02996b631e5a3738896f546608a4efadf2b0ec900739c62fbf42a4036',
}
PROJECT_LIBS = {
    'libappmodules.so': None, 'libgesturehandler.so': 'react-native-gesture-handler',
    'libreact_codegen_rnscreens.so': None, 'libreact_codegen_safeareacontext.so': None,
    'librnscreens.so': 'react-native-screens',
    # Rebuilt after one-root Cxx staging consolidation; accepted only with exact
    # publisher sources plus current compiler/target/merged/two-strip proof.
    'libexpo-modules-core.so': 'expo-modules-core',
}
EMPTY_PNG_ASSETS = {
    'lib/module/assets/back-icon.png': ('84cf5eb3b20250f69e0e4733beb4da5f417f0682892a5ad1b5e62570753c21b1', 'backicon'),
    'lib/module/assets/back-icon-mask.png': ('9adb8c5efca932e2b732b293da813bd2e31952263056bce9e2517fec0f0b6a76', 'backiconmask'),
    'lib/module/assets/clear-icon.png': ('c86bb485eee687e06c500fc4234f51a6784b4530c2ae11d0c76481110bce3105', 'clearicon'),
    'lib/module/assets/close-icon.png': ('2325c53a73e54c438cbbc60dffdd8b513d471ba42e2f56713ef404b95e0ca1fc', 'closeicon'),
    'lib/module/assets/search-icon.png': ('5d075e0c287c4f4441b5b5c8fc7ea5cd27c11bb617ecea09755955bcb1889083', 'searchicon'),
}
APK = OUT / 'wa-reco.apk'
SOURCE = OUT / 'application-source.zip'
COMPANION = OUT / 'source-and-notices.zip'
INVENTORY = OUT / 'runtime-inventory.json'
NORMAL = OUT / 'normal-verification.json'
SNAPSHOT = OUT / 'normal-snapshot'
FROZEN = OUT / 'release-pins.json'
APPROVED = OUT / 'approved-release.zip'
CANDIDATE = OUT / 'delivered-candidate.zip'
REPLACEMENT = OUT / 'replacement-state.json'
REPLACEMENT_SHA, REPLACEMENT_COMMIT, CANDIDATE_SHA = None, None, None
ACTIVE_NAMES = {
    'wa-reco.apk', 'application-source.zip', 'source-and-notices.zip',
    'normal-verification.json', 'release-pins.json', 'delivery-pins.json',
    'runtime-inventory.json', 'resolved-runtime-private.json',
    'input-review-draft.json', 'input-review.json', 'recombination-check.json',
    'wa-reco-modified-recombination.apk', 'telegram-apk-caption.txt',
    'telegram-companion-caption.txt', 'replacement-state.json',
}


class ReleaseError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise ReleaseError(message)


def configure_release(version, code):
    """Set an explicit expected identity, subsequently checked against source."""
    require(isinstance(version, str) and re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', version),
            'Expected release version must be an explicit numeric version')
    require(isinstance(code, int) and not isinstance(code, bool) and 0 < code <= 2100000000,
            'Expected release version code is invalid')
    global VERSION, CODE
    VERSION, CODE = version, code


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(path, maximum=256 * 1024 * 1024):
    path = Path(path)
    require(path.is_file() and not path.is_symlink() and 0 < path.stat().st_size <= maximum,
            'Required bounded regular input is unavailable: ' + path.name)
    data = path.read_bytes()
    require(len(data) <= maximum, 'Input exceeded size limit')
    return data


def unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'Duplicate JSON key')
        result[key] = value
    return result


def loads(data):
    return json.loads(data, object_pairs_hook=unique)


def load(path):
    return loads(read(path, 32 * 1024 * 1024))


def owned(path):
    path = Path(path).resolve()
    require(path.is_relative_to(ARTIFACTS.resolve()) and path != ARTIFACTS.resolve(),
            'Write target escaped project artifacts')
    return path


def write(path, data):
    path = owned(path)
    if REPLACEMENT_SHA is not None and path.is_relative_to(OUT.resolve()):
        return replacement_write(path, data)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def write_json(path, value):
    write(path, (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + '\n').encode())


def pin(path):
    data = read(path)
    return {'bytes': len(data), 'sha256': digest(data)}


def require_pin(path, expected):
    require(pin(path) == expected, 'Frozen artifact bytes changed: ' + Path(path).name)


def no_links(path):
    """Do not follow a symlink/junction when retaining or replacing evidence."""
    path = Path(path).absolute()
    require(path.is_relative_to(ROOT.absolute()), 'Release path escaped the original checkout')
    for item in (path, *path.parents):
        require(not item.is_symlink() and not (hasattr(item, 'is_junction') and item.is_junction()),
                'Release evidence path contains a link or junction')
        if item == ROOT.absolute():
            break
    return path


def active_files():
    """The canonical output is a bounded allowlist, never a cleanup target."""
    result = {}
    if not OUT.exists():
        return result
    no_links(OUT)
    for path in OUT.rglob('*'):
        no_links(path)
        relative = path.relative_to(OUT).as_posix()
        if path.is_dir():
            require(relative in {'normal-snapshot', 'scratch', 'strip-staging', 'normal-snapshot/cxx'} or
                    relative.startswith(('normal-snapshot/cxx/', 'scratch/', 'strip-staging/')),
                    'Unknown canonical release directory; preserve and review it')
            continue
        require(path.is_file(), 'Canonical release contains a non-regular file')
        if relative in {APPROVED.name, CANDIDATE.name} or relative.startswith(('scratch/', 'strip-staging/')):
            continue
        require(relative in ACTIVE_NAMES or relative.startswith('normal-snapshot/'),
                'Unknown canonical release output; preserve and review it')
        result[relative] = path
    return result


def approved_archive(expected_sha, archive_path=None):
    path = no_links(APPROVED if archive_path is None else archive_path)
    require(path in {APPROVED, OUT / 'scratch/release-stage-approved.zip'},
            'Approved archive verification escaped fixed canonical paths')
    return retained_archive(expected_sha, path, 'APPROVED_MANIFEST.json', True)


def retained_archive(expected_sha, path, manifest_name, accepted):
    """One bounded member parser; acceptance remains an explicit exact boolean."""
    require(re.fullmatch(r'[0-9a-f]{64}', expected_sha or ''), 'Exact retained archive SHA256 is required')
    data = read(path)
    require(digest(data) == expected_sha, 'Retained archive changed')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        rows = archive.infolist()
        names = [row.filename for row in rows]
        require(len(names) == len(set(names)) and manifest_name in names and len(names) <= 128,
                'Approved rollback archive member set is invalid')
        require(sum(row.file_size for row in rows) <= 256 * 1024 * 1024 and
                all(not row.is_dir() and not row.flag_bits & 1 and row.file_size <= 128 * 1024 * 1024
                    for row in rows), 'Approved rollback archive is not bounded regular evidence')
        manifest = loads(archive.read(manifest_name))
        require(manifest.get('schema') == 1 and manifest.get('ownerAccepted') is accepted and
                re.fullmatch(r'[0-9a-f]{40}', manifest.get('sourceCommit', '')) and
                re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', manifest.get('version', '')) and
                isinstance(manifest.get('versionCode'), int) and not isinstance(manifest['versionCode'], bool) and
                manifest['versionCode'] > 0 and isinstance(manifest.get('files'), dict),
                'Approved rollback manifest identity is invalid')
        require(set(names) == {manifest_name, *manifest['files']},
                'Approved rollback manifest member set differs')
        contents = {}
        for name, expected in manifest['files'].items():
            relative = PurePosixPath(name)
            require(not relative.is_absolute() and '..' not in relative.parts and '\\' not in name and
                    relative.parts[0] in {'release', 'telegram'}, 'Unsafe approved rollback member')
            if relative.parts[0] == 'release':
                member = name[len('release/'):]
                require(member in ACTIVE_NAMES or member.startswith('normal-snapshot/'),
                        'Unknown approved release member')
            else:
                require(re.fullmatch(r'telegram/wa-reco-' + re.escape(manifest['version']) +
                                    r'-(apk|companion)-(attempt|receipt)\.json', name),
                        'Unknown approved Telegram member')
            content = archive.read(name)
            require(expected == {'bytes': len(content), 'sha256': digest(content)},
                    'Approved rollback member integrity failed')
            contents[name] = content
        require('release/release-pins.json' in contents and
                digest(contents['release/release-pins.json']) == manifest.get('releasePinsSha256'),
                'Approved release pin binding is invalid')
    return manifest, contents


def candidate_archive(expected_sha, archive_path=None):
    path = no_links(CANDIDATE if archive_path is None else archive_path)
    require(path in {CANDIDATE, OUT / 'scratch/release-stage-candidate.zip'},
            'Candidate archive verification escaped fixed canonical paths')
    manifest, contents = retained_archive(expected_sha, path, 'CANDIDATE_MANIFEST.json', False)
    require(set(manifest) == {'schema', 'ownerAccepted', 'sourceCommit', 'version', 'versionCode',
                             'releasePinsSha256', 'deliveryPinsSha256', 'approvedArchiveSha256', 'files'} and
            re.fullmatch(r'[0-9a-f]{64}', manifest['approvedArchiveSha256'] or '') and
            'release/delivery-pins.json' in contents and
            digest(contents['release/delivery-pins.json']) == manifest['deliveryPinsSha256'],
            'Candidate archive acceptance/proof identity is invalid')
    frozen = loads(contents['release/release-pins.json'])
    delivery = loads(contents['release/delivery-pins.json'])
    require(all(row.get('sourceCommit') == manifest['sourceCommit'] and row.get('version') == manifest['version'] and
                row.get('versionCode') == manifest['versionCode'] for row in (frozen, delivery)) and
            delivery.get('releasePinsSha256') == manifest['releasePinsSha256'],
            'Candidate frozen/delivery identity differs from its manifest')
    for name, expected in delivery.get('assets', {}).items():
        require(manifest['files'].get('release/' + name) == expected, 'Candidate delivered asset binding differs')
    require(set(delivery.get('assets', {})) == {APK.name, SOURCE.name, COMPANION.name},
            'Candidate delivered asset set is incomplete')
    return manifest, contents


def verify_rollback_binding(normal):
    candidate_sha = normal.get('preservedCandidateArchiveSha256')
    if candidate_sha is not None:
        actual_candidate_sha = digest(read(CANDIDATE))
        candidate, candidate_contents = candidate_archive(actual_candidate_sha)
        require(candidate['approvedArchiveSha256'] == normal.get('approvedRollbackArchiveSha256'),
                'Normal candidate approved rollback binding is invalid')
        if actual_candidate_sha == candidate_sha:
            require(normal['versionCode'] > candidate['versionCode'] and normal['version'] != candidate['version'] and
                    normal['sourceCommit'] != candidate['sourceCommit'], 'Normal candidate predecessor binding is invalid')
        else:
            # The fixed candidate may now retain this exact delivered release.
            # This preserves verification after rotation without granting acceptance.
            require(candidate['ownerAccepted'] is False and candidate['sourceCommit'] == normal['sourceCommit'] and
                    candidate['version'] == normal['version'] and candidate['versionCode'] == normal['versionCode'] and
                    candidate_contents.get('release/normal-verification.json') == read(NORMAL) and
                    candidate_contents.get('release/release-pins.json') == read(FROZEN),
                    'Candidate archive changed without exact self-retention of this release')
            current = active_files()
            preserved = {name[len('release/'):]: data for name, data in candidate_contents.items() if name.startswith('release/')}
            require(set(preserved) == set(current) and all(read(current[name]) == data for name, data in preserved.items()),
                    'Latest candidate evidence differs from current release')
            telegram = {name for name in candidate_contents if name.startswith('telegram/')}
            expected_telegram = {f'telegram/wa-reco-{normal["version"]}-{kind}-{suffix}.json'
                                 for kind in ('apk', 'companion') for suffix in ('attempt', 'receipt')}
            require(telegram == expected_telegram and
                    all(read(no_links(ARTIFACTS / name)) == candidate_contents[name] for name in telegram),
                    'Latest candidate immutable receipts differ from current release')
    expected = normal.get('approvedRollbackArchiveSha256')
    if expected is None:
        return
    actual = digest(read(APPROVED))
    manifest, contents = approved_archive(actual)
    if actual == expected:
        return
    # Once this release is itself accepted, the sole archive may deliberately
    # retain it instead of its predecessor. Require exact current evidence.
    require(manifest['sourceCommit'] == normal['sourceCommit'] and manifest['version'] == normal['version'] and
            manifest['versionCode'] == normal['versionCode'] and
            contents.get('release/normal-verification.json') == read(NORMAL) and
            contents.get('release/release-pins.json') == read(FROZEN),
            'Approved rollback archive changed without exact retention of this release')
    current = active_files()
    preserved = {name[len('release/'):]: data for name, data in contents.items() if name.startswith('release/')}
    require(set(preserved) == set(current) and all(read(current[name]) == data for name, data in preserved.items()),
            'Latest approved rollback evidence differs from current release')


def replacement_state():
    manifest, contents = approved_archive(REPLACEMENT_SHA)
    require(REPLACEMENT_COMMIT is not None and re.fullmatch(r'[0-9a-f]{40}', REPLACEMENT_COMMIT) and
            CODE > manifest['versionCode'] and VERSION != manifest['version'] and
            REPLACEMENT_COMMIT != manifest['sourceCommit'], 'Replacement identity must be a new approved successor')
    state = {'schema': 1, 'approvedArchiveSha256': REPLACEMENT_SHA, 'sourceCommit': REPLACEMENT_COMMIT,
             'version': VERSION, 'versionCode': CODE, 'files': {}}
    if CANDIDATE_SHA is not None:
        candidate, contents = candidate_archive(CANDIDATE_SHA)
        require(candidate['approvedArchiveSha256'] == REPLACEMENT_SHA and
                candidate['versionCode'] > manifest['versionCode'] and CODE > candidate['versionCode'] and
                VERSION != candidate['version'] and REPLACEMENT_COMMIT != candidate['sourceCommit'],
                'Candidate replacement must be a strictly newer source and version')
        state['candidateArchiveSha256'] = CANDIDATE_SHA
    current = active_files()
    if REPLACEMENT.name in current:
        previous = load(REPLACEMENT)
        if all(previous.get(key) == state[key] for key in state if key != 'files'):
            require(set(previous) == set(state), 'Replacement state contains unknown fields')
            require(isinstance(previous.get('files'), dict), 'Replacement state is malformed')
            state = previous
        else:
            preserved = contents.get('release/' + REPLACEMENT.name)
            require(preserved is not None and read(REPLACEMENT) == preserved,
                    'Replacement state belongs to a different source or archive')
    old = {name[len('release/'):]: {'bytes': len(data), 'sha256': digest(data)}
           for name, data in contents.items() if name.startswith('release/')}
    require(set(state['files']) <= (ACTIVE_NAMES - {REPLACEMENT.name}) | set(old),
            'Unknown replacement journal output')
    expected = {**old, **state['files']}
    require(set(current) - {REPLACEMENT.name} == set(expected) - {REPLACEMENT.name},
            'Canonical outputs are missing or unknown; preservation cannot authorize replacement')
    for relative, path in current.items():
        if relative != REPLACEMENT.name:
            require_pin(path, expected[relative])
    return state, old


def replacement_allowed(paths):
    state, old = replacement_state()
    for path in paths:
        path = no_links(path)
        relative = path.relative_to(OUT).as_posix()
        require(relative != REPLACEMENT.name and
                (relative in ACTIVE_NAMES or relative in old and relative.startswith('normal-snapshot/')),
                'Replacement target is not a canonical approved output')
        require(relative not in state['files'], 'New-source output already exists; review rather than overwrite')
        if path.exists():
            require(relative in old, 'Existing output was not preserved in the approved rollback archive')
            require_pin(path, old[relative])
    return state


def staged_install(path, stage):
    """Promote only a newly created, bounded stage; old evidence stays archived."""
    path, stage = no_links(path), no_links(stage)
    require(stage.parent == OUT / 'scratch' and stage.name.startswith('release-stage-'),
            'Release staging escaped the fixed scratch directory')
    data = read(stage)
    if REPLACEMENT_SHA is None:
        require(not path.exists(), 'Release output exists; review rather than overwrite')
        path.parent.mkdir(parents=True, exist_ok=True)
        # Windows rename refuses an existing target; it never deletes old files.
        os.rename(stage, path)
        return
    state = replacement_allowed([path])
    relative = path.relative_to(OUT).as_posix()
    path.parent.mkdir(parents=True, exist_ok=True)
    state['files'][relative] = {'bytes': len(data), 'sha256': digest(data)}
    journal_stage = no_links(OUT / 'scratch/release-stage-journal.json')
    # Reserve and flush the journal first: an interrupted prior stage must not
    # cause an error only after changing the canonical output.
    with journal_stage.open('xb') as stream:
        stream.write((json.dumps(state, indent=2, sort_keys=True) + '\n').encode())
        stream.flush()
        os.fsync(stream.fileno())
    replacement_allowed([path])
    require(read(stage) == data, 'Newly produced staged bytes changed before installation')
    os.replace(stage, path)
    approved_archive(REPLACEMENT_SHA)
    if CANDIDATE_SHA is not None:
        candidate_archive(CANDIDATE_SHA)
    no_links(REPLACEMENT)
    os.replace(journal_stage, REPLACEMENT)


def replacement_write(path, data):
    replacement_allowed([path])
    scratch = no_links(OUT / 'scratch')
    scratch.mkdir(parents=True, exist_ok=True)
    stage = scratch / 'release-stage-output.tmp'
    with stage.open('xb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    staged_install(path, stage)


def run(argv, timeout=60):
    completed = subprocess.run(list(map(str, argv)), cwd=ROOT, stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    require(completed.returncode == 0, 'Read-only verification command failed')
    return completed.stdout


def git(*args):
    return run(['git', '-C', ROOT, *args])


def source_guard(commit):
    require(re.fullmatch(r'[0-9a-f]{40}', commit or ''), 'An exact source commit is required')
    require(not git('status', '--porcelain=v1', '--untracked-files=all').strip(), 'Application checkout is not clean')
    require(git('merge-base', '--is-ancestor', commit, 'HEAD') == b'', 'Frozen source is not an ancestor')
    changes = git('diff', '--name-only', commit, 'HEAD').decode().splitlines()
    require(all(name.startswith('.planning/') for name in changes), 'Application source changed after freeze')


def bundle_module():
    path = ROOT / 'tools/release-compliance/release_bundle.py'
    spec = importlib.util.spec_from_file_location('wa_reco_exact_release_bundle', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # Existing mechanical checks use tempfile. Keep their scratch under the root.
    scratch = OUT / 'scratch'
    scratch.mkdir(parents=True, exist_ok=True)
    tempfile.tempdir = str(scratch)
    return module


def source_files(module, path, commit):
    data = read(path, 32 * 1024 * 1024)
    require(module.verify_app_source(data) == commit, 'Source ZIP commit binding mismatch')
    archive = module.checked_zip(data)
    manifest = loads(archive.read('WhatsAppCallRecorder/SOURCE_MANIFEST.json'))
    result = {}
    for row in manifest['files']:
        content = archive.read('WhatsAppCallRecorder/' + row['path'])
        require(git('show', commit + ':' + row['path']) == content, 'Export differs from frozen Git source')
        result[row['path']] = content
    return result, manifest


def metadata_check(files):
    require(VERSION is not None and CODE is not None, 'Explicit expected release identity is required')
    for name in ('package.json', 'package-lock.json', 'app.json'):
        current = loads(files[name])
        require((current['expo']['version'] if name == 'app.json' else current['version']) == VERSION,
                'Source version does not match release')
        if name == 'package-lock.json':
            require(current['packages']['']['version'] == VERSION, 'Lock root version mismatch')
    gradle = files['android/app/build.gradle']
    require(gradle.count(f'output.versionCode.set({CODE})'.encode()) == 1 and
            gradle.count(f"output.versionName.set('{VERSION}')".encode()) == 1,
            'Standalone release version/code mismatch')


def reviewed_changes(module, files, commit, review_file=None):
    baseline = ARTIFACTS / 'wa-reco-1.5.4-application-source.zip'
    data = read(baseline, 32 * 1024 * 1024)
    require(digest(data) == BASE_SOURCE_SHA, 'Retained 1.5.4 source changed')
    archive = module.checked_zip(data)
    manifest = loads(archive.read('WhatsAppCallRecorder/SOURCE_MANIFEST.json'))
    old = {row['path']: archive.read('WhatsAppCallRecorder/' + row['path']) for row in manifest['files']}
    # Package coordinates and lock graph may only vary in the release number.
    for name in ('package.json', 'package-lock.json', 'app.json'):
        before, after = loads(old[name]), loads(files[name])
        if name == 'app.json':
            after['expo']['version'] = before['expo']['version']
        else:
            after['version'] = before['version']
            if name == 'package-lock.json':
                after['packages']['']['version'] = before['packages']['']['version']
        require(after == before, 'Dependency/package configuration changed beyond version')
    protected = lambda name: name in {
        'LICENSE', 'THIRD_PARTY_NOTICES.md', 'android/build.gradle', 'android/settings.gradle',
        'android/gradle.properties', 'android/gradle/wrapper/gradle-wrapper.properties',
        'docs/apk-redistribution.md', 'docs/rebuild-spake2.md', 'tools/export-public-source.py',
        'android/app/build.gradle',
    } or name.startswith(('LICENSES/', 'android/vendor/libadb/', 'tools/release-compliance/'))
    changes = []
    for name in sorted(set(old) | set(files)):
        if not protected(name):
            continue
        before, after = old.get(name), files.get(name)
        if name == 'android/app/build.gradle' and after is not None:
            after = after.replace(f'output.versionCode.set({CODE})'.encode(), b'output.versionCode.set(15)')
            after = after.replace(f"output.versionName.set('{VERSION}')".encode(), b"output.versionName.set('1.5.4')")
        if before != after:
            changes.append({'path': name, 'oldSha256': None if before is None else digest(before),
                            'newSha256': None if files.get(name) is None else digest(files[name])})
    if review_file is None:
        return changes, None
    review_file = owned(review_file)
    review = load(review_file)
    require(review.get('schema') == 1 and review.get('sourceCommit') == commit and
            review.get('changedInputs') == changes and review.get('reviewed') is True and
            review.get('dependencyAndLicenseImpactReviewed') is True and
            review.get('originalCodeNoNewThirdPartyDependency') is True,
            'Source-hash-bound build/export/license review is incomplete')
    return changes, digest(read(review_file))


def retained_reviews():
    data = {}
    for name, expected in PINS.items():
        item = read(ARTIFACTS / name)
        require(digest(item) == expected, 'Historical review input changed: ' + name)
        data[name] = item
    inventory = loads(data['runtime-inventory-1.5.0-reviewed.json'])
    require(inventory['appSourceCommit'] == OLD_COMMIT and inventory['reviewed'] is True and
            inventory['apkSha256'] == PINS['wa-reco-1.5.0.apk'] and len(inventory['components']) == 210 and
            all(row['reviewed'] is True for row in inventory['components']), 'Historical component review incomplete')
    review = loads(data['runtime-final-review.json'])
    require(not review['remainingConcreteUnresolvedConditions'] and
            review['apkObservedSha256'] == PINS['wa-reco-1.5.0.apk'], 'Historical review is unresolved')
    notices = {row['noticeFile']: row for row in loads(data['runtime-notice-text-manifest.json'])['files']}
    references = {name for row in inventory['components'] for name in row['noticeFiles']}
    require(len(references) == 446 and references == set(notices), 'Historical notice reference set changed')
    for name, row in notices.items():
        path = (ARTIFACTS / 'runtime-notices' / name).resolve()
        require(path.is_relative_to((ARTIFACTS / 'runtime-notices').resolve()), 'Notice path escaped root')
        require_pin(path, {'bytes': row['bytes'], 'sha256': row['sha256']})
    return data, inventory


def actual_path(value, alias):
    normalized = str(value).replace('\\', '/')
    if re.match(r'^' + re.escape(alias) + r':/', normalized, re.I):
        normalized = str(ROOT).replace('\\', '/') + normalized[2:]
    return Path(normalized).resolve()


def runtime_rows(value):
    require(set(value) == {'schema', 'configuration', 'artifacts'} and value['schema'] == 1 and
            value['configuration'] == 'releaseRuntimeClasspath', 'Runtime inventory shape mismatch')
    result = []
    for row in value['artifacts']:
        require(set(row) == {'id', 'sha256', 'inputPath', 'extension'} and
                re.fullmatch(r'[0-9a-f]{64}', row['sha256']), 'Invalid resolved runtime row')
        result.append((row['id'], row['sha256'], row['extension']))
    require(len(result) == 147 and len({row[0] for row in result}) == 143, 'Runtime coordinates changed')
    return sorted(result)


def require_single_signer(signature, certificate):
    counts = re.findall(r'^Number of signers:\s*([0-9]+)\s*$', signature, re.MULTILINE)
    digests = re.findall(r'^Signer #([0-9]+) certificate SHA-256 digest:\s*([0-9a-fA-F:]+)\s*$',
                         signature, re.MULTILINE)
    parsed = [(number, value.replace(':', '').lower()) for number, value in digests]
    require(counts == ['1'] and parsed == [('1', certificate)] and
            'Verified using v2 scheme (APK Signature Scheme v2): true' in signature,
            'Actual APK single-signer certificate/v2 signature mismatch')


def inspect_apk(path, certificate):
    sdk = Path(os.environ['LOCALAPPDATA']) / 'Android/Sdk/build-tools/36.0.0'
    java = Path('C:/Program Files/Android/Android Studio/jbr/bin/java.exe')
    signature = run([java, '-jar', sdk / 'lib/apksigner.jar', 'verify', '--verbose', '--print-certs', path]).decode()
    require_single_signer(signature, certificate)
    badging = run([sdk / 'aapt2.exe', 'dump', 'badging', path]).decode('utf-8')
    identity = re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging)
    require(identity is not None and identity.groups() == (PACKAGE, str(CODE), VERSION), 'APK identity mismatch')
    require('application-debuggable' not in badging and "minSdkVersion:'24'" in badging and
            "targetSdkVersion:'36'" in badging, 'APK SDK/debuggable mismatch')
    native = []
    with Path(path).open('rb') as raw, zipfile.ZipFile(path) as archive:
        for item in archive.infolist():
            if not (item.filename.startswith('lib/') and item.filename.endswith('.so')):
                continue
            require(item.filename.startswith('lib/arm64-v8a/'), 'Unexpected native ABI')
            data = archive.read(item)
            require(data[:6] == b'\x7fELF\x02\x01', 'Invalid packaged ELF')
            phoff = struct.unpack_from('<Q', data, 32)[0]
            phsize, count = struct.unpack_from('<HH', data, 54)
            loads_ = [struct.unpack_from('<IIQQQQQQ', data, phoff + i * phsize) for i in range(count)
                      if struct.unpack_from('<I', data, phoff + i * phsize)[0] == 1]
            raw.seek(item.header_offset + 26)
            name_len, extra_len = struct.unpack('<HH', raw.read(4))
            offset = item.header_offset + 30 + name_len + extra_len
            require(loads_ and all(row[7] >= 16384 and row[2] % row[7] == row[3] % row[7] for row in loads_),
                    'ELF 16KB alignment failed')
            require(item.compress_type == zipfile.ZIP_STORED and offset % 16384 == 0, 'ZIP 16KB alignment failed')
            native.append({'path': item.filename, 'sha256': digest(data), 'elf16kb': True, 'zip16kb': True})
    require(len(native) == 18, 'Native library inventory changed')
    return native


def private_scan(paths):
    env_file = ROOT / '.env'
    require(env_file.is_file() and env_file.stat().st_size <= 1024 * 1024, 'Private environment scan input unavailable')
    values = []
    for line in env_file.read_text(encoding='utf-8-sig').splitlines():
        match = re.match(r'^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*?)\s*$', line)
        if match:
            value = match.group(1).strip().strip('\"\x27')
            if len(value) >= 6 and not value.startswith('#'):
                values.append(value.encode())
    require(values, 'Private scan has no bounded configured values')
    for path in paths:
        with zipfile.ZipFile(path) as archive:
            for name in archive.namelist():
                if not name.endswith('/'):
                    item = archive.read(name)
                    require(not any(value in item for value in values), 'Private configured value found in distribution')
    return {'privateValuesChecked': len(values), 'privateValueMatches': 0}


def cached_archive(lock, observation):
    installed = observation['installedPath']
    entry = lock['packages'][installed]
    require(entry['version'] == observation['version'] and observation['lockIntegrityVerified'] is True,
            'Npm package review/lock mismatch')
    algorithm, encoded = entry['integrity'].split('-', 1)
    require(algorithm == 'sha512', 'Unexpected npm integrity algorithm')
    expected = base64.b64decode(encoded, validate=True).hex()
    cache = Path(os.environ['LOCALAPPDATA']) / 'npm-cache/_cacache/content-v2/sha512' / expected[:2] / expected[2:4] / expected[4:]
    retained = PUBLISHER_CACHE / (observation['sourceArchiveSha256'] + '.tgz')
    content = read(retained if retained.is_file() else cache, 128 * 1024 * 1024)
    require(hashlib.sha512(content).hexdigest() == expected and
            digest(content) == observation['sourceArchiveSha256'], 'Locked npm publisher archive changed')
    return content


def hydrate_archives(args):
    """Explicit public-source hydration only; no dependency/cache mutation."""
    source_guard(args.source_commit)
    retained, _ = retained_reviews()
    lock = loads(git('show', args.source_commit + ':package-lock.json'))
    observations = loads(retained['runtime-npm-notice-observations.json'])['observations']
    pending, reused = {}, 0
    for row in observations:
        try:
            cached_archive(lock, row)
            reused += 1
            continue
        except ReleaseError:
            # A corrupt retained file is a review gate, not a replaceable cache miss.
            require(not (PUBLISHER_CACHE / (row['sourceArchiveSha256'] + '.tgz')).exists(),
                    'Existing reviewed publisher artifact changed; do not replace it')
        package = lock['packages'][row['installedPath']]
        require(row['version'] == package['version'] and row['lockIntegrityVerified'] is True,
                'Hydration package/lock review mismatch')
        url = urllib.parse.urlparse(row['sourceUrl'])
        require(url.scheme == 'https' and url.hostname == 'registry.npmjs.org' and url.port is None and
                url.username is None and url.password is None and not url.query and not url.fragment and
                row['sourceUrl'] == package['resolved'], 'Reviewed publisher URL does not match locked registry source')
        pending[row['sourceArchiveSha256']] = row
    if not args.fetch:
        return {'fetched': False, 'reviewedObservationCount': len(observations), 'availableObservations': reused,
                'uniqueMissingArchives': len(pending), 'explicitFetchFlagRequired': True,
                'destination': PUBLISHER_CACHE.relative_to(ROOT).as_posix(), 'credentialAccessed': False}
    def fetch_one(row):
        expected_size = row['sourceArchiveBytes']
        require(isinstance(expected_size, int) and 0 < expected_size <= 128 * 1024 * 1024, 'Reviewed publisher archive size exceeds bounds')
        request = urllib.request.Request(row['sourceUrl'], headers={'User-Agent': 'wa-reco-release-source-check/1'})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                final = urllib.parse.urlparse(response.geturl())
                require(final.scheme == 'https' and final.hostname == 'registry.npmjs.org', 'Publisher download redirected outside reviewed registry')
                content = response.read(expected_size + 1)
        except Exception:
            raise ReleaseError('Pinned public npm publisher download failed; no credentials were accessed') from None
        package = lock['packages'][row['installedPath']]
        algorithm, encoded = package['integrity'].split('-', 1)
        require(algorithm == 'sha512' and len(content) == expected_size and digest(content) == row['sourceArchiveSha256'] and
                hashlib.sha512(content).digest() == base64.b64decode(encoded, validate=True), 'Downloaded exact publisher hash/integrity mismatch')
        write(PUBLISHER_CACHE / (row['sourceArchiveSha256'] + '.tgz'), content)
        return row['sourceArchiveSha256']
    completed = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        tasks = [pool.submit(fetch_one, row) for row in pending.values()]
        for task in as_completed(tasks):
            completed.append(task.result())
            if len(completed) % 10 == 0:
                print(json.dumps({'publisherArchivesDownloaded': len(completed), 'credentialAccessed': False}), flush=True)
    for row in observations:
        cached_archive(lock, row)
    receipt = {'schema': 1, 'sourceCommit': args.source_commit, 'reviewedObservationCount': len(observations),
               'uniqueFetchedArchives': len(completed), 'credentialAccessed': False,
               'priorNpmObservationSha256': PINS['runtime-npm-notice-observations.json'],
               'verifiedArchives': sorted({row['sourceArchiveSha256'] for row in observations}),
               'exactPriorSha256AndLockedSha512Verified': True}
    if not (OUT / 'publisher-hydration.json').exists():
        write_json(OUT / 'publisher-hydration.json', receipt)
    return {'publisherArchivesReady': True, 'observationsChecked': len(observations), 'uniqueFetchedArchives': len(completed),
            'credentialAccessed': False}


def exported_application_source(name, content, files):
    """Resolve a Metro label to the most specific frozen relative file path.

    Metro may emit root-relative labels or prefix physical/temporary build paths.
    A basename suffix such as index.ts must never shadow src/i18n/index.ts.
    """
    normalized = name.replace('\\', '/')
    if normalized in files:
        relative = normalized
    else:
        matches = [candidate for candidate in files if normalized.endswith('/' + candidate)]
        if not matches:
            return None
        longest = max(len(candidate) for candidate in matches)
        selected = [candidate for candidate in matches if len(candidate) == longest]
        require(len(selected) == 1, 'Metro application source path is ambiguous')
        relative = selected[0]
    if relative.endswith(('.js', '.jsx', '.ts', '.tsx')):
        require(content.replace('\r\n', '\n').encode() == files[relative].replace(b'\r\n', b'\n'),
                'Actual Metro application source differs from frozen export')
        return relative
    return None


def png_byte_binding(publisher, installed, generated, packaged):
    require(publisher.startswith(b'\x89PNG\r\n\x1a\n') and installed == publisher,
            'Published PNG differs from installed binary asset')
    generated_matches = [(name, value) for name, value in generated if value == publisher]
    packaged_matches = [(name, value) for name, value in packaged if value == publisher]
    require(len(generated_matches) == 1, 'Published PNG does not match exactly one generated Metro resource')
    require(len(packaged_matches) == 1, 'Published PNG does not match exactly one actual APK resource')
    return {'sha256': digest(publisher), 'bytes': len(publisher),
            'generatedResource': generated_matches[0][0], 'packagedResource': packaged_matches[0][0],
            'publishedInstalledGeneratedPackagedBytesExact': True}


def verify_empty_png_asset(package, member, actual, publisher, apk_data):
    require(package == 'node_modules/@react-navigation/elements' and member in EMPTY_PNG_ASSETS and actual == '',
            'Empty Metro source content is not a recognized pinned binary PNG placeholder')
    expected, stem = EMPTY_PNG_ASSETS[member]
    require(digest(publisher) == expected, 'Recognized binary PNG publisher hash changed')
    installed = read(ROOT / package / member, 4 * 1024 * 1024)
    resource_root = ROOT / 'android/app/build/generated/res/createBundleReleaseJsAndAssets'
    filename = 'node_modules_reactnavigation_elements_lib_module_assets_' + stem + '.png'
    generated = []
    for path in resource_root.glob('drawable*/' + filename):
        require(path.resolve().is_relative_to(ROOT), 'Generated binary asset escaped physical project root')
        generated.append((path.relative_to(resource_root).as_posix(), read(path, 4 * 1024 * 1024)))
    with zipfile.ZipFile(io.BytesIO(apk_data)) as apk:
        packaged = [(name, apk.read(name)) for name in apk.namelist() if name.startswith('res/') and name.endswith('.png')]
    result = png_byte_binding(publisher, installed, generated, packaged)
    return {'package': '@react-navigation/elements', 'member': member, **result,
            'scope': 'Metro binary-asset empty source-map placeholder; exact byte binding, no image/source normalization'}


def npm_and_metro(source_map, files, retained, apk_data):
    sources, contents = source_map['sources'], source_map['sourcesContent']
    require(len(sources) == len(contents) and 0 < len(sources) <= 10000, 'Metro source-map bounds failed')
    observation_list = loads(retained['runtime-npm-notice-observations.json'])['observations']
    observations = {row['installedPath']: row for row in observation_list}
    require(len(observations) == len(observation_list) and
            all(row.get('lockIntegrityVerified') and not row.get('metroFileMismatches') for row in observation_list),
            'Prior npm inclusion/source review incomplete')
    lock = loads(files['package-lock.json'])
    grouped, application = {}, []
    for name, content in zip(sources, contents):
        require(isinstance(name, str) and isinstance(content, str), 'Invalid Metro source content')
        normalized = name.replace('\\', '/')
        if '/node_modules/' in normalized:
            relative = 'node_modules/' + normalized.split('/node_modules/', 1)[1]
        elif normalized.startswith('node_modules/'):
            relative = normalized
        else:
            relative = exported_application_source(normalized, content, files)
            if relative is not None:
                application.append(relative)
            continue
        matches = [key for key in observations if relative.startswith(key + '/')]
        require(matches, 'Actual Metro dependency is absent from reviewed package set')
        package = max(matches, key=len)
        member = relative[len(package) + 1:]
        group = grouped.setdefault(package, {})
        require(member not in group or group[member] == content, 'Conflicting Metro dependency source')
        group[member] = content
    required = {'App.tsx', 'src/i18n/core.ts', 'src/i18n/catalog.ts', 'src/screens/SettingsScreen.tsx'}
    require(required.issubset(application), 'Required application modules missing from current Metro map')
    native_packages = {'node_modules/' + name for name in
                       ('react-native', 'react-native-gesture-handler', 'react-native-safe-area-context',
                        'react-native-screens', 'expo-modules-core')}
    reviewed, binary_assets, expo_publisher_sources = [], [], {}
    for package in sorted(set(grouped) | native_packages):
        observation = observations[package]
        content = cached_archive(lock, observation)
        comparison_count = 0
        with tarfile.open(fileobj=io.BytesIO(content), mode='r:gz') as archive:
            members = archive.getmembers()
            require(len(members) <= 15000, 'Npm archive entry bounds exceeded')
            table = {}
            expanded = 0
            for item in members:
                part = PurePosixPath(item.name)
                require(not part.is_absolute() and '..' not in part.parts and '\\' not in item.name,
                        'Unsafe npm publisher archive member')
                if item.isfile() and item.name.startswith('package/'):
                    relative = item.name[len('package/'):]
                    expanded += item.size
                    require(relative not in table and item.size <= 256 * 1024 * 1024 and expanded <= 512 * 1024 * 1024,
                            'Duplicate or oversized npm archive contents')
                    table[relative] = item
            metro_members = grouped.get(package, {})
            require(all(member in table for member in metro_members), 'Metro dependency source absent from exact publisher archive')
            # Archive order avoids repeated backwards decompression; checks are identical.
            for member, actual in sorted(metro_members.items(), key=lambda pair: table[pair[0]].offset_data):
                require(table[member].size <= 4 * 1024 * 1024, 'Metro publisher source exceeds bounds')
                publisher = archive.extractfile(table[member]).read()
                if member.endswith('.png'):
                    binary_assets.append(verify_empty_png_asset(package, member, actual, publisher, apk_data))
                    continue
                require(publisher.replace(b'\r\n', b'\n') == actual.replace('\r\n', '\n').encode(),
                        'Actual Metro dependency source differs from locked publisher archive')
                comparison_count += 1
            native_count = 0
            if package in native_packages:
                for relative, item in table.items():
                    part = PurePosixPath(relative)
                    if any(piece in {'build', 'node_modules', '.gradle', '.cxx', 'test', 'tests', '__tests__', 'androidTest'} for piece in part.parts):
                        continue
                    if part.suffix.lower() not in {'.cpp', '.c', '.cc', '.h', '.hpp', '.kt', '.java', '.js', '.ts', '.tsx', '.gradle', '.json', '.xml'} and part.name != 'CMakeLists.txt':
                        continue
                    installed = ROOT / package / relative
                    require(item.size <= 4 * 1024 * 1024 and installed.is_file() and not installed.is_symlink() and
                            installed.stat().st_size <= 4 * 1024 * 1024,
                            'Installed native/codegen source unavailable or oversized')
                    publisher_source = archive.extractfile(item).read()
                    require(installed.read_bytes() == publisher_source,
                            'Installed native/codegen source differs from locked publisher archive')
                    if package == 'node_modules/expo-modules-core':
                        expo_publisher_sources[package + '/' + relative] = digest(publisher_source)
                    native_count += 1
                require(native_count > 0, 'No native publisher source compared')
            reviewed.append({'package': observation['name'], 'version': observation['version'],
                             'archiveSha256': digest(content), 'lockSha512Verified': True,
                             'metroFilesCompared': comparison_count, 'nativeSourceFilesCompared': native_count})
    require(len(binary_assets) == 5 and {row['member'] for row in binary_assets} == set(EMPTY_PNG_ASSETS),
            'Known Metro binary asset placeholder set changed')
    require(expo_publisher_sources, 'Expo publisher native-source proof missing')
    return {'publisherPackagesCompared': reviewed, 'metroDependencySourcesCompared': sum(len(v) for v in grouped.values()),
            'metroTextDependencySourcesCompared': sum(row['metroFilesCompared'] for row in reviewed),
            'metroBinaryAssetsCompared': binary_assets,
            'expoPublisherNativeSourceHashes': expo_publisher_sources,
            'metroApplicationSourcesCompared': len(application), 'metroApplicationSourcePathsCompared': sorted(set(application)),
            'method': 'Fresh Metro contents compared directly to exact locked publisher archives; no missing historical map equivalence claimed'}


def native_proof(apk_data, retained, inventory, alias, snapshot_files, expo_publisher_sources):
    require(isinstance(expo_publisher_sources, dict) and expo_publisher_sources and
            all(isinstance(name, str) and name.startswith('node_modules/expo-modules-core/') and
                isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value)
                for name, value in expo_publisher_sources.items()), 'Expo publisher source index missing or invalid')
    require(digest(read(OLD_NATIVE_PROOF)) == OLD_NATIVE_PROOF_SHA, 'Retained generated-source proof changed')
    baseline = load(OLD_NATIVE_PROOF)
    generated = {row['source']: row['sha256'] for row in baseline['generatedSourceBaselineChecks']['generatedCppHeaderFiles']}
    require(len(generated) == 84, 'Retained generated-header proof incomplete')
    for relative, expected in generated.items():
        require(digest(read(ROOT / relative, 4 * 1024 * 1024)) == expected, 'Generated C++/header changed beyond reviewed hash baseline')
    strip = Path(os.environ['LOCALAPPDATA']) / 'Android/Sdk/ndk/28.2.13676358/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-strip.exe'
    require(digest(read(strip, 128 * 1024 * 1024)) == STRIP_SHA, 'Reviewed strip tool changed')
    allowed_components = {row['id'] for row in inventory['components']}
    records = []
    with zipfile.ZipFile(io.BytesIO(retained['wa-reco-1.5.0.apk'])) as old, zipfile.ZipFile(io.BytesIO(apk_data)) as apk:
        relevant = lambda z: {name: digest(z.read(name)) for name in z.namelist() if re.fullmatch(r'lib/[^/]+/[^/]+\.so', name) or name.lower().endswith(('.ttf', '.otf'))}
        previous, current = relevant(old), relevant(apk)
        require(set(previous) == set(current) and len(current) == 19, 'Packaged native/font paths changed')
        changes = {name for name in previous if previous[name] != current[name]}
        require(changes.issubset({'lib/arm64-v8a/' + name for name in PROJECT_LIBS}), 'Native dependency/font changed beyond project targets')
        for library, package in PROJECT_LIBS.items():
            merged_path = ROOT / f'android/app/build/intermediates/merged_native_libs/release/mergeReleaseNativeLibs/out/lib/arm64-v8a/{library}'
            stripped_path = ROOT / f'android/app/build/intermediates/stripped_native_libs/release/stripReleaseDebugSymbols/out/lib/arm64-v8a/{library}'
            merged = read(merged_path)
            packaged = apk.read('lib/arm64-v8a/' + library)
            require(read(stripped_path) == packaged, 'Current normal native output differs from APK')
            cxx = ROOT / ('android/app/build/intermediates/cxx/RelWithDebInfo' if package is None else
                          f'node_modules/{package}/android/build/intermediates/cxx/RelWithDebInfo')
            models = []
            for model_path in cxx.glob('*/logs/arm64-v8a/build_model.json'):
                model = load(model_path)
                folder = actual_path(model['cxxBuildFolder'], alias)
                metadata_path = folder / 'android_gradle_build.json'
                if not folder.is_relative_to(ROOT) or not metadata_path.is_file():
                    # Historical models are not current physical-root build proof.
                    continue
                metadata = load(metadata_path)
                targets = [row for row in metadata['libraries'].values() if row.get('output') and
                           Path(row['output']).name == library]
                if len(targets) == 1:
                    target_path = actual_path(targets[0]['output'], alias)
                    if target_path.is_relative_to(ROOT) and target_path.is_file() and digest(read(target_path)) == digest(merged):
                        models.append((model_path, model, metadata_path, metadata, target_path))
            require(len(models) == 1, 'Expected one current matching Cxx model/target')
            model_path, model, metadata_path, metadata, target_path = models[0]
            require(model['variant']['module']['ndkVersion'] == '28.2.13676358' and model['info']['name'] == 'arm64-v8a' and
                    model['variant']['variantName'] == 'release', 'Cxx NDK/ABI/variant changed')
            command_path = actual_path(model['cxxBuildFolder'], alias) / 'compile_commands.json'
            table = load(command_path)
            require(isinstance(table, list) and 0 < len(table) <= 1000, 'Cxx command table bounds failed')
            origins = []
            for row in table:
                command = row['command'].replace('\\', '/')
                require('ndk/28.2.13676358/' in command and '--target=aarch64-none-linux-android24' in command,
                        'Native compile compiler/target changed')
                file = actual_path(row['file'], alias)
                require(file.is_relative_to(ROOT), 'Native source escaped physical project root')
                relative = file.relative_to(ROOT).as_posix()
                if relative.startswith('node_modules/'):
                    rest = relative[len('node_modules/'):].split('/')
                    package_name = '/'.join(rest[:2] if rest[0].startswith('@') else rest[:1])
                    package_version = load(ROOT / 'node_modules' / package_name / 'package.json')['version']
                    component = 'npm:' + package_name + '@' + package_version
                    require(component in allowed_components, 'Native source component absent from reviewed inventory')
                    if '/build/generated/' in relative:
                        require(relative in generated, 'New generated dependency source lacks prior hash proof')
                else:
                    require(relative.startswith('android/app/build/generated/autolinking/src/main/jni/') and relative in generated,
                            'Native source has unknown origin')
                    component = 'application-source snapshot'
                source_sha = digest(read(file, 4 * 1024 * 1024))
                origin = {'source': relative, 'sha256': source_sha, 'component': component}
                if package == 'expo-modules-core':
                    require(relative in expo_publisher_sources and source_sha == expo_publisher_sources[relative],
                            'Expo compiled source differs from exact locked publisher archive')
                    origin['publisherSourceSha256'] = expo_publisher_sources[relative]
                origins.append(origin)
            staging = OUT / 'strip-staging'
            staging.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(prefix='normal-', dir=staging) as directory:
                for attempt in range(2):
                    transformed = Path(directory) / f'{attempt}.so'
                    run([strip, '--strip-unneeded', '-o', transformed, merged_path], timeout=30)
                    require(read(transformed) == packaged, 'Independent strip transformation differs from packaged native library')
            for name, value in [('build_model.json', read(model_path, 32 * 1024 * 1024)),
                                ('android_gradle_build.json', read(metadata_path, 32 * 1024 * 1024)),
                                ('compile_commands.json', read(command_path, 32 * 1024 * 1024)),
                                ('merged.so', merged)]:
                snapshot_files[f'cxx/{library}/{name}'] = value
            records.append({'path': 'lib/arm64-v8a/' + library, 'packagedSha256': digest(packaged),
                            'mergedSha256': digest(merged), 'cxxTargetSha256': digest(read(target_path)),
                            'cxxModelSha256': digest(read(model_path, 32 * 1024 * 1024)),
                            'compileCommandsSha256': digest(read(command_path, 32 * 1024 * 1024)),
                            'sourceOrigins': origins, 'independentStripRuns': 2, 'stripToolSha256': STRIP_SHA})
            if package == 'expo-modules-core':
                records[-1]['rebuildContext'] = 'Physical original-root Cxx staging consolidation; dependency coordinates unchanged'
                records[-1]['publisherCompiledSourcesExact'] = True
                records[-1]['publisherNativeSourceFilesCompared'] = len(expo_publisher_sources)
    cmake = read(ROOT / 'android/app/build/generated/autolinking/src/main/jni/Android-autolinking.cmake', 4 * 1024 * 1024)
    snapshot_files['Android-autolinking.cmake'] = cmake
    return {'projectLibraries': records, 'unchangedNativeFontEntries': len(current) - len(changes),
            'changedProjectLibraryCount': len(changes), 'generatedCppHeaderFilesHashChecked': len(generated),
            'retainedGeneratedProofSha256': OLD_NATIVE_PROOF_SHA,
            'generatedAutolinkingCmakeSha256': digest(cmake), 'historicalCmakeContentsCompared': False,
            'scope': 'Fresh actual compiler/source/merged/strip proof, prior exact generated-source hashes; no unavailable historical CMake path equivalence asserted'}


def snapshot_normal(args):
    source_guard(args.source_commit)
    if REPLACEMENT_SHA is not None:
        replacement_allowed([NORMAL, APK, INVENTORY])
    else:
        require(not NORMAL.exists() and not APK.exists() and not SNAPSHOT.exists(), 'Normal snapshot/artifact exists; review rather than overwrite')
    require(args.build_log is not None, 'Supply the successful project-local build wrapper log')
    build_log = owned(args.build_log)
    require(build_log.is_relative_to((ARTIFACTS / 'workspace').resolve()), 'Build log outside project-local wrapper logs')
    build_data = read(build_log, 8 * 1024 * 1024)
    require(b'Temporary drive alias to the physical project root' in build_data and b'BUILD SUCCESSFUL' in build_data and
            b'Owned temporary drive alias removed.' in build_data and b'BUILD FAILED' not in build_data,
            'Normal wrapper build receipt incomplete')
    module = bundle_module()
    files, manifest = source_files(module, SOURCE, args.source_commit)
    metadata_check(files)
    changes, review_sha = reviewed_changes(module, files, args.source_commit, args.review_file)
    require(not changes or review_sha is not None, 'Build/export/license input changes require review-draft plus explicit source-bound review')
    retained, inventory = retained_reviews()
    resolved_path = OUT / 'resolved-runtime-private.json'
    resolved = load(resolved_path)
    require(runtime_rows(resolved) == runtime_rows(loads(retained['resolved-runtime-final-private.json'])), 'Fresh runtime graph differs from reviewed inputs')
    for row in resolved['artifacts']:
        require(digest(read(actual_path(row['inputPath'], args.build_alias))) == row['sha256'], 'Resolved runtime bytes differ from fresh inventory')
    built = ROOT / 'android/app/build/outputs/apk/release/app-release.apk'
    apk_data = read(built)
    natives = inspect_apk(built, CERT)
    private_result = private_scan([built, SOURCE])
    map_path = ROOT / 'android/app/build/generated/sourcemaps/react/release/index.android.bundle.map'
    bundle_path = ROOT / 'android/app/build/generated/assets/createBundleReleaseJsAndAssets/index.android.bundle'
    map_data = read(map_path, 32 * 1024 * 1024)
    bundle_data = read(bundle_path)
    with zipfile.ZipFile(io.BytesIO(apk_data)) as archive:
        require(archive.read('assets/index.android.bundle') == bundle_data, 'Packaged JS differs from actual current Metro output')
    npm = npm_and_metro(loads(map_data), files, retained, apk_data)
    snapshots = {'index.android.bundle.map': map_data, 'index.android.bundle': bundle_data,
                 'resolved-runtime-private.json': read(resolved_path, 8 * 1024 * 1024), 'normal-build.log': build_data}
    native = native_proof(apk_data, retained, inventory, args.build_alias, snapshots, npm['expoPublisherNativeSourceHashes'])
    rebound = copy.deepcopy(inventory)
    rebound['appSourceCommit'], rebound['apkSha256'] = args.source_commit, digest(apk_data)
    source_guard(args.source_commit)
    write(APK, apk_data)
    for relative, data in snapshots.items():
        write(SNAPSHOT / relative, data)
    write_json(INVENTORY, rebound)
    receipt = {'schema': 1, 'version': VERSION, 'versionCode': CODE, 'sourceCommit': args.source_commit,
               'package': PACKAGE, 'certificateSha256': CERT, 'debuggable': False, 'minSdk': 24, 'targetSdk': 36,
               'assets': {APK.name: pin(APK), SOURCE.name: pin(SOURCE)}, 'sourceFileCount': manifest['fileCount'],
               'native': natives, 'nativeSourceProvenance': native, 'metroProvenance': npm,
               'runtimeInventorySha256': digest(read(INVENTORY)),
               'noticeHashesChecked': 446, 'reviewedBuildExportChanges': changes, 'inputReviewSha256': review_sha,
               'snapshots': [{'path': name, 'bytes': len(data), 'sha256': digest(data)} for name, data in sorted(snapshots.items())],
               'wrapperBuildLogSha256': digest(build_data), 'temporaryBuildAlias': args.build_alias.upper(),
               'approvedRollbackArchiveSha256': REPLACEMENT_SHA,
               'realDeviceOfflineRebootRecovery': 'pending', 'realDeviceRecording': 'pending',
               'notLegalCertification': True, **private_result}
    if CANDIDATE_SHA is not None:
        receipt['preservedCandidateArchiveSha256'] = CANDIDATE_SHA
    write_json(NORMAL, receipt)
    return {'normalVerified': True, 'sourceCommit': args.source_commit, 'apk': receipt['assets'][APK.name],
            'nativeLibraries': len(natives), 'metroDependencySources': npm['metroDependencySourcesCompared'],
            'generatedHeadersHashChecked': native['generatedCppHeaderFilesHashChecked'], 'physicalAcceptance': 'pending'}


def verify_normal(commit, frozen=False, check_checkout=True):
    if check_checkout:
        source_guard(commit)
    else:
        # Preservation verifies the delivered source, not the newer checkout.
        require(re.fullmatch(r'[0-9a-f]{40}', commit or ''), 'Exact retained source commit is required')
        files, _ = source_files(bundle_module(), SOURCE, commit)
        metadata_check(files)
    value = load(NORMAL)
    require(value['schema'] == 1 and value['sourceCommit'] == commit and value['version'] == VERSION and value['versionCode'] == CODE and
            value['certificateSha256'] == CERT and value['privateValueMatches'] == 0 and value['privateValuesChecked'] > 0,
            'Normal receipt identity/private scan mismatch')
    if check_checkout:
        verify_rollback_binding(value)
    require(set(value['assets']) == {APK.name, SOURCE.name}, 'Normal asset set mismatch')
    for path in (APK, SOURCE):
        require_pin(path, value['assets'][path.name])
    require(inspect_apk(APK, CERT) == value['native'], 'Actual frozen APK identity/native verification differs from receipt')
    for row in value['snapshots']:
        relative = PurePosixPath(row['path'])
        require(not relative.is_absolute() and '..' not in relative.parts and '\\' not in row['path'], 'Unsafe snapshot path')
        require_pin(SNAPSHOT / row['path'], {'bytes': row['bytes'], 'sha256': row['sha256']})
    require(digest(read(INVENTORY)) == value['runtimeInventorySha256'], 'Runtime inventory changed')
    if frozen:
        pins = load(FROZEN)
        require(pins['schema'] == 1 and pins['sourceCommit'] == commit and pins['version'] == VERSION and pins['versionCode'] == CODE and
                pins['assets'] == value['assets'] and pins['normalVerificationSha256'] == digest(read(NORMAL)), 'Release pins changed')
    return value


def freeze(commit):
    normal = verify_normal(commit)
    result = {'schema': 1, 'version': VERSION, 'versionCode': CODE, 'sourceCommit': commit,
              'assets': normal['assets'], 'normalVerificationSha256': digest(read(NORMAL)),
              'sourceFileCount': normal['sourceFileCount']}
    write_json(FROZEN, result)
    return {'frozen': True, 'sourceCommit': commit, 'pinsSha256': digest(read(FROZEN))}


def prepare_companion(args):
    normal = verify_normal(args.source_commit, frozen=True)
    require(args.installation_instructions_reviewed, 'Root must review current rebuild/install instructions before operator attestation')
    if REPLACEMENT_SHA is not None:
        replacement_allowed([COMPANION, OUT / 'recombination-check.json', OUT / 'wa-reco-modified-recombination.apk',
                             OUT / 'delivery-pins.json'])
    else:
        require(not COMPANION.exists() and not (OUT / 'recombination-check.json').exists(), 'Companion or recombination evidence exists; review rather than overwrite')
    # Fail before assembly if the operator has not reviewed current captions.
    for kind in ('apk', 'companion'):
        reviewed_caption(kind)
    module = bundle_module()
    built = ROOT / 'android/app/build/outputs/apk/release/app-release.apk'
    inspect_apk(built, MOD_CERT)
    require(digest(read(MOD_AAR)) == MOD_AAR_SHA, 'Reviewed modified SPAKE AAR changed')
    modified_source = ARTIFACTS / 'modified-spake2-1.5.0-source.zip'
    require(digest(read(modified_source)) == PINS[modified_source.name], 'Reviewed complete modified library source changed')
    with zipfile.ZipFile(APK) as original, zipfile.ZipFile(built) as modified:
        require(modified.read('assets/index.android.bundle') == original.read('assets/index.android.bundle'), 'Modified build app JS differs from normal frozen build')
    modified_path = OUT / 'wa-reco-modified-recombination.apk'
    write(modified_path, read(built))
    recombination = OUT / 'recombination-check.json'
    recombination_stage = OUT / 'scratch/release-stage-recombination.json'
    module.record_recombination(SimpleNamespace(apk=str(APK), app_source=str(SOURCE), modified_apk=str(modified_path),
        modified_aar=str(MOD_AAR), modified_source=str(modified_source), output=str(recombination_stage),
        own_key_signed=True, installation_instructions_reviewed=True))
    staged_install(recombination, recombination_stage)
    resolved = load(SNAPSHOT / 'resolved-runtime-private.json')
    def artifact(coordinate):
        rows = [row for row in resolved['artifacts'] if row['id'] == coordinate]
        require(len(rows) == 1, 'Required resolved AAR identity ambiguous')
        path = actual_path(rows[0]['inputPath'], normal['temporaryBuildAlias'])
        require(digest(read(path)) == rows[0]['sha256'], 'Frozen resolved AAR changed')
        return str(path)
    strip = Path(os.environ['LOCALAPPDATA']) / 'Android/Sdk/ndk/28.2.13676358/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-strip.exe'
    require(digest(read(strip, 128 * 1024 * 1024)) == STRIP_SHA, 'Reviewed strip tool changed')
    companion_stage = OUT / 'scratch/release-stage-companion.zip'
    result = module.make_bundle(SimpleNamespace(apk=str(APK), app_source=str(SOURCE),
        spake_source=str(ARTIFACTS / 'spake2-1.5.0-corresponding-source.zip'),
        spake_aar=artifact('com.github.MuntashirAkon.spake2-java:spake2-android:2.2.1'),
        conscrypt_aar=artifact('org.conscrypt:conscrypt-android:2.5.3'),
        inventory=str(INVENTORY), notices=str(ARTIFACTS / 'runtime-notices'),
        recombination=str(recombination), strip_tool=str(strip), require_ready=True, output=str(companion_stage)))
    checked = module.check_bundle(companion_stage)
    require(checked['operatorEvidenceComplete'] is True and not checked['outstandingGates'], 'Companion still has operator gates')
    private_scan([companion_stage])
    staged_install(COMPANION, companion_stage)
    receipt = {'schema': 1, 'sourceCommit': args.source_commit, 'version': VERSION, 'versionCode': CODE,
               'assets': {path.name: pin(path) for path in (APK, SOURCE, COMPANION)},
               'releasePinsSha256': digest(read(FROZEN)), 'recombinationSha256': digest(read(recombination)),
               'companionHashesVerified': checked['hashesVerified'], 'mechanicalChecksPassed': True,
               'operatorEvidenceComplete': True, 'deviceAcceptance': 'pending', 'notLegalCertification': True,
               'captions': {kind: pin(OUT / f'telegram-{kind}-caption.txt') for kind in ('companion', 'apk')}}
    write_json(OUT / 'delivery-pins.json', receipt)
    return {'companionReady': True, 'sourceCommit': args.source_commit, 'companion': receipt['assets'][COMPANION.name],
            'hashesVerified': checked['hashesVerified'], 'physicalAcceptance': 'pending'}


def delivery_guard(commit, check_checkout=True):
    verify_normal(commit, frozen=True, check_checkout=check_checkout)
    result = load(OUT / 'delivery-pins.json')
    require(result['schema'] == 1 and result['sourceCommit'] == commit and result['version'] == VERSION and
            result['versionCode'] == CODE and result['operatorEvidenceComplete'] is True and result['mechanicalChecksPassed'] is True and
            result['releasePinsSha256'] == digest(read(FROZEN)), 'Delivery provenance binding incomplete')
    require(set(result['assets']) == {APK.name, SOURCE.name, COMPANION.name}, 'Delivery asset set mismatch')
    for path in (APK, SOURCE, COMPANION):
        require_pin(path, result['assets'][path.name])
    for kind in ('apk', 'companion'):
        require_pin(OUT / f'telegram-{kind}-caption.txt', result['captions'][kind])
    require(result['recombinationSha256'] == digest(read(OUT / 'recombination-check.json')), 'Recombination receipt changed')
    return result


def current_release_evidence(args, prior_sha):
    """Exact delivered bytes/proofs/receipts; this validator never grants acceptance."""
    delivery = delivery_guard(args.source_commit, check_checkout=False)
    normal = load(NORMAL)
    require(read(OUT / 'resolved-runtime-private.json') == read(SNAPSHOT / 'resolved-runtime-private.json'),
            'Retained direct runtime inventory differs from pinned normal snapshot')
    draft = {'schema': 1, 'sourceCommit': args.source_commit, 'changedInputs': normal['reviewedBuildExportChanges'],
             'reviewed': False, 'dependencyAndLicenseImpactReviewed': False, 'originalCodeNoNewThirdPartyDependency': False}
    require(load(OUT / 'input-review-draft.json') == draft, 'Retained input draft differs from pinned source-bound review')
    require(normal.get('inputReviewSha256') is None or
            digest(read(OUT / 'input-review.json')) == normal['inputReviewSha256'], 'Retained input review changed')
    recombination = load(OUT / 'recombination-check.json')
    modified = OUT / 'wa-reco-modified-recombination.apk'
    require(recombination['appSourceCommit'] == args.source_commit and
            recombination['releaseApkSha256'] == delivery['assets'][APK.name]['sha256'] and
            recombination['appSourceSha256'] == delivery['assets'][SOURCE.name]['sha256'] and
            digest(read(modified)) == recombination['modifiedApkSha256'], 'Retained modified rebuild proof changed')
    inspect_apk(modified, MOD_CERT)
    checked = bundle_module().check_bundle(COMPANION)
    require(checked['operatorEvidenceComplete'] is True and not checked['outstandingGates'] and
            checked['hashesVerified'] == delivery['companionHashesVerified'], 'Retained companion is incomplete')
    current = active_files()
    snapshots = {'normal-snapshot/' + row['path'] for row in normal['snapshots']}
    require(len(normal['snapshots']) == len(snapshots) == 29, 'Approved normal snapshot proof set is incomplete')
    require({name for name in current if name.startswith('normal-snapshot/')} == snapshots,
            'Unknown or missing retained normal snapshot output')
    require(ACTIVE_NAMES - {REPLACEMENT.name} <= set(current), 'Approved canonical release proof set is incomplete')
    if REPLACEMENT.exists():
        state = load(REPLACEMENT)
        expected_keys = {'schema', 'approvedArchiveSha256', 'sourceCommit', 'version', 'versionCode', 'files'}
        candidate_sha = normal.get('preservedCandidateArchiveSha256')
        if candidate_sha is not None:
            expected_keys.add('candidateArchiveSha256')
            candidate, _ = candidate_archive(candidate_sha)
            require(state.get('candidateArchiveSha256') == candidate_sha and
                    candidate['approvedArchiveSha256'] == prior_sha and CODE > candidate['versionCode'],
                    'Retained current candidate predecessor differs from normal proof')
        require(set(state) == expected_keys and state['schema'] == 1 and state['sourceCommit'] == args.source_commit and
                state['version'] == VERSION and state['versionCode'] == CODE and state['approvedArchiveSha256'] == prior_sha and
                isinstance(state['files'], dict) and set(state['files']) == set(current) - {REPLACEMENT.name},
                'Retained replacement journal is not bound to the approved current release')
        for name, expected in state['files'].items():
            require_pin(current[name], expected)
    contents = {'release/' + name: read(path) for name, path in current.items()}
    chat = None
    for kind, asset in [('companion', COMPANION), ('apk', APK)]:
        prefix = f'wa-reco-{VERSION}-{kind}-'
        receipt_path = ARTIFACTS / 'telegram' / (prefix + 'receipt.json')
        attempt_path = ARTIFACTS / 'telegram' / (prefix + 'attempt.json')
        no_links(receipt_path); no_links(attempt_path)
        receipt, attempt = load(receipt_path), load(attempt_path)
        expected = delivery['assets'][asset.name]
        require(receipt.get('state') == 'delivered' and receipt.get('sourceCommit') == args.source_commit and
                receipt.get('file') == asset.name and {'bytes': receipt.get('bytes'), 'sha256': receipt.get('sha256')} == expected and
                receipt.get('captionSha256') == delivery['captions'][kind]['sha256'] and
                receipt.get('destination_verified') is True and receipt.get('document_size_verified') is True and
                receipt.get('provider_ok') is True and isinstance(receipt.get('message_id'), int) and
                isinstance(receipt.get('chat_id'), int), 'Retained delivery receipt does not match approved assets')
        require(attempt.get('state') == 'sending' and all(attempt.get(key) == receipt.get(key)
                for key in ('file', 'bytes', 'sha256', 'sourceCommit', 'chat_id', 'captionSha256', 'started_at_utc')),
                'Retained immutable attempt differs from verified delivery receipt')
        require(chat is None or chat == receipt['chat_id'], 'Retained APK and companion destinations differ')
        chat = receipt['chat_id']
        for path in (receipt_path, attempt_path):
            contents['telegram/' + path.name] = read(path)
    return contents, current


def retained_payload(manifest, contents, manifest_name):
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(contents.items()):
            archive.writestr(name, data)
        archive.writestr(manifest_name, (json.dumps(manifest, indent=2, sort_keys=True) + '\n').encode())
    return payload.getvalue()


def recheck_retained_inputs(manifest, current):
    for name, expected in manifest['files'].items():
        path = OUT / name[len('release/'):] if name.startswith('release/') else ARTIFACTS / name
        require_pin(no_links(path), expected)
    require(set(active_files()) == set(current), 'Canonical release changed while preserving it')


def retain_approved(args):
    """Keep latest approved rollback/proofs in one archive; never delete/move them."""
    require(args.owner_accepted is True and re.fullmatch(r'[0-9a-f]{64}', args.approved_release_pins_sha or ''),
            'Owner acceptance and exact current release-pins SHA256 are required')
    require(REPLACEMENT_SHA is None and CANDIDATE_SHA is None,
            'Preservation and replacement are separate deliberate operations')
    require(digest(read(FROZEN)) == args.approved_release_pins_sha, 'Approved release pins do not match operator pin')
    prior_sha = getattr(args, 'previous_approved_sha', None)
    if APPROVED.exists():
        prior, _ = approved_archive(prior_sha)
        require(CODE > prior['versionCode'], 'Only a later owner-approved release may replace the rollback archive')
    else:
        require(prior_sha is None, 'Previous approved archive pin supplied without an archive')
    contents, current = current_release_evidence(args, prior_sha)
    manifest = {'schema': 1, 'ownerAccepted': True, 'sourceCommit': args.source_commit,
                'version': VERSION, 'versionCode': CODE, 'releasePinsSha256': args.approved_release_pins_sha,
                'files': {name: {'bytes': len(data), 'sha256': digest(data)} for name, data in sorted(contents.items())}}
    data = retained_payload(manifest, contents, 'APPROVED_MANIFEST.json')
    scratch = no_links(OUT / 'scratch')
    scratch.mkdir(parents=True, exist_ok=True)
    stage = scratch / 'release-stage-approved.zip'
    with stage.open('xb') as stream:
        stream.write(data); stream.flush(); os.fsync(stream.fileno())
    new_sha = digest(data)
    staged_manifest, staged_contents = approved_archive(new_sha, stage)
    require(staged_manifest == manifest and staged_contents == contents,
            'New approved archive differs from exact current release evidence')
    # Recheck every input immediately before replacing the sole rollback archive.
    recheck_retained_inputs(manifest, current)
    if APPROVED.exists():
        approved_archive(prior_sha)
        require_pin(no_links(stage), {'bytes': len(data), 'sha256': new_sha})
        os.replace(stage, APPROVED)
    else:
        require_pin(no_links(stage), {'bytes': len(data), 'sha256': new_sha})
        os.rename(stage, APPROVED)
    approved_archive(new_sha)
    return {'retained': True, 'version': VERSION, 'sourceCommit': args.source_commit,
            'approvedArchive': {'bytes': len(data), 'sha256': new_sha}, 'filesPreserved': len(contents),
            'activeFilesChanged': False, 'physicalAcceptance': 'owner-reported'}


def retain_candidate(args):
    """Preserve a delivered unaccepted successor; leave approved rollback untouched."""
    require(not args.owner_accepted and REPLACEMENT_SHA is None and CANDIDATE_SHA is None,
            'Candidate retention is separate from acceptance and replacement')
    require(re.fullmatch(r'[0-9a-f]{64}', args.current_release_pins_sha or '') and
            re.fullmatch(r'[0-9a-f]{64}', args.current_delivery_pins_sha or ''),
            'Exact current release and delivery pins are required')
    require(digest(read(FROZEN)) == args.current_release_pins_sha and
            digest(read(OUT / 'delivery-pins.json')) == args.current_delivery_pins_sha,
            'Current candidate pins do not match operator pins')
    accepted, _ = approved_archive(args.approved_archive_sha)
    require(CODE > accepted['versionCode'] and VERSION != accepted['version'] and
            args.source_commit != accepted['sourceCommit'], 'Candidate must be later than the approved rollback')
    prior_candidate_sha = args.previous_candidate_sha
    if CANDIDATE.exists():
        prior_candidate, _ = candidate_archive(prior_candidate_sha)
        require(CODE > prior_candidate['versionCode'] and VERSION != prior_candidate['version'] and
                args.source_commit != prior_candidate['sourceCommit'], 'Candidate retention must advance its exact predecessor')
    else:
        require(prior_candidate_sha is None, 'Previous candidate pin supplied without a candidate archive')
    contents, current = current_release_evidence(args, args.approved_archive_sha)
    require(REPLACEMENT.name in current, 'Delivered candidate lacks its complete replacement journal')
    manifest = {'schema': 1, 'ownerAccepted': False, 'sourceCommit': args.source_commit,
                'version': VERSION, 'versionCode': CODE, 'releasePinsSha256': args.current_release_pins_sha,
                'deliveryPinsSha256': args.current_delivery_pins_sha, 'approvedArchiveSha256': args.approved_archive_sha,
                'files': {name: {'bytes': len(data), 'sha256': digest(data)} for name, data in sorted(contents.items())}}
    data = retained_payload(manifest, contents, 'CANDIDATE_MANIFEST.json')
    scratch = no_links(OUT / 'scratch')
    scratch.mkdir(parents=True, exist_ok=True)
    stage = scratch / 'release-stage-candidate.zip'
    with stage.open('xb') as stream:
        stream.write(data); stream.flush(); os.fsync(stream.fileno())
    new_sha = digest(data)
    staged_manifest, staged_contents = candidate_archive(new_sha, stage)
    require(staged_manifest == manifest and staged_contents == contents,
            'New candidate archive differs from exact current release evidence')
    recheck_retained_inputs(manifest, current)
    approved_archive(args.approved_archive_sha)
    if CANDIDATE.exists():
        candidate_archive(prior_candidate_sha)
    require_pin(no_links(stage), {'bytes': len(data), 'sha256': new_sha})
    if CANDIDATE.exists():
        os.replace(stage, CANDIDATE)
    else:
        os.rename(stage, CANDIDATE)
    candidate_archive(new_sha)
    return {'retained': True, 'ownerAccepted': False, 'version': VERSION, 'sourceCommit': args.source_commit,
            'candidateArchive': {'bytes': len(data), 'sha256': new_sha}, 'filesPreserved': len(contents),
            'approvedArchiveSha256': args.approved_archive_sha, 'activeFilesChanged': False,
            'physicalAcceptance': 'pending'}


def export_source(args):
    source_guard(args.source_commit)
    require(git('rev-parse', 'HEAD').decode().strip() == args.source_commit,
            'Export final frozen HEAD before later metadata commits')
    if REPLACEMENT_SHA is not None:
        replacement_allowed([SOURCE])
    else:
        require(not SOURCE.exists(), 'Source output exists; preserve approved release first')
    scratch = no_links(OUT / 'scratch')
    scratch.mkdir(parents=True, exist_ok=True)
    stage = scratch / 'release-stage-source.zip'
    require(not stage.exists(), 'Source staging exists; inspect interrupted operation')
    spec = importlib.util.spec_from_file_location('exact_canonical_source_export', ROOT / 'tools/export-public-source.py')
    exporter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(exporter)
    with redirect_stdout(io.StringIO()):
        exporter.export(ROOT, stage)
    files, manifest = source_files(bundle_module(), stage, args.source_commit)
    metadata_check(files)
    source_guard(args.source_commit)
    staged_install(SOURCE, stage)
    return {'exported': True, 'sourceCommit': args.source_commit, 'files': manifest['fileCount'], **pin(SOURCE)}


def accept_review(args):
    source_guard(args.source_commit)
    require(args.review_file is not None and Path(args.review_file).resolve().parent == OUT / 'scratch',
            'Supply the reviewed draft in canonical scratch, not a current frozen output')
    module = bundle_module()
    files, _ = source_files(module, SOURCE, args.source_commit)
    metadata_check(files)
    _, review_sha = reviewed_changes(module, files, args.source_commit, no_links(args.review_file))
    write(OUT / 'input-review.json', read(args.review_file))
    return {'reviewAccepted': True, 'sourceCommit': args.source_commit, 'inputReviewSha256': review_sha}


def set_caption(args):
    source_guard(args.source_commit)
    require(args.caption_file is not None and Path(args.caption_file).resolve().parent == OUT / 'scratch',
            'Supply the reviewed caption in canonical scratch')
    data = read(no_links(args.caption_file), 4096)
    validate_caption(data.decode('utf-8').strip())
    write(OUT / f'telegram-{args.kind}-caption.txt', data)
    return {'captionAccepted': True, 'kind': args.kind, 'version': VERSION, 'sha256': digest(data)}


def accept_inventory(args):
    source_guard(args.source_commit)
    stage = no_links(args.inventory_file) if args.inventory_file is not None else None
    require(stage == OUT / 'scratch/release-stage-runtime.json', 'Supply the fixed newly generated runtime inventory stage')
    files, _ = source_files(bundle_module(), SOURCE, args.source_commit)
    metadata_check(files)
    resolved = load(stage)
    retained, _ = retained_reviews()
    require(runtime_rows(resolved) == runtime_rows(loads(retained['resolved-runtime-final-private.json'])),
            'Fresh staged runtime graph differs from reviewed inputs')
    for row in resolved['artifacts']:
        require(digest(read(actual_path(row['inputPath'], args.build_alias))) == row['sha256'],
                'Staged runtime artifact differs from actual reviewed bytes')
    staged_install(OUT / 'resolved-runtime-private.json', stage)
    return {'inventoryAccepted': True, 'sourceCommit': args.source_commit,
            'artifactsVerified': len(resolved['artifacts']), **pin(OUT / 'resolved-runtime-private.json')}


def config():
    path = ROOT / '.env'
    require(path.is_file() and path.stat().st_size <= 1024 * 1024, 'Private Telegram configuration unavailable')
    values = {}
    for line in path.read_text(encoding='utf-8-sig').splitlines():
        match = re.match(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$', line)
        if match:
            value = match.group(2)
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            else:
                value = value.split(' #', 1)[0].strip()
            values[match.group(1)] = value
    token, chat = values.get('TELEGRAM_BOT_TOKEN', ''), values.get('TELEGRAM_CHAT_ID', '')
    require(re.fullmatch(r'\d+:[A-Za-z0-9_-]+', token) and re.fullmatch(r'-?\d+|@[A-Za-z0-9_]+', chat),
            'Private Telegram configuration missing or invalid')
    return token, chat


def api_json(request, timeout):
    # No raw HTTP exception/provider body can escape with a token-bearing URL.
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = response.read(2 * 1024 * 1024 + 1)
        require(len(data) <= 2 * 1024 * 1024, 'Provider response exceeded bounds')
        return loads(data)
    except Exception:
        raise ReleaseError('Telegram provider request failed; credentials and provider details suppressed') from None


def authorized_destination():
    token, chat = config()
    endpoint = 'https://api.telegram.org/bot' + token + '/'
    destination = api_json(urllib.request.Request(endpoint + 'getChat',
                           data=urllib.parse.urlencode({'chat_id': chat}).encode()), 30)
    require(destination.get('ok') is True and isinstance(destination.get('result', {}).get('id'), int),
            'Authorized chat could not be verified')
    expected_chat = destination['result']['id']
    require(not re.fullmatch(r'-?\d+', chat) or str(expected_chat) == chat, 'Authorized destination mismatch')
    return endpoint, expected_chat


def reviewed_caption(kind):
    require(kind in ('apk', 'companion'), 'Unknown delivery caption kind')
    caption = read(OUT / f'telegram-{kind}-caption.txt', 4096).decode('utf-8').strip()
    validate_caption(caption)
    return caption


def validate_caption(caption):
    require(VERSION is not None and caption.startswith('wa-reco ' + VERSION + ' '),
            'Reviewed caption does not match expected release version')
    require(len(caption) <= 1024, 'Reviewed document caption exceeds Telegram limit')


def send(args):
    pins = delivery_guard(args.source_commit)
    path = APK if args.kind == 'apk' else COMPANION
    caption = reviewed_caption(args.kind)
    output = ARTIFACTS / 'telegram'
    receipt = output / f'wa-reco-{VERSION}-{args.kind}-receipt.json'
    attempt = output / f'wa-reco-{VERSION}-{args.kind}-attempt.json'
    if receipt.exists():
        previous = load(receipt)
        require(previous['state'] == 'delivered' and previous['sourceCommit'] == args.source_commit and
                previous['file'] == path.name and {'bytes': previous['bytes'], 'sha256': previous['sha256']} == pins['assets'][path.name] and
                previous['destination_verified'] is True and previous['document_size_verified'] is True,
                'Previous delivery receipt does not match these frozen artifacts')
        if args.send:
            _, current_chat = authorized_destination()
            require(previous.get('chat_id') == current_chat,
                    'Previous delivery destination differs from current authorized destination; no resend')
        return {'alreadyDelivered': True, 'file': path.name, 'message_id': previous['message_id'],
                'currentDestinationRechecked': args.send}
    require(not attempt.exists(), 'Prior Telegram attempt needs outcome review; no automatic resend')
    if not args.send:
        return {'sent': False, 'file': path.name, **pins['assets'][path.name], 'sourceCommit': args.source_commit,
                'captionSha256': pins['captions'][args.kind]['sha256'], 'explicitSendFlagRequired': True}
    if args.kind == 'apk':
        companion_receipt = output / f'wa-reco-{VERSION}-companion-receipt.json'
        require(companion_receipt.exists() and load(companion_receipt).get('state') == 'delivered',
                'Deliver matching source/notices companion before APK')
    endpoint, expected_chat = authorized_destination()
    if args.kind == 'apk':
        companion = load(output / f'wa-reco-{VERSION}-companion-receipt.json')
        require(companion['chat_id'] == expected_chat and companion['sourceCommit'] == args.source_commit and
                {'bytes': companion['bytes'], 'sha256': companion['sha256']} == pins['assets'][COMPANION.name],
                'Companion destination/source/bytes differ from APK delivery')
    payload = read(path, 50 * 1024 * 1024)
    require({'bytes': len(payload), 'sha256': digest(payload)} == pins['assets'][path.name], 'Payload changed before send')
    boundary = 'wa-reco-' + uuid.uuid4().hex
    parts = [('--' + boundary + '\r\nContent-Disposition: form-data; name="' + key + '"\r\n\r\n' + value + '\r\n').encode()
             for key, value in [('chat_id', str(expected_chat)), ('caption', caption)]]
    mime = 'application/vnd.android.package-archive' if args.kind == 'apk' else 'application/zip'
    parts.extend([('--' + boundary + '\r\nContent-Disposition: form-data; name="document"; filename="' + path.name + '"\r\nContent-Type: ' + mime + '\r\n\r\n').encode(),
                  payload, ('\r\n--' + boundary + '--\r\n').encode()])
    evidence = {'state': 'sending', 'file': path.name, **pins['assets'][path.name], 'sourceCommit': args.source_commit,
                'chat_id': expected_chat, 'captionSha256': pins['captions'][args.kind]['sha256'],
                'started_at_utc': dt.datetime.now(dt.timezone.utc).isoformat()}
    write_json(attempt, evidence)
    try:
        result = api_json(urllib.request.Request(endpoint + 'sendDocument', data=b''.join(parts),
                          headers={'Content-Type': 'multipart/form-data; boundary=' + boundary}), 120)
        message = result.get('result', {})
        document = message.get('document', {})
        require(result.get('ok') is True and message.get('chat', {}).get('id') == expected_chat and
                document.get('file_name') == path.name and document.get('file_size') == len(payload) and
                isinstance(message.get('message_id'), int) and isinstance(document.get('file_id'), str),
                'Telegram response receipt did not match exact document')
        evidence.update(state='delivered', message_id=message['message_id'], telegram_file_id=document['file_id'],
                        destination_verified=True, document_size_verified=True, provider_ok=True)
        write_json(receipt, evidence)
        # Preserve the original sending attempt; the exclusive receipt resolves it.
        return {key: evidence[key] for key in ('state', 'file', 'bytes', 'sha256', 'sourceCommit', 'message_id', 'destination_verified', 'document_size_verified')}
    except Exception:
        raise ReleaseError('Telegram delivery outcome requires review; sending attempt preserved; do not retry') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['retain-approved', 'retain-candidate', 'export-source', 'accept-review', 'set-caption', 'accept-inventory', 'review-draft',
                                       'hydrate-reviewed-archives', 'snapshot-normal', 'verify', 'freeze', 'prepare-companion', 'send'])
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--version-code', type=int, required=True)
    parser.add_argument('--build-alias', default='W')
    parser.add_argument('--build-log', type=Path)
    parser.add_argument('--review-file', type=Path)
    parser.add_argument('--caption-file', type=Path)
    parser.add_argument('--inventory-file', type=Path)
    parser.add_argument('--approved-release-pins-sha')
    parser.add_argument('--previous-approved-sha')
    parser.add_argument('--current-release-pins-sha')
    parser.add_argument('--current-delivery-pins-sha')
    parser.add_argument('--approved-archive-sha')
    parser.add_argument('--previous-candidate-sha')
    parser.add_argument('--owner-accepted', action='store_true')
    parser.add_argument('--replace-approved', metavar='EXACT_ARCHIVE_SHA256')
    parser.add_argument('--replace-candidate', metavar='EXACT_CANDIDATE_SHA256')
    parser.add_argument('--installation-instructions-reviewed', action='store_true')
    parser.add_argument('--kind', choices=['companion', 'apk'], default='companion')
    parser.add_argument('--send', action='store_true')
    parser.add_argument('--fetch', action='store_true')
    args = parser.parse_args()
    require(Path(__file__).resolve() == ROOT / 'tools/release-compliance/release.py',
            'Release helper is outside its canonical tool path')
    configure_release(args.version, args.version_code)
    require(re.fullmatch(r'[A-Za-z]', args.build_alias), 'Build alias must be one drive letter')
    global REPLACEMENT_SHA, REPLACEMENT_COMMIT, CANDIDATE_SHA
    REPLACEMENT_SHA, REPLACEMENT_COMMIT, CANDIDATE_SHA = args.replace_approved, args.source_commit, args.replace_candidate
    require(CANDIDATE_SHA is None or REPLACEMENT_SHA is not None,
            'Candidate replacement also requires the exact approved rollback pin')
    if REPLACEMENT_SHA is not None:
        require(args.mode in {'export-source', 'accept-review', 'set-caption', 'accept-inventory', 'review-draft', 'snapshot-normal',
                              'freeze', 'prepare-companion'}, 'Replacement is permitted only for canonical successor output creation')
        replacement_state()
    if args.mode == 'retain-approved':
        result = retain_approved(args)
    elif args.mode == 'retain-candidate':
        result = retain_candidate(args)
    elif args.mode == 'export-source':
        result = export_source(args)
    elif args.mode == 'accept-review':
        result = accept_review(args)
    elif args.mode == 'set-caption':
        result = set_caption(args)
    elif args.mode == 'accept-inventory':
        result = accept_inventory(args)
    elif args.mode == 'hydrate-reviewed-archives':
        result = hydrate_archives(args)
    elif args.mode == 'review-draft':
        source_guard(args.source_commit)
        module = bundle_module()
        files, _ = source_files(module, SOURCE, args.source_commit)
        metadata_check(files)
        changes, _ = reviewed_changes(module, files, args.source_commit)
        result = {'schema': 1, 'sourceCommit': args.source_commit, 'changedInputs': changes, 'reviewed': False,
                  'dependencyAndLicenseImpactReviewed': False, 'originalCodeNoNewThirdPartyDependency': False}
        write_json(OUT / 'input-review-draft.json', result)
        result = {'draftCreated': True, 'changedInputs': changes, 'requiresActualRootReview': bool(changes)}
    elif args.mode == 'snapshot-normal':
        result = snapshot_normal(args)
    elif args.mode == 'verify':
        value = verify_normal(args.source_commit, frozen=FROZEN.exists())
        result = {'verified': True, 'sourceCommit': args.source_commit, 'assets': value['assets'],
                  'snapshotFilesVerified': len(value['snapshots']), 'physicalAcceptance': 'pending'}
    elif args.mode == 'freeze':
        result = freeze(args.source_commit)
    elif args.mode == 'prepare-companion':
        result = prepare_companion(args)
    else:
        result = send(args)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Never reveal raw provider/network/subprocess exceptions or private paths.
        print(json.dumps({'ok': False, 'error': str(error) if isinstance(error, ReleaseError)
                          else 'Release check failed; private/provider details suppressed.'}))
        raise SystemExit(1) from None
