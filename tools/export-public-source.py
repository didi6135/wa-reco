#!/usr/bin/env python3
"""Export a reviewed commit, never a private working directory or Git history."""
import argparse
import hashlib
import json
import re
import subprocess
import zipfile
from pathlib import Path, PurePosixPath

ROOT_FILES = {
    '.gitignore', 'App.tsx', 'app.json', 'index.ts', 'package.json',
    'package-lock.json', 'tsconfig.json', 'README.md', 'LICENSE',
    'THIRD_PARTY_NOTICES.md',
}
PREFIXES = (
    'android/', 'src/', 'assets/', 'docs/', 'LICENSES/',
    'tools/usb-audio-helper/', 'tools/drive-backup-tests/', 'tools/ui-preview/',
    'tools/public-source-tests/',
    'tools/release-compliance/',
    'tools/android-device-matrix/',
    'tools/telegram-backup-tests/',
    'tools/telegram-backup-tests/', 'website/',
)
TOOL_FILES = {
    'tools/export-public-source.py', 'tools/test-drive-ui.cjs',
    'tools/test-telegram-ui.cjs', 'tools/build-android.ps1',
}
PRIVATE_PARTS = {
    '.git', '.planning', 'artifacts', 'node_modules', '.gradle', '.cxx',
    '.idea', 'build', '__pycache__', '.expo', '.kotlin', '.openai',
}
PRIVATE_SUFFIXES = {
    '.jks', '.keystore', '.pem', '.p12', '.p8', '.key', '.mobileprovision',
    '.wav', '.m4a', '.mp3', '.aac', '.pcm', '.apk', '.aab', '.log',
    '.aar', '.so', '.zip', '.7z', '.sqlite', '.db', '.jsonl',
}
PATTERNS = (
    ('private key', re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----')),
    ('Telegram bot token', re.compile(rb'\b[0-9]{6,12}:[A-Za-z0-9_-]{30,}\b')),
    ('Google API key', re.compile(rb'\bAIza[0-9A-Za-z_-]{35}\b')),
    ('Google OAuth client secret', re.compile(rb'\bGOCSPX-[A-Za-z0-9_-]+')),
    ('Google refresh token', re.compile(rb'\b1//[A-Za-z0-9_-]{30,}')),
    ('private Windows user path', re.compile(rb'[A-Za-z]:[\\/]Users[\\/][^\s\x00<>]+', re.I)),
    ('Samsung device serial', re.compile(rb'\bR[0-9][A-Z][A-Z0-9]{8}\b')),
)


def included(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or '\\' in name:
        return False
    if any(part in PRIVATE_PARTS for part in path.parts):
        return False
    if path.name.startswith('.env') or path.name in {'local.properties', 'signing.properties'}:
        return False
    if path.suffix.lower() == '.jar' and name != 'android/gradle/wrapper/gradle-wrapper.jar':
        return False
    # This conventional Android debug key is public, not a release credential.
    if name != 'android/app/debug.keystore' and path.suffix.lower() in PRIVATE_SUFFIXES:
        return False
    return name in ROOT_FILES or name in TOOL_FILES or name.startswith(PREFIXES)


def findings(name, content):
    # Scan text-like sources, not PNG/WebP/JAR or the conventional debug key.
    if PurePosixPath(name).suffix.lower() in {'.png', '.webp', '.jar', '.keystore'}:
        return []
    return [label for label, pattern in PATTERNS if pattern.search(content)]


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args])


def export(root, output):
    commit = git(root, 'rev-parse', 'HEAD').decode().strip()
    records = git(root, 'ls-tree', '-r', '-z', commit).split(b'\0')
    files = []
    skipped = 0
    for record in records:
        if not record:
            continue
        metadata, raw_name = record.split(b'\t', 1)
        mode, kind, object_id = metadata.decode().split()
        name = raw_name.decode('utf-8')
        if not included(name):
            skipped += 1
            continue
        if kind != 'blob' or mode not in {'100644', '100755'}:
            raise ValueError(f'Unsupported source entry: {name}')
        content = git(root, 'cat-file', 'blob', object_id)
        if name == 'android/app/debug.keystore' and hashlib.sha256(content).hexdigest() != '221e0a3106aa4c3ccc154e0a418b55020b3f9ea6e84f92e8749cd9e2f39f5e58':
            raise ValueError('The public debug keystore changed; review it before export.')
        issues = findings(name, content)
        if issues:
            raise ValueError(f'Review required in {name}: {", ".join(issues)}')
        files.append((name, mode, content))
    for required in ('README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'package-lock.json',
                     'docs/google-drive-setup.md', 'android/app/build.gradle'):
        if required not in {entry[0] for entry in files}:
            raise ValueError(f'Missing required committed source file: {required}')
    # Refuse replacing a previously delivered snapshot; choose a new filename.
    output.parent.mkdir(parents=True, exist_ok=True)
    manifest = {
        'sourceCommit': commit, 'fileCount': len(files), 'excludedCount': skipped,
        'files': [{'path': name, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()}
                  for name, _, content in files],
    }
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, mode, content in files:
            info = zipfile.ZipInfo('WhatsAppCallRecorder/' + name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = int(mode, 8) << 16
            archive.writestr(info, content)
        info = zipfile.ZipInfo('WhatsAppCallRecorder/SOURCE_MANIFEST.json', (2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, json.dumps(manifest, indent=2).encode('utf-8'))
    print(json.dumps({
        'sourceCommit': commit, 'files': len(files), 'excluded': skipped,
        'bytes': output.stat().st_size, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
        'archive': str(output),
    }, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    export(Path(__file__).resolve().parent.parent, args.output.resolve())
