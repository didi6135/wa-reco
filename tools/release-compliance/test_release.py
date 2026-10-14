"""In-memory delivery regressions. No credentials/network/artifact writes."""
import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
from contextlib import ExitStack, nullcontext
import unittest
import warnings
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('canonical_release_under_test', Path(__file__).with_name('release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
release.configure_release('1.5.6', 17)


class ReceiptReuseTests(unittest.TestCase):
    def exercise(self, actual_send, stored_chat=111, current_chat=111):
        args = SimpleNamespace(source_commit='a' * 40, kind='companion', send=actual_send)
        pin = {'bytes': 3, 'sha256': 'b' * 64}
        pins = {'assets': {release.COMPANION.name: pin}, 'captions': {'companion': {'sha256': 'c' * 64}}}
        previous = {'state': 'delivered', 'sourceCommit': args.source_commit, 'file': release.COMPANION.name,
                    **pin, 'destination_verified': True, 'document_size_verified': True,
                    'message_id': 123, 'chat_id': stored_chat}
        with patch.object(release, 'delivery_guard', return_value=pins), \
             patch.object(release, 'read', return_value=b'wa-reco 1.5.6 reviewed caption'), \
             patch.object(Path, 'exists', return_value=True), \
             patch.object(release, 'load', return_value=previous), \
             patch.object(release, 'authorized_destination', return_value=('unused', current_chat)) as destination, \
             patch.object(release, 'api_json', side_effect=AssertionError('No document may be sent')), \
             patch.object(release, 'write_json', side_effect=AssertionError('No evidence may be changed')):
            result = release.send(args)
            self.assertEqual(destination.call_count, int(actual_send))
            return result

    def test_matching_current_destination_reuses_receipt_without_resend(self):
        result = self.exercise(True)
        self.assertTrue(result['alreadyDelivered'])
        self.assertTrue(result['currentDestinationRechecked'])

    def test_changed_current_destination_blocks_receipt_reuse_without_resend(self):
        with self.assertRaisesRegex(release.ReleaseError, 'differs from current authorized destination'):
            self.exercise(True, stored_chat=111, current_chat=222)

    def test_dry_reuse_does_not_access_credentials_or_provider(self):
        result = self.exercise(False, stored_chat=111, current_chat=222)
        self.assertTrue(result['alreadyDelivered'])
        self.assertFalse(result['currentDestinationRechecked'])

    def test_getchat_cannot_override_configured_numeric_chat(self):
        with patch.object(release, 'config', return_value=('synthetic', '111')), \
             patch.object(release, 'api_json', return_value={'ok': True, 'result': {'id': 222}}):
            with self.assertRaisesRegex(release.ReleaseError, 'Authorized destination mismatch'):
                release.authorized_destination()


class SignerParsingTests(unittest.TestCase):
    def signature(self, signer=release.CERT, count=1, number=1, dn='synthetic'):
        return (f'Verified using v2 scheme (APK Signature Scheme v2): true\nNumber of signers: {count}\n'
                f'Signer #{number} certificate DN: CN={dn}\nSigner #{number} certificate SHA-256 digest: {signer}\n')

    def test_actual_expected_single_signer_passes(self):
        release.require_single_signer(self.signature(), release.CERT)

    def test_expected_digest_inside_dn_cannot_impersonate_certificate(self):
        with self.assertRaises(release.ReleaseError):
            release.require_single_signer(self.signature(signer='a' * 64, dn=release.CERT), release.CERT)

    def test_multiple_signers_rejected(self):
        with self.assertRaises(release.ReleaseError):
            release.require_single_signer(self.signature(count=2), release.CERT)

    def test_repeated_or_other_number_certificate_rejected(self):
        for value in [self.signature(number=2), self.signature() + f'Signer #1 certificate SHA-256 digest: {release.CERT}\n']:
            with self.assertRaises(release.ReleaseError):
                release.require_single_signer(value, release.CERT)


class MetroApplicationPathTests(unittest.TestCase):
    def setUp(self):
        # Deliberately put the root basename first, matching the export that
        # originally caused nested modules to be compared with root index.ts.
        self.files = {'index.ts': b'root entry\n', 'src/i18n/index.ts': b'locale entry\n',
                      'src/theme/index.ts': b'theme entry\n'}

    def test_three_distinct_same_basename_modules_match_their_own_contents(self):
        cases = [('/index.ts', 'root entry\n', 'index.ts'),
                 ('/src/i18n/index.ts', 'locale entry\n', 'src/i18n/index.ts'),
                 ('/src/theme/index.ts', 'theme entry\n', 'src/theme/index.ts')]
        for name, content, expected in cases:
            self.assertEqual(release.exported_application_source(name, content, self.files), expected)

    def test_exact_and_build_prefixed_windows_paths_select_nested_frozen_module(self):
        for name in ['src/i18n/index.ts', 'W:\\workspace\\src\\i18n\\index.ts',
                     '/physical/project/src/i18n/index.ts']:
            self.assertEqual(release.exported_application_source(name, 'locale entry\n', self.files),
                             'src/i18n/index.ts')

    def test_wrong_nested_contents_cannot_pass_by_matching_root_basename(self):
        with self.assertRaisesRegex(release.ReleaseError, 'differs from frozen export'):
            release.exported_application_source('/src/i18n/index.ts', 'root entry\n', self.files)

    def test_mapped_root_contents_still_require_exact_frozen_comparison(self):
        with self.assertRaisesRegex(release.ReleaseError, 'differs from frozen export'):
            release.exported_application_source('/index.ts', 'tampered root entry\n', self.files)

    def test_virtual_unmapped_source_is_not_assigned_an_application_file(self):
        self.assertIsNone(release.exported_application_source('__prelude__', 'virtual', self.files))


class BinaryPngBindingTests(unittest.TestCase):
    def setUp(self):
        self.png = b'\x89PNG\r\n\x1a\nsynthetic exact binary bytes'
        self.generated = [('drawable-mdpi/known.png', self.png)]
        self.packaged = [('res/ab.png', self.png)]

    def test_exact_binary_binding_passes_without_decoding_or_normalization(self):
        result = release.png_byte_binding(self.png, self.png, self.generated, self.packaged)
        self.assertTrue(result['publishedInstalledGeneratedPackagedBytesExact'])
        self.assertEqual(result['sha256'], release.digest(self.png))

    def test_installed_asset_change_is_rejected(self):
        with self.assertRaises(release.ReleaseError):
            release.png_byte_binding(self.png, self.png + b'changed', self.generated, self.packaged)

    def test_generated_resource_change_is_rejected(self):
        with self.assertRaises(release.ReleaseError):
            release.png_byte_binding(self.png, self.png, [('drawable-mdpi/known.png', self.png + b'changed')], self.packaged)

    def test_packaged_resource_transformation_is_rejected(self):
        with self.assertRaises(release.ReleaseError):
            release.png_byte_binding(self.png, self.png, self.generated, [('res/ab.png', self.png + b'transformed')])

    def test_absent_or_ambiguous_resource_binding_is_rejected(self):
        for generated, packaged in [(self.generated, []), ([], self.packaged),
                                     (self.generated * 2, self.packaged), (self.generated, self.packaged * 2)]:
            with self.assertRaises(release.ReleaseError):
                release.png_byte_binding(self.png, self.png, generated, packaged)

    def test_unlisted_png_or_nonempty_placeholder_does_not_gain_exception(self):
        for package, member, source in [('node_modules/other', 'lib/module/assets/back-icon.png', ''),
                                        ('node_modules/@react-navigation/elements', 'lib/module/assets/unknown.png', ''),
                                        ('node_modules/@react-navigation/elements', 'lib/module/assets/back-icon.png', 'text')]:
            with self.assertRaisesRegex(release.ReleaseError, 'not a recognized pinned binary PNG'):
                release.verify_empty_png_asset(package, member, source, self.png, b'not used')


class ExpoNativeProvenanceTests(unittest.TestCase):
    """Exercise the actual provenance gate with synthetic, in-memory inputs."""

    def exercise(self, fault=None):
        library = 'libexpo-modules-core.so'
        relative = 'node_modules/expo-modules-core/common/cpp/Module.cpp'
        source = release.ROOT / relative
        model_path = release.ROOT / 'node_modules/expo-modules-core/android/build/intermediates/cxx/RelWithDebInfo/unit/logs/arm64-v8a/build_model.json'
        folder = release.ROOT / 'artifacts/cxx/expo-unit'
        metadata_path = folder / 'android_gradle_build.json'
        command_path = folder / 'compile_commands.json'
        target = release.ROOT / 'node_modules/expo-modules-core/android/build/intermediates/cxx/RelWithDebInfo/unit/obj/arm64-v8a' / library
        merged = release.ROOT / 'android/app/build/intermediates/merged_native_libs/release/mergeReleaseNativeLibs/out/lib/arm64-v8a' / library
        stripped = release.ROOT / 'android/app/build/intermediates/stripped_native_libs/release/stripReleaseDebugSymbols/out/lib/arm64-v8a' / library
        package_json = release.ROOT / 'node_modules/expo-modules-core/package.json'
        tool_bytes, generated_bytes, merged_bytes, packaged = b'synthetic strip tool', b'generated baseline', b'unstripped target', b'packaged output'
        baseline = {'generatedSourceBaselineChecks': {'generatedCppHeaderFiles': [
            {'source': f'android/app/build/generated/unit/{i}.h', 'sha256': release.digest(generated_bytes)}
            for i in range(84)]}}
        model = {'cxxBuildFolder': str(folder), 'variant': {'module': {'ndkVersion': '28.2.13676358'}, 'variantName': 'release'},
                 'info': {'name': 'arm64-v8a'}}
        metadata = {'libraries': {'expo': {'output': str(target)}}}
        commands = [{'file': str(source), 'command': 'C:/sdk/ndk/28.2.13676358/clang++ --target=aarch64-none-linux-android24 -c source.cpp'}]
        inputs = {release.OLD_NATIVE_PROOF: b'synthetic retained proof', model_path: json.dumps(model).encode(),
                  metadata_path: json.dumps(metadata).encode(), command_path: json.dumps(commands).encode(),
                  source: b'exact publisher source', target: merged_bytes, merged: merged_bytes, stripped: packaged,
                  release.ROOT / 'android/app/build/generated/autolinking/src/main/jni/Android-autolinking.cmake': b'current cmake'}
        for row in baseline['generatedSourceBaselineChecks']['generatedCppHeaderFiles']:
            inputs[release.ROOT / row['source']] = generated_bytes
        loaded = {release.OLD_NATIVE_PROOF: baseline, model_path: model, metadata_path: metadata,
                  command_path: commands, package_json: {'version': '2.2.3'}}
        publisher = {relative: release.digest(inputs[source])}
        models = [model_path]
        if fault == 'source-change':
            inputs[source] += b'changed'
        elif fault == 'unpublished-source':
            publisher = {'node_modules/expo-modules-core/common/cpp/Other.cpp': publisher[relative]}
        elif fault == 'missing-index':
            publisher = {}
        elif fault == 'target-change':
            inputs[target] += b'changed'
        elif fault == 'stripped-change':
            inputs[stripped] += b'changed'
        elif fault == 'missing-model':
            models = []
        elif fault == 'ambiguous-model':
            models *= 2
        elif fault == 'wrong-ndk':
            model['variant']['module']['ndkVersion'] = 'other'
        elif fault == 'wrong-compile-target':
            commands[0]['command'] = commands[0]['command'].replace('android24', 'android35')

        def archive(old):
            output = io.BytesIO()
            with zipfile.ZipFile(output, 'w') as apk:
                apk.writestr('lib/arm64-v8a/' + library, b'prior local build' if old else packaged)
                for i in range(18):
                    apk.writestr(f'lib/arm64-v8a/prebuilt{i}.so',
                                 b'changed prebuilt' if not old and i == 0 and fault == 'prebuilt-change' else b'pinned prebuilt')
            return output.getvalue()

        def read_input(path, maximum=None):
            path = Path(path)
            if path.name == 'llvm-strip.exe':
                return tool_bytes
            return inputs[path]

        strip_runs = []
        def run_strip(arguments, timeout=None):
            strip_runs.append(arguments)
            inputs[Path(arguments[3])] = packaged + (b'changed second transform' if fault == 'second-strip-change' and len(strip_runs) == 2 else b'')
            return ''

        with ExitStack() as stack:
            stack.enter_context(patch.object(release, 'PROJECT_LIBS', {library: 'expo-modules-core'}))
            stack.enter_context(patch.object(release, 'OLD_NATIVE_PROOF_SHA', release.digest(inputs[release.OLD_NATIVE_PROOF])))
            stack.enter_context(patch.object(release, 'STRIP_SHA', release.digest(tool_bytes)))
            stack.enter_context(patch.object(release, 'read', side_effect=read_input))
            stack.enter_context(patch.object(release, 'load', side_effect=lambda path: loaded[Path(path)]))
            stack.enter_context(patch.object(release, 'run', side_effect=run_strip))
            stack.enter_context(patch.object(Path, 'glob', return_value=models))
            stack.enter_context(patch.object(Path, 'is_file', return_value=True))
            stack.enter_context(patch.object(Path, 'mkdir', return_value=None))
            stack.enter_context(patch.object(release.tempfile, 'TemporaryDirectory', return_value=nullcontext(str(release.OUT / 'strip-staging/synthetic'))))
            snapshots = {}
            result = release.native_proof(archive(False), {'wa-reco-1.5.0.apk': archive(True)},
                                          {'components': [{'id': 'npm:expo-modules-core@2.2.3'}]}, 'W', snapshots, publisher)
        return result, strip_runs, snapshots

    def test_exact_publisher_cxx_merged_and_two_strip_bindings_pass(self):
        result, runs, snapshots = self.exercise()
        expo = result['projectLibraries'][0]
        self.assertTrue(expo['publisherCompiledSourcesExact'])
        self.assertEqual(expo['sourceOrigins'][0]['sha256'], expo['sourceOrigins'][0]['publisherSourceSha256'])
        self.assertEqual(expo['mergedSha256'], expo['cxxTargetSha256'])
        self.assertEqual(len(runs), 2)
        self.assertEqual(expo['independentStripRuns'], 2)
        self.assertEqual(len(snapshots), 5)
        self.assertEqual(result['unchangedNativeFontEntries'], 18)

    def test_changed_or_unpublished_compile_source_is_rejected(self):
        for fault in ['source-change', 'unpublished-source']:
            with self.subTest(fault=fault), self.assertRaisesRegex(release.ReleaseError, 'Expo compiled source differs'):
                self.exercise(fault)

    def test_missing_publisher_index_is_rejected(self):
        with self.assertRaisesRegex(release.ReleaseError, 'Expo publisher source index missing'):
            self.exercise('missing-index')

    def test_cxx_target_missing_or_ambiguous_model_is_rejected(self):
        for fault in ['target-change', 'missing-model', 'ambiguous-model']:
            with self.subTest(fault=fault), self.assertRaisesRegex(release.ReleaseError, 'one current matching Cxx model/target'):
                self.exercise(fault)

    def test_wrong_model_or_compiler_target_is_rejected(self):
        for fault in ['wrong-ndk', 'wrong-compile-target']:
            with self.subTest(fault=fault), self.assertRaises(release.ReleaseError):
                self.exercise(fault)

    def test_packaged_mismatch_and_second_independent_strip_mismatch_are_rejected(self):
        for fault in ['stripped-change', 'second-strip-change']:
            with self.subTest(fault=fault), self.assertRaises(release.ReleaseError):
                self.exercise(fault)

    def test_unchanged_prebuilt_pins_still_reject_other_library_change(self):
        with self.assertRaisesRegex(release.ReleaseError, 'Native dependency/font changed beyond project targets'):
            self.exercise('prebuilt-change')


class CanonicalReleaseIdentityTests(unittest.TestCase):
    def setUp(self):
        self.version_patch = patch.object(release, 'VERSION', '1.5.6')
        self.code_patch = patch.object(release, 'CODE', 17)
        self.version_patch.start()
        self.code_patch.start()
        self.addCleanup(self.version_patch.stop)
        self.addCleanup(self.code_patch.stop)

    def source_metadata(self, version='1.5.6', code=17):
        return {'package.json': json.dumps({'version': version}).encode(),
                'package-lock.json': json.dumps({'version': version, 'packages': {'': {'version': version}}}).encode(),
                'app.json': json.dumps({'expo': {'version': version}}).encode(),
                'android/app/build.gradle': f"output.versionCode.set({code})\noutput.versionName.set('{version}')\n".encode()}

    def test_explicit_version_and_code_match_all_frozen_source_metadata(self):
        release.metadata_check(self.source_metadata())

    def test_configured_version_cannot_override_actual_source_version(self):
        with self.assertRaisesRegex(release.ReleaseError, 'Source version does not match release'):
            release.metadata_check(self.source_metadata(version='1.5.5'))

    def test_configured_code_cannot_override_actual_standalone_code(self):
        with self.assertRaisesRegex(release.ReleaseError, 'Standalone release version/code mismatch'):
            release.metadata_check(self.source_metadata(code=16))

    def test_lock_root_or_duplicate_standalone_identity_is_rejected(self):
        for fault in ['lock-root', 'duplicate']:
            files = self.source_metadata()
            if fault == 'lock-root':
                files['package-lock.json'] = json.dumps({'version': '1.5.6', 'packages': {'': {'version': '1.5.5'}}}).encode()
            else:
                files['android/app/build.gradle'] *= 2
            with self.subTest(fault=fault), self.assertRaises(release.ReleaseError):
                release.metadata_check(files)

    def test_invalid_or_implicit_release_identity_is_rejected(self):
        for version, code in [(None, 17), ('1.5.6-rc1', 17), ('1.5.x', 17), ('1.5.6', 0),
                              ('1.5.6', True), ('1.5.6', None), ('1.5.6', 2100000001)]:
            with self.subTest(version=version, code=code), self.assertRaises(release.ReleaseError):
                release.configure_release(version, code)
        with patch.object(release, 'VERSION', None), self.assertRaises(release.ReleaseError):
            release.metadata_check(self.source_metadata())

    def test_identity_change_does_not_create_a_second_output_or_publisher_cache(self):
        before = [release.OUT, release.APK, release.SOURCE, release.COMPANION, release.INVENTORY, release.PUBLISHER_CACHE]
        release.configure_release('1.5.7', 18)
        self.assertEqual(before, [release.OUT, release.APK, release.SOURCE, release.COMPANION, release.INVENTORY, release.PUBLISHER_CACHE])
        self.assertEqual(release.OUT, release.ROOT / 'artifacts/release')
        self.assertEqual([release.APK.name, release.SOURCE.name, release.COMPANION.name],
                         ['wa-reco.apk', 'application-source.zip', 'source-and-notices.zip'])

    def test_current_caption_passes_but_old_version_and_overlong_caption_fail(self):
        with patch.object(release, 'read', return_value=b'wa-reco 1.5.6 reviewed experimental caption'):
            self.assertIn('1.5.6', release.reviewed_caption('apk'))
        for text in [b'wa-reco 1.5.5 old caption', b'wa-reco 1.5.6 ' + b'x' * 1024]:
            with patch.object(release, 'read', return_value=text), self.assertRaises(release.ReleaseError):
                release.reviewed_caption('apk')

    def test_source_guard_still_rejects_dirty_or_unfrozen_application_changes(self):
        for responses in [[b' M App.tsx'], [b'', b'', b'src/runtime.ts\n']]:
            with patch.object(release, 'git', side_effect=responses), self.assertRaises(release.ReleaseError):
                release.source_guard('a' * 40)
        with patch.object(release, 'git', side_effect=[b'', b'', b'.planning/STATE.md\n']):
            release.source_guard('a' * 40)

    def test_canonical_tools_are_exportable_without_private_material_or_secret_literals(self):
        spec = importlib.util.spec_from_file_location('public_export_rules_under_test', release.ROOT / 'tools/export-public-source.py')
        exporter = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(exporter)
        for name in ['tools/release-compliance/release.py', 'tools/release-compliance/test_release.py',
                     'tools/release-compliance/README.md', 'tools/build-android.ps1']:
            self.assertTrue(exporter.included(name))
            self.assertEqual(exporter.findings(name, (release.ROOT / name).read_bytes()), [])
        for name in ['.env', 'artifacts/release/application-source.zip', 'tools/release-compliance/signing.properties']:
            self.assertFalse(exporter.included(name))


class ApprovedPreservationTests(unittest.TestCase):
    """Real ZIP parsing and replacement state, with a byte-only virtual disk."""
    def setUp(self):
        self.old_commit, self.new_commit = 'a' * 40, 'b' * 40
        self.disk = {}
        self.old_files = {name: ('old ' + name).encode() for name in release.ACTIVE_NAMES
                          if name != release.REPLACEMENT.name}
        self.old_files['release-pins.json'] = b'{"schema":1,"version":"1.5.6"}'
        self.old_files['normal-snapshot/normal-build.log'] = b'old build proof'
        self.old_sha = release.digest(self.old_files['release-pins.json'])
        self.manifest = {'schema': 1, 'ownerAccepted': True, 'version': '1.5.6', 'versionCode': 17,
                         'sourceCommit': self.old_commit, 'releasePinsSha256': self.old_sha,
                         'files': {}}
        self.payload = self.archive()
        self.archive_sha = release.digest(self.payload)
        self.disk[release.APPROVED] = self.payload
        self.disk.update({release.OUT / name: data for name, data in self.old_files.items()})
        self.before = dict(self.disk)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(release, 'VERSION', '1.5.7'))
        self.stack.enter_context(patch.object(release, 'CODE', 18))
        self.stack.enter_context(patch.object(release, 'REPLACEMENT_SHA', self.archive_sha))
        self.stack.enter_context(patch.object(release, 'REPLACEMENT_COMMIT', self.new_commit))
        self.stack.enter_context(patch.object(release, 'CANDIDATE_SHA', None))
        self.stack.enter_context(patch.object(release, 'no_links', side_effect=lambda path: Path(path).absolute()))
        self.stack.enter_context(patch.object(release, 'read', side_effect=lambda path, *args: self.disk[Path(path)]))
        self.stack.enter_context(patch.object(release, 'active_files', side_effect=self.active))
        self.stack.enter_context(patch.object(Path, 'exists', lambda path: path in self.disk))
        self.stack.enter_context(patch.object(Path, 'mkdir'))
        self.stack.enter_context(patch.object(Path, 'open', lambda path, mode: self.open(path, mode)))
        self.stack.enter_context(patch.object(release.os, 'fsync'))
        self.replace = self.stack.enter_context(patch.object(release.os, 'replace', side_effect=self.move))
        self.rename = self.stack.enter_context(patch.object(release.os, 'rename', side_effect=self.move))

    def archive(self, entries=None, manifest=None):
        entries = {'release/' + name: data for name, data in self.old_files.items()} if entries is None else entries
        manifest = dict(self.manifest) if manifest is None else manifest
        manifest['files'] = {name: {'bytes': len(data), 'sha256': release.digest(data)} for name, data in entries.items()}
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for name, data in entries.items():
                archive.writestr(name, data)
            archive.writestr('APPROVED_MANIFEST.json', json.dumps(manifest).encode())
        return stream.getvalue()

    def active(self):
        return {path.relative_to(release.OUT).as_posix(): path for path in self.disk
                if path.is_relative_to(release.OUT) and path not in {release.APPROVED, release.CANDIDATE} and
                not path.is_relative_to(release.OUT / 'scratch')}

    def open(self, path, mode):
        self.assertEqual(mode, 'xb')
        if path in self.disk:
            raise FileExistsError('Synthetic interrupted stage')
        owner = self
        class Writer(io.BytesIO):
            def fileno(self):
                return 123
            def close(self):
                owner.disk[path] = self.getvalue()
                super().close()
        return Writer()

    def move(self, source, destination):
        self.disk[Path(destination)] = self.disk.pop(Path(source))

    def test_exact_approved_archive_preserves_every_rollback_byte(self):
        manifest, contents = release.approved_archive(self.archive_sha)
        self.assertEqual(manifest['sourceCommit'], self.old_commit)
        self.assertEqual({name[len('release/'):]: data for name, data in contents.items()}, self.old_files)
        self.assertEqual(self.disk, self.before)
        self.replace.assert_not_called()

    def test_guarded_source_replacement_leaves_old_rollback_source_intact(self):
        release.write(release.SOURCE, b'new final tested source')
        self.assertEqual(self.disk[release.SOURCE], b'new final tested source')
        self.assertEqual(self.disk[release.APPROVED], self.payload)
        _, archived = release.approved_archive(self.archive_sha)
        self.assertEqual(archived['release/' + release.SOURCE.name], self.old_files[release.SOURCE.name])
        state = release.load(release.REPLACEMENT)
        self.assertEqual(state['sourceCommit'], self.new_commit)
        self.assertEqual(state['files'][release.SOURCE.name],
                         {'bytes': 23, 'sha256': release.digest(b'new final tested source')})
        release.replacement_state()

    def test_new_source_output_cannot_be_rewritten_by_a_repeat(self):
        release.write(release.SOURCE, b'new final tested source')
        with self.assertRaisesRegex(release.ReleaseError, 'already exists'):
            release.write(release.SOURCE, b'changed repeat')
        self.assertEqual(self.disk[release.SOURCE], b'new final tested source')

    def test_archive_tampering_blocks_write_without_mutating_active_files(self):
        self.disk[release.APPROVED] += b'tamper'
        with self.assertRaisesRegex(release.ReleaseError, 'archive changed'):
            release.write(release.SOURCE, b'new')
        self.assertEqual(self.disk[release.SOURCE], self.before[release.SOURCE])
        self.replace.assert_not_called()

    def test_only_exact_current_approved_evidence_can_replace_its_previous_rollback_binding(self):
        normal = {'sourceCommit': self.old_commit, 'version': '1.5.6', 'versionCode': 17,
                  'approvedRollbackArchiveSha256': 'c' * 64}
        self.old_files[release.NORMAL.name] = json.dumps(normal).encode()
        self.disk[release.NORMAL] = self.old_files[release.NORMAL.name]
        self.disk[release.APPROVED] = self.archive()
        release.verify_rollback_binding(normal)
        self.disk[release.APK] = b'changed current APK'
        with self.assertRaisesRegex(release.ReleaseError, 'differs from current release'):
            release.verify_rollback_binding(normal)

    def test_an_unrelated_valid_archive_cannot_replace_normal_rollback_binding(self):
        normal = {'sourceCommit': self.new_commit, 'version': '1.5.7', 'versionCode': 18,
                  'approvedRollbackArchiveSha256': 'c' * 64}
        with self.assertRaisesRegex(release.ReleaseError, 'without exact retention'):
            release.verify_rollback_binding(normal)

    def test_archive_member_tampering_is_detected_even_with_current_container_pin(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(self.payload)) as original, zipfile.ZipFile(stream, 'w') as changed:
            for name in original.namelist():
                changed.writestr(name, b'wrong rollback' if name == 'release/wa-reco.apk' else original.read(name))
        self.disk[release.APPROVED] = stream.getvalue()
        with self.assertRaisesRegex(release.ReleaseError, 'member integrity'):
            release.approved_archive(release.digest(stream.getvalue()))

    def test_wrong_successor_version_or_code_cannot_authorize_replacement(self):
        for version, code in [('1.5.6', 18), ('1.5.7', 17), ('1.5.5', 16)]:
            with self.subTest(version=version, code=code), patch.object(release, 'VERSION', version), \
                 patch.object(release, 'CODE', code), self.assertRaises(release.ReleaseError):
                release.write(release.SOURCE, b'new')
        self.replace.assert_not_called()

    def test_unknown_or_missing_active_output_blocks_all_replacement(self):
        self.disk[release.OUT / 'unknown-private.bin'] = b'unknown'
        with self.assertRaisesRegex(release.ReleaseError, 'missing or unknown'):
            release.write(release.SOURCE, b'new')
        del self.disk[release.OUT / 'unknown-private.bin']
        del self.disk[release.APK]
        with self.assertRaisesRegex(release.ReleaseError, 'missing or unknown'):
            release.write(release.SOURCE, b'new')
        self.replace.assert_not_called()

    def test_changed_old_output_cannot_be_excused_by_owner_acceptance(self):
        self.disk[release.APK] = b'changed old APK'
        with self.assertRaisesRegex(release.ReleaseError, 'Frozen artifact bytes changed'):
            release.write(release.SOURCE, b'new')
        self.replace.assert_not_called()

    def test_new_source_bytes_or_journal_identity_tampering_blocks_later_output(self):
        release.write(release.SOURCE, b'new final tested source')
        baseline = dict(self.disk)
        self.disk[release.SOURCE] = b'tampered source'
        with self.assertRaises(release.ReleaseError):
            release.write(release.FROZEN, b'new pins')
        self.disk = baseline
        state = release.load(release.REPLACEMENT)
        state['sourceCommit'] = 'c' * 40
        self.disk[release.REPLACEMENT] = json.dumps(state).encode()
        with self.assertRaisesRegex(release.ReleaseError, 'different source or archive'):
            release.write(release.FROZEN, b'new pins')

    def test_missing_owner_attestation_or_wrong_old_pin_refuses_retention_early(self):
        for accepted, pin in [(False, self.old_sha), (True, 'c' * 64)]:
            args = SimpleNamespace(owner_accepted=accepted, approved_release_pins_sha=pin)
            with self.subTest(accepted=accepted), patch.object(release, 'REPLACEMENT_SHA', None), \
                 self.assertRaises(release.ReleaseError):
                release.retain_approved(args)
        self.replace.assert_not_called()

    def retained_fixture(self, wrong_receipt=False):
        del self.disk[release.APPROVED]
        snapshots = [{'path': 'resolved-runtime-private.json'}] + [{'path': f'proof-{n}.json'} for n in range(28)]
        del self.disk[release.OUT / 'normal-snapshot/normal-build.log']
        for row in snapshots:
            self.disk[release.SNAPSHOT / row['path']] = ('prior ' + row['path']).encode()
        self.disk[release.SNAPSHOT / 'resolved-runtime-private.json'] = self.disk[release.OUT / 'resolved-runtime-private.json']
        self.disk[release.NORMAL] = json.dumps({'snapshots': snapshots,
                                              'reviewedBuildExportChanges': [],
                                              'inputReviewSha256': release.digest(self.disk[release.OUT / 'input-review.json'])}).encode()
        self.disk[release.OUT / 'input-review-draft.json'] = json.dumps({'schema': 1, 'sourceCommit': self.old_commit,
            'changedInputs': [], 'reviewed': False, 'dependencyAndLicenseImpactReviewed': False,
            'originalCodeNoNewThirdPartyDependency': False}).encode()
        assets = {path.name: {'bytes': len(self.disk[path]), 'sha256': release.digest(self.disk[path])}
                  for path in (release.APK, release.SOURCE, release.COMPANION)}
        captions = {kind: {'sha256': release.digest(self.disk[release.OUT / f'telegram-{kind}-caption.txt'])}
                    for kind in ['companion', 'apk']}
        delivery = {'assets': assets, 'captions': captions, 'companionHashesVerified': 474}
        self.disk[release.OUT / 'recombination-check.json'] = json.dumps({
            'appSourceCommit': self.old_commit, 'appSourceSha256': assets[release.SOURCE.name]['sha256'],
            'releaseApkSha256': assets[release.APK.name]['sha256'],
            'modifiedApkSha256': release.digest(self.disk[release.OUT / 'wa-reco-modified-recombination.apk']),
        }).encode()
        for kind, asset in [('companion', release.COMPANION), ('apk', release.APK)]:
            attempt = {'state': 'sending', 'sourceCommit': self.old_commit, 'file': asset.name,
                       **assets[asset.name], 'captionSha256': captions[kind]['sha256'], 'chat_id': 111,
                       'started_at_utc': 'synthetic'}
            receipt = {**attempt, 'state': 'delivered', 'destination_verified': True,
                       'document_size_verified': True, 'provider_ok': True, 'message_id': 123}
            if wrong_receipt and kind == 'apk':
                receipt['sha256'] = 'd' * 64
            prefix = release.ARTIFACTS / 'telegram' / f'wa-reco-1.5.6-{kind}'
            self.disk[Path(str(prefix) + '-attempt.json')] = json.dumps(attempt).encode()
            self.disk[Path(str(prefix) + '-receipt.json')] = json.dumps(receipt).encode()
        return delivery

    def retain(self, wrong_receipt=False, tamper=None):
        delivery = self.retained_fixture(wrong_receipt)
        if tamper == 'inventory':
            self.disk[release.OUT / 'resolved-runtime-private.json'] = b'tampered direct inventory'
        elif tamper == 'draft':
            draft = release.load(release.OUT / 'input-review-draft.json')
            draft['unknownPrivateField'] = 'synthetic injected field'
            self.disk[release.OUT / 'input-review-draft.json'] = json.dumps(draft).encode()
        baseline = dict(self.disk)
        args = SimpleNamespace(source_commit=self.old_commit, owner_accepted=True,
                               approved_release_pins_sha=self.old_sha, previous_approved_sha=None)
        module = SimpleNamespace(check_bundle=lambda path: {'operatorEvidenceComplete': True,
                                                           'outstandingGates': [], 'hashesVerified': 474})
        with patch.object(release, 'VERSION', '1.5.6'), patch.object(release, 'CODE', 17), \
             patch.object(release, 'REPLACEMENT_SHA', None), \
             patch.object(release, 'delivery_guard', return_value=delivery) as verified, \
             patch.object(release, 'bundle_module', return_value=module), \
             patch.object(release, 'inspect_apk') as signer, \
             patch.object(release, 'config', side_effect=AssertionError('Preservation must be credential-free')), \
             patch.object(release, 'api_json', side_effect=AssertionError('No provider operation')):
            result = release.retain_approved(args)
            verified.assert_called_once_with(self.old_commit, check_checkout=False)
            signer.assert_called_once_with(release.OUT / 'wa-reco-modified-recombination.apk', release.MOD_CERT)
        return result, baseline

    def test_actual_retention_archives_all29_proofs_and_verified_receipts_without_changing_active_files(self):
        result, baseline = self.retain()
        self.assertTrue(result['retained'])
        self.assertFalse(result['activeFilesChanged'])
        self.assertEqual(result['filesPreserved'], 47)
        for path, data in baseline.items():
            self.assertEqual(self.disk[path], data)
        manifest, archived = release.approved_archive(result['approvedArchive']['sha256'])
        self.assertEqual(manifest['versionCode'], 17)
        self.assertEqual(archived['release/wa-reco.apk'], baseline[release.APK])
        self.assertEqual(len([name for name in archived if name.startswith('release/normal-snapshot/')]), 29)
        self.assertEqual(len([name for name in archived if name.startswith('telegram/')]), 4)

    def test_wrong_delivery_hash_refuses_retention_before_archive_creation(self):
        with self.assertRaisesRegex(release.ReleaseError, 'delivery receipt'):
            self.retain(wrong_receipt=True)
        self.assertNotIn(release.APPROVED, self.disk)
        self.rename.assert_not_called()
        self.replace.assert_not_called()

    def retain_successor(self, fault=None, previous_sha=None):
        """Owner-accepted1.5.7 follows a genuinely pinned1.5.6 archive."""
        delivery = self.retained_fixture()
        self.disk[release.APPROVED] = self.payload
        self.disk[release.FROZEN] = json.dumps({'schema': 1, 'sourceCommit': self.new_commit,
            'version': '1.5.7', 'versionCode': 18, 'assets': delivery['assets']}).encode()
        draft = release.load(release.OUT / 'input-review-draft.json')
        draft['sourceCommit'] = self.new_commit
        self.disk[release.OUT / 'input-review-draft.json'] = json.dumps(draft).encode()
        recombination = release.load(release.OUT / 'recombination-check.json')
        recombination['appSourceCommit'] = self.new_commit
        self.disk[release.OUT / 'recombination-check.json'] = json.dumps(recombination).encode()
        for kind in ['companion', 'apk']:
            for suffix in ['attempt', 'receipt']:
                old = release.ARTIFACTS / 'telegram' / f'wa-reco-1.5.6-{kind}-{suffix}.json'
                new = release.ARTIFACTS / 'telegram' / f'wa-reco-1.5.7-{kind}-{suffix}.json'
                value = release.load(old)
                value['sourceCommit'] = self.new_commit
                self.disk[new] = json.dumps(value).encode()
        current = self.active()
        state = {'schema': 1, 'approvedArchiveSha256': self.archive_sha, 'sourceCommit': self.new_commit,
                 'version': '1.5.7', 'versionCode': 18,
                 'files': {name: release.pin(path) for name, path in current.items()}}
        self.disk[release.REPLACEMENT] = json.dumps(state).encode()
        stage = release.OUT / 'scratch/release-stage-approved.zip'
        if fault == 'interrupted-stage':
            self.disk[stage] = b'interrupted prior archive stage'
        elif fault == 'receipt':
            path = release.ARTIFACTS / 'telegram/wa-reco-1.5.7-apk-receipt.json'
            value = release.load(path); value['sourceCommit'] = 'd' * 40
            self.disk[path] = json.dumps(value).encode()
        elif fault == 'journal':
            value = release.load(release.REPLACEMENT); value['approvedArchiveSha256'] = 'd' * 64
            self.disk[release.REPLACEMENT] = json.dumps(value).encode()
        baseline = dict(self.disk)
        args = SimpleNamespace(source_commit=self.new_commit, owner_accepted=True,
            approved_release_pins_sha=release.digest(self.disk[release.FROZEN]),
            previous_approved_sha=self.archive_sha if previous_sha is None else previous_sha)
        module = SimpleNamespace(check_bundle=lambda path: {'operatorEvidenceComplete': True,
            'outstandingGates': [], 'hashesVerified': 474})
        real_guard = release.approved_archive
        events = []
        def guard(expected, path=None):
            events.append(('verify', expected, path))
            if path == stage and fault == 'stage-before-validation':
                self.disk[stage] += b'tampered new stage'
            result = real_guard(expected) if path is None else real_guard(expected, path)
            if path == stage and fault == 'source-after-stage':
                self.disk[release.SOURCE] += b'changed while retaining'
            if path is None and expected == self.archive_sha and stage in self.disk and fault == 'stage-after-validation':
                self.disk[stage] += b'changed after stage verification'
            return result
        def promote(source, destination):
            events.append(('promote', source, destination))
            self.move(source, destination)
        with patch.object(release, 'VERSION', '1.5.7'), patch.object(release, 'CODE', 18), \
             patch.object(release, 'REPLACEMENT_SHA', None), \
             patch.object(release, 'delivery_guard', return_value=delivery) as verified, \
             patch.object(release, 'bundle_module', return_value=module), patch.object(release, 'inspect_apk'), \
             patch.object(release, 'approved_archive', side_effect=guard), \
             patch.object(release.os, 'replace', self.replace), \
             patch.object(release, 'config', side_effect=AssertionError('No credentials')), \
             patch.object(release, 'api_json', side_effect=AssertionError('No provider operation')):
            self.replace.side_effect = promote
            result = release.retain_approved(args)
            verified.assert_called_once_with(self.new_commit, check_checkout=False)
        return result, baseline, events

    def test_known_previous_archive_is_replaced_only_after_successor_stage_verification(self):
        result, baseline, events = self.retain_successor()
        self.assertEqual(result['version'], '1.5.7')
        self.assertEqual(result['filesPreserved'], 48)
        self.assertFalse(result['activeFilesChanged'])
        stage = release.OUT / 'scratch/release-stage-approved.zip'
        promoted = next(i for i, event in enumerate(events) if event[0] == 'promote')
        self.assertTrue(any(event[0] == 'verify' and event[2] == stage for event in events[:promoted]))
        self.assertEqual(len([event for event in events[:promoted] if event[:2] == ('verify', self.archive_sha)]), 2)
        for path, data in baseline.items():
            if path != release.APPROVED:
                self.assertEqual(self.disk[path], data)
        manifest, contents = release.approved_archive(result['approvedArchive']['sha256'])
        self.assertEqual(manifest['sourceCommit'], self.new_commit)
        self.assertEqual(manifest['versionCode'], 18)
        self.assertEqual(contents['release/wa-reco.apk'], baseline[release.APK])
        self.assertEqual(contents['release/replacement-state.json'], baseline[release.REPLACEMENT])
        self.assertEqual(len([name for name in contents if name.startswith('telegram/wa-reco-1.5.7-')]), 4)
        self.assertFalse(any('wa-reco-1.5.6-' in name for name in contents))
        self.replace.assert_called_once_with(stage, release.APPROVED)
        self.rename.assert_not_called()

    def test_wrong_previous_archive_pin_cannot_replace_known_rollback(self):
        with self.assertRaisesRegex(release.ReleaseError, 'archive changed'):
            self.retain_successor(previous_sha='c' * 64)
        self.assertEqual(self.disk[release.APPROVED], self.payload)
        self.replace.assert_not_called()

    def test_unresolved_existing_archive_stage_preserves_previous_rollback(self):
        with self.assertRaises(FileExistsError):
            self.retain_successor(fault='interrupted-stage')
        self.assertEqual(self.disk[release.APPROVED], self.payload)
        self.replace.assert_not_called()

    def test_tampered_new_archive_stage_never_replaces_previous_rollback(self):
        for fault in ['stage-before-validation', 'stage-after-validation']:
            with self.subTest(fault=fault), self.assertRaises(release.ReleaseError):
                self.retain_successor(fault=fault)
            self.assertEqual(self.disk[release.APPROVED], self.payload)
            self.replace.assert_not_called()
            self.disk = dict(self.before)

    def test_changed_current_source_after_stage_validation_blocks_archive_replacement(self):
        with self.assertRaisesRegex(release.ReleaseError, 'Frozen artifact bytes changed'):
            self.retain_successor(fault='source-after-stage')
        self.assertEqual(self.disk[release.APPROVED], self.payload)
        self.replace.assert_not_called()

    def test_successor_receipt_or_previous_archive_journal_mismatch_blocks_replacement(self):
        for fault in ['receipt', 'journal']:
            with self.subTest(fault=fault), self.assertRaises(release.ReleaseError):
                self.retain_successor(fault=fault)
            self.assertEqual(self.disk[release.APPROVED], self.payload)
            self.replace.assert_not_called()
            self.disk = dict(self.before)

    def test_changed_allowlisted_inventory_or_extra_draft_field_cannot_enter_rollback_archive(self):
        for tamper in ['inventory', 'draft']:
            with self.subTest(tamper=tamper), self.assertRaises(release.ReleaseError):
                self.retain(tamper=tamper)
            self.assertNotIn(release.APPROVED, self.disk)
            self.rename.assert_not_called()
            self.replace.assert_not_called()
            # Restore the synthetic fixture for the next case only.
            self.disk = dict(self.before)

    def candidate_fixture(self, fault=None):
        """Delivered1.5.8/code19 is not accepted;1.5.7/code18 stays approved."""
        delivery = self.retained_fixture()
        approved_files = dict(self.old_files)
        approved_files['release-pins.json'] = json.dumps({'schema': 1, 'sourceCommit': self.old_commit,
            'version': '1.5.7', 'versionCode': 18}).encode()
        approved_manifest = {**self.manifest, 'version': '1.5.7', 'versionCode': 18,
            'releasePinsSha256': release.digest(approved_files['release-pins.json'])}
        accepted = self.archive({'release/' + k: v for k, v in approved_files.items()}, approved_manifest)
        accepted_sha = release.digest(accepted)
        self.disk[release.APPROVED] = accepted
        draft = release.load(release.OUT / 'input-review-draft.json')
        draft['sourceCommit'] = self.new_commit
        self.disk[release.OUT / 'input-review-draft.json'] = json.dumps(draft).encode()
        recombination = release.load(release.OUT / 'recombination-check.json')
        recombination['appSourceCommit'] = self.new_commit
        self.disk[release.OUT / 'recombination-check.json'] = json.dumps(recombination).encode()
        normal = release.load(release.NORMAL)
        normal.update(sourceCommit=self.new_commit, version='1.5.8', versionCode=19,
                      approvedRollbackArchiveSha256=accepted_sha)
        self.disk[release.NORMAL] = json.dumps(normal).encode()
        frozen = {'schema': 1, 'sourceCommit': self.new_commit, 'version': '1.5.8', 'versionCode': 19,
                  'normalVerificationSha256': release.digest(self.disk[release.NORMAL]),
                  'assets': {name: value for name, value in delivery['assets'].items() if name != release.COMPANION.name}}
        self.disk[release.FROZEN] = json.dumps(frozen).encode()
        delivery.update(schema=1, sourceCommit=self.new_commit, version='1.5.8', versionCode=19,
                        releasePinsSha256=release.digest(self.disk[release.FROZEN]))
        self.disk[release.OUT / 'delivery-pins.json'] = json.dumps(delivery).encode()
        for kind in ['companion', 'apk']:
            for suffix in ['attempt', 'receipt']:
                old = release.ARTIFACTS / 'telegram' / f'wa-reco-1.5.6-{kind}-{suffix}.json'
                new = release.ARTIFACTS / 'telegram' / f'wa-reco-1.5.8-{kind}-{suffix}.json'
                value = release.load(old); value['sourceCommit'] = self.new_commit
                self.disk[new] = json.dumps(value).encode()
        state = {'schema': 1, 'approvedArchiveSha256': accepted_sha, 'sourceCommit': self.new_commit,
                 'version': '1.5.8', 'versionCode': 19,
                 'files': {name: release.pin(path) for name, path in self.active().items()}}
        self.disk[release.REPLACEMENT] = json.dumps(state).encode()
        args = SimpleNamespace(source_commit=self.new_commit, owner_accepted=False,
            current_release_pins_sha=release.digest(self.disk[release.FROZEN]),
            current_delivery_pins_sha=release.digest(self.disk[release.OUT / 'delivery-pins.json']),
            approved_archive_sha=accepted_sha, previous_candidate_sha=None)
        if fault == 'release-pin': args.current_release_pins_sha = 'd' * 64
        elif fault == 'delivery-pin': args.current_delivery_pins_sha = 'd' * 64
        elif fault == 'approved-pin': args.approved_archive_sha = 'd' * 64
        elif fault == 'acceptance': args.owner_accepted = True
        elif fault == 'journal':
            state['files'][release.SOURCE.name]['sha256'] = 'd' * 64
            self.disk[release.REPLACEMENT] = json.dumps(state).encode()
        elif fault == 'receipt':
            path = release.ARTIFACTS / 'telegram/wa-reco-1.5.8-apk-receipt.json'
            value = release.load(path); value['sourceCommit'] = 'd' * 40
            self.disk[path] = json.dumps(value).encode()
        elif fault == 'unknown-output': self.disk[release.OUT / 'unknown-private.bin'] = b'unknown'
        elif fault == 'missing-output': del self.disk[release.OUT / 'input-review.json']
        elif fault == 'interrupted-stage':
            self.disk[release.OUT / 'scratch/release-stage-candidate.zip'] = b'interrupted stage'
        elif fault == 'existing-candidate': self.disk[release.CANDIDATE] = b'unknown candidate'
        baseline = dict(self.disk)
        module = SimpleNamespace(check_bundle=lambda path: {'operatorEvidenceComplete': True,
            'outstandingGates': [], 'hashesVerified': 474})
        real_candidate = release.candidate_archive
        events = []
        stage = release.OUT / 'scratch/release-stage-candidate.zip'
        def guard(expected, path=None):
            events.append(('verify', expected, path))
            if path == stage and fault == 'stage-before-validation': self.disk[stage] += b'tamper'
            result = real_candidate(expected, path)
            if path == stage and fault == 'stage-after-validation': self.disk[stage] += b'tamper'
            if path == stage and fault == 'source-after-validation': self.disk[release.SOURCE] += b'tamper'
            if path == stage and fault == 'approved-after-validation': self.disk[release.APPROVED] += b'tamper'
            if path == stage and fault == 'unknown-after-validation': self.disk[release.OUT / 'unknown-private.bin'] = b'new'
            if path == stage and fault == 'receipt-after-validation':
                self.disk[release.ARTIFACTS / 'telegram/wa-reco-1.5.8-apk-receipt.json'] += b'tamper'
            return result
        def promote(source, target):
            events.append(('promote', source, target)); self.move(source, target)
        with patch.object(release, 'VERSION', '1.5.8'), patch.object(release, 'CODE', 19), \
             patch.object(release, 'REPLACEMENT_SHA', None), \
             patch.object(release, 'delivery_guard', return_value=delivery) as verified, \
             patch.object(release, 'bundle_module', return_value=module), patch.object(release, 'inspect_apk'), \
             patch.object(release, 'candidate_archive', side_effect=guard), \
             patch.object(release, 'config', side_effect=AssertionError('No credentials')), \
             patch.object(release, 'api_json', side_effect=AssertionError('No provider operation')):
            self.rename.side_effect = promote
            result = release.retain_candidate(args)
            verified.assert_called_once_with(self.new_commit, check_checkout=False)
        return result, baseline, events

    def test_delivered_candidate_preserves_exact_bytes_and_never_attests_acceptance(self):
        result, baseline, events = self.candidate_fixture()
        self.assertFalse(result['ownerAccepted']); self.assertEqual(result['physicalAcceptance'], 'pending')
        self.assertEqual(result['filesPreserved'], 48)
        for path, data in baseline.items(): self.assertEqual(self.disk[path], data)
        candidate, contents = release.candidate_archive(result['candidateArchive']['sha256'])
        self.assertFalse(candidate['ownerAccepted'])
        self.assertEqual(candidate['versionCode'], 19)
        self.assertEqual(contents['release/replacement-state.json'], baseline[release.REPLACEMENT])
        self.assertEqual(len([name for name in contents if name.startswith('telegram/')]), 4)
        promoted = next(i for i, event in enumerate(events) if event[0] == 'promote')
        self.assertTrue(any(event[2] == release.OUT / 'scratch/release-stage-candidate.zip'
                            for event in events[:promoted]))
        self.rename.assert_called_once(); self.replace.assert_not_called()
        # False acceptance cannot be parsed through the approved-archive API.
        self.disk[release.APPROVED] = self.disk[release.CANDIDATE]
        with self.assertRaises(release.ReleaseError):
            release.approved_archive(result['candidateArchive']['sha256'])

    def test_candidate_wrong_pins_acceptance_receipt_journal_unknown_and_missing_fail_before_promotion(self):
        for fault in ['release-pin', 'delivery-pin', 'approved-pin', 'acceptance', 'receipt', 'journal',
                      'unknown-output', 'missing-output', 'existing-candidate']:
            with self.subTest(fault=fault), self.assertRaises((release.ReleaseError, KeyError)):
                self.candidate_fixture(fault)
            self.rename.assert_not_called(); self.replace.assert_not_called()
            self.disk = dict(self.before)

    def test_candidate_interrupted_or_changed_stage_proof_or_approved_archive_blocks_promotion(self):
        for fault in ['interrupted-stage', 'stage-before-validation', 'stage-after-validation',
                      'source-after-validation', 'approved-after-validation', 'unknown-after-validation',
                      'receipt-after-validation']:
            with self.subTest(fault=fault), self.assertRaises((release.ReleaseError, FileExistsError)):
                self.candidate_fixture(fault)
            self.assertNotIn(release.CANDIDATE, self.disk)
            self.rename.assert_not_called(); self.replace.assert_not_called()
            self.disk = dict(self.before)

    def candidate_successor(self, result, version='1.5.9', code=20, commit=None):
        stack = ExitStack()
        stack.enter_context(patch.object(release, 'VERSION', version))
        stack.enter_context(patch.object(release, 'CODE', code))
        stack.enter_context(patch.object(release, 'REPLACEMENT_SHA', result['approvedArchiveSha256']))
        stack.enter_context(patch.object(release, 'CANDIDATE_SHA', result['candidateArchive']['sha256']))
        stack.enter_context(patch.object(release, 'REPLACEMENT_COMMIT', commit or 'c' * 40))
        return stack

    def test_candidate_successor_replaces_source_once_with_both_archives_unchanged(self):
        result, baseline, _ = self.candidate_fixture()
        preserved = self.disk[release.CANDIDATE]
        with self.candidate_successor(result):
            release.write(release.SOURCE, b'next final tested source')
            journal = release.load(release.REPLACEMENT)
            self.assertEqual(journal['versionCode'], 20)
            self.assertEqual(journal['candidateArchiveSha256'], result['candidateArchive']['sha256'])
            self.assertEqual(journal['approvedArchiveSha256'], result['approvedArchiveSha256'])
            with self.assertRaisesRegex(release.ReleaseError, 'already exists'):
                release.write(release.SOURCE, b'repeated next source')
            release.replacement_state()
        self.assertEqual(self.disk[release.APPROVED], baseline[release.APPROVED])
        self.assertEqual(self.disk[release.CANDIDATE], preserved)

    def test_candidate_successor_requires_both_pins_and_strictly_later_version_code_source(self):
        result, baseline, _ = self.candidate_fixture()
        for version, code, commit in [('1.5.8', 20, 'c' * 40), ('1.5.9', 19, 'c' * 40),
                                      ('1.5.9', 20, self.new_commit)]:
            with self.subTest(version=version, code=code, commit=commit), \
                 self.candidate_successor(result, version, code, commit), self.assertRaises(release.ReleaseError):
                release.write(release.SOURCE, b'wrong successor')
        with self.candidate_successor(result), patch.object(release, 'CANDIDATE_SHA', 'd' * 64), \
             self.assertRaises(release.ReleaseError):
            release.write(release.SOURCE, b'wrong candidate pin')
        with self.candidate_successor(result), patch.object(release, 'CANDIDATE_SHA', None), \
             self.assertRaises(release.ReleaseError):
            release.write(release.SOURCE, b'missing candidate pin')
        self.assertEqual(self.disk[release.SOURCE], baseline[release.SOURCE])
        self.replace.assert_not_called()

    def test_candidate_or_approved_tamper_and_interrupted_journal_block_before_successor_mutation(self):
        result, baseline, _ = self.candidate_fixture()
        saved = dict(self.disk)
        for path in [release.CANDIDATE, release.APPROVED, release.APK]:
            self.disk[path] += b'tamper'
            with self.subTest(path=path.name), self.candidate_successor(result), self.assertRaises(release.ReleaseError):
                release.write(release.SOURCE, b'new')
            self.assertEqual(self.disk[release.SOURCE], baseline[release.SOURCE])
            self.replace.assert_not_called(); self.disk = dict(saved)
        self.disk[release.OUT / 'scratch/release-stage-journal.json'] = b'interrupted'
        with self.candidate_successor(result), self.assertRaises(FileExistsError):
            release.write(release.SOURCE, b'new')
        self.assertEqual(self.disk[release.SOURCE], baseline[release.SOURCE])
        self.replace.assert_not_called()

    def test_normal_successor_preservation_binding_requires_exact_candidate_archive(self):
        result, _, _ = self.candidate_fixture()
        normal = {'sourceCommit': 'c' * 40, 'version': '1.5.9', 'versionCode': 20,
                  'approvedRollbackArchiveSha256': result['approvedArchiveSha256'],
                  'preservedCandidateArchiveSha256': result['candidateArchive']['sha256']}
        release.verify_rollback_binding(normal)
        self.disk[release.CANDIDATE] += b'tamper'
        with self.assertRaises(release.ReleaseError): release.verify_rollback_binding(normal)

    def test_candidate_is_rechecked_after_output_staging_before_any_canonical_mutation(self):
        result, baseline, _ = self.candidate_fixture()
        original = release.replacement_allowed
        calls = 0
        def changed_candidate(paths):
            nonlocal calls
            calls += 1
            if calls == 3: self.disk[release.CANDIDATE] += b'changed during staging'
            return original(paths)
        with self.candidate_successor(result), patch.object(release, 'replacement_allowed', side_effect=changed_candidate), \
             self.assertRaisesRegex(release.ReleaseError, 'archive changed'):
            release.write(release.SOURCE, b'new')
        self.assertEqual(self.disk[release.SOURCE], baseline[release.SOURCE])
        self.assertEqual(self.disk[release.APPROVED], baseline[release.APPROVED])
        self.replace.assert_not_called()

    def rotate_candidate(self):
        result, baseline, _ = self.candidate_fixture()
        prior = result['candidateArchive']['sha256']
        normal = release.load(release.NORMAL)
        normal.update(sourceCommit='c' * 40, version='1.5.9', versionCode=20,
                      preservedCandidateArchiveSha256=prior)
        self.disk[release.NORMAL] = json.dumps(normal).encode()
        draft = release.load(release.OUT / 'input-review-draft.json'); draft['sourceCommit'] = 'c' * 40
        self.disk[release.OUT / 'input-review-draft.json'] = json.dumps(draft).encode()
        recombination = release.load(release.OUT / 'recombination-check.json'); recombination['appSourceCommit'] = 'c' * 40
        self.disk[release.OUT / 'recombination-check.json'] = json.dumps(recombination).encode()
        frozen = release.load(release.FROZEN)
        frozen.update(sourceCommit='c' * 40, version='1.5.9', versionCode=20,
                      normalVerificationSha256=release.digest(self.disk[release.NORMAL]))
        self.disk[release.FROZEN] = json.dumps(frozen).encode()
        delivery = release.load(release.OUT / 'delivery-pins.json')
        delivery.update(sourceCommit='c' * 40, version='1.5.9', versionCode=20,
                        releasePinsSha256=release.digest(self.disk[release.FROZEN]))
        self.disk[release.OUT / 'delivery-pins.json'] = json.dumps(delivery).encode()
        for kind in ['companion', 'apk']:
            for suffix in ['attempt', 'receipt']:
                old = release.ARTIFACTS / 'telegram' / f'wa-reco-1.5.8-{kind}-{suffix}.json'
                new = release.ARTIFACTS / 'telegram' / f'wa-reco-1.5.9-{kind}-{suffix}.json'
                value = release.load(old); value['sourceCommit'] = 'c' * 40
                self.disk[new] = json.dumps(value).encode()
        state = {'schema': 1, 'approvedArchiveSha256': result['approvedArchiveSha256'], 'candidateArchiveSha256': prior,
                 'sourceCommit': 'c' * 40, 'version': '1.5.9', 'versionCode': 20,
                 'files': {name: release.pin(path) for name, path in self.active().items() if name != release.REPLACEMENT.name}}
        self.disk[release.REPLACEMENT] = json.dumps(state).encode()
        args = SimpleNamespace(source_commit='c' * 40, owner_accepted=False,
            current_release_pins_sha=release.digest(self.disk[release.FROZEN]),
            current_delivery_pins_sha=release.digest(self.disk[release.OUT / 'delivery-pins.json']),
            approved_archive_sha=result['approvedArchiveSha256'], previous_candidate_sha='d' * 64)
        module = SimpleNamespace(check_bundle=lambda path: {'operatorEvidenceComplete': True,
            'outstandingGates': [], 'hashesVerified': 474})
        saved = dict(self.disk)
        with patch.object(release, 'VERSION', '1.5.9'), patch.object(release, 'CODE', 20), \
             patch.object(release, 'REPLACEMENT_SHA', None), \
             patch.object(release, 'delivery_guard', return_value=delivery), \
             patch.object(release, 'bundle_module', return_value=module), patch.object(release, 'inspect_apk'):
            with self.assertRaisesRegex(release.ReleaseError, 'archive changed'):
                release.retain_candidate(args)
            self.assertEqual(self.disk, saved)
            args.previous_candidate_sha = prior
            rotated = release.retain_candidate(args)
        self.assertFalse(rotated['ownerAccepted'])
        self.assertEqual(rotated['version'], '1.5.9')
        self.assertEqual(self.disk[release.APPROVED], baseline[release.APPROVED])
        for path, data in saved.items():
            if path != release.CANDIDATE: self.assertEqual(self.disk[path], data)
        candidate, _ = release.candidate_archive(rotated['candidateArchive']['sha256'])
        self.assertEqual(candidate['versionCode'], 20)
        return rotated, dict(self.disk)

    def test_known_candidate_rotation_preserves_approved_archive_and_validates_previous_candidate_pin(self):
        self.rotate_candidate()

    def test_exact_unaccepted_self_retention_preserves_strict_normal_verification_after_rotation(self):
        rotated, baseline = self.rotate_candidate()
        normal = release.load(release.NORMAL)
        self.assertNotEqual(normal['preservedCandidateArchiveSha256'], rotated['candidateArchive']['sha256'])
        release.verify_rollback_binding(normal)
        manifest, _ = release.candidate_archive(rotated['candidateArchive']['sha256'])
        self.assertFalse(manifest['ownerAccepted'])
        self.assertEqual(self.disk, baseline)

    def test_self_retention_rejects_changed_current_outputs_snapshots_or_immutable_receipts(self):
        _, baseline = self.rotate_candidate()
        normal = release.load(release.NORMAL)
        for path in [release.SOURCE, release.FROZEN, release.NORMAL, release.SNAPSHOT / 'proof-0.json',
                     release.ARTIFACTS / 'telegram/wa-reco-1.5.9-apk-receipt.json',
                     release.ARTIFACTS / 'telegram/wa-reco-1.5.9-companion-attempt.json']:
            self.disk[path] += b'tamper'
            with self.subTest(path=path.name), self.assertRaises(release.ReleaseError):
                release.verify_rollback_binding(normal)
            self.disk = dict(baseline)
        self.disk[release.OUT / 'unknown-private.bin'] = b'unknown'
        with self.assertRaisesRegex(release.ReleaseError, 'differs from current release'):
            release.verify_rollback_binding(normal)

    def test_self_retention_requires_exact_current_identity_and_approved_archive(self):
        _, baseline = self.rotate_candidate()
        normal = release.load(release.NORMAL)
        for field, wrong in [('sourceCommit', 'e' * 40), ('version', '1.5.10'), ('versionCode', 21),
                             ('approvedRollbackArchiveSha256', 'e' * 64)]:
            changed = {**normal, field: wrong}
            with self.subTest(field=field), self.assertRaises(release.ReleaseError):
                release.verify_rollback_binding(changed)
        self.disk[release.APPROVED] += b'tamper'
        with self.assertRaises(release.ReleaseError): release.verify_rollback_binding(normal)
        self.assertEqual(self.disk[release.CANDIDATE], baseline[release.CANDIDATE])

    def test_self_retention_rejects_changed_archive_member_or_false_acceptance_flag(self):
        _, baseline = self.rotate_candidate()
        normal = release.load(release.NORMAL)
        for fault in ['member', 'acceptance']:
            payload = io.BytesIO()
            with zipfile.ZipFile(io.BytesIO(baseline[release.CANDIDATE])) as source, zipfile.ZipFile(payload, 'w') as target:
                for name in source.namelist():
                    data = source.read(name)
                    if fault == 'member' and name == 'release/application-source.zip': data += b'tamper'
                    if fault == 'acceptance' and name == 'CANDIDATE_MANIFEST.json':
                        manifest = json.loads(data); manifest['ownerAccepted'] = True
                        data = json.dumps(manifest).encode()
                    target.writestr(name, data)
            self.disk[release.CANDIDATE] = payload.getvalue()
            with self.subTest(fault=fault), self.assertRaises(release.ReleaseError):
                release.verify_rollback_binding(normal)
            self.disk = dict(baseline)

    def test_existing_interrupted_journal_stage_blocks_before_canonical_output_mutation(self):
        stage = release.OUT / 'scratch/release-stage-journal.json'
        self.disk[stage] = b'prior interrupted journal'
        with self.assertRaises(FileExistsError):
            release.write(release.SOURCE, b'new final source')
        self.assertEqual(self.disk[release.SOURCE], self.before[release.SOURCE])
        self.assertEqual(self.disk[stage], b'prior interrupted journal')
        self.replace.assert_not_called()

    def inventory(self, tamper=None):
        artifact = release.ARTIFACTS / 'synthetic-reviewed.aar'
        self.disk[artifact] = b'publisher artifact'
        value = {'schema': 1, 'configuration': 'releaseRuntimeClasspath', 'artifacts': [
            {'id': f'synthetic:reviewed-{n if n < 143 else n - 143}:1',
             'sha256': release.digest(self.disk[artifact]), 'inputPath': str(artifact),
             'extension': 'aar' if n < 143 else 'jar'} for n in range(147)]}
        expected = json.dumps(value).encode()
        if tamper == 'coordinate':
            value['artifacts'][0]['id'] = 'synthetic:unreviewed:2'
        elif tamper == 'artifact':
            self.disk[artifact] = b'different artifact'
        stage = release.OUT / 'scratch/release-stage-runtime.json'
        self.disk[stage] = json.dumps(value).encode()
        args = SimpleNamespace(source_commit=self.new_commit, inventory_file=stage, build_alias='W')
        with patch.object(release, 'source_guard'), patch.object(release, 'source_files', return_value=({}, {})), \
             patch.object(release, 'bundle_module'), patch.object(release, 'metadata_check'), \
             patch.object(release, 'retained_reviews', return_value=({'resolved-runtime-final-private.json': expected}, {})):
            return release.accept_inventory(args)

    def test_fresh_runtime_stage_requires_exact_graph_and_actual_publisher_bytes_before_promotion(self):
        result = self.inventory()
        self.assertTrue(result['inventoryAccepted'])
        self.assertEqual(result['artifactsVerified'], 147)
        self.assertIn('resolved-runtime-private.json', release.load(release.REPLACEMENT)['files'])
        self.assertEqual(self.disk[release.APPROVED], self.payload)

    def test_changed_runtime_coordinate_or_actual_artifact_blocks_promotion(self):
        for tamper in ['coordinate', 'artifact']:
            with self.subTest(tamper=tamper), self.assertRaises(release.ReleaseError):
                self.inventory(tamper)
            self.assertEqual(self.disk[release.OUT / 'resolved-runtime-private.json'],
                             self.before[release.OUT / 'resolved-runtime-private.json'])
            self.replace.assert_not_called()

    def test_traversal_unknown_and_duplicate_members_are_not_rollback_evidence(self):
        for bad in ['release/../../private', 'release/unknown.bin', 'telegram/another-release.json']:
            entries = {'release/' + name: data for name, data in self.old_files.items()}
            entries[bad] = b'bad'
            payload = self.archive(entries)
            self.disk[release.APPROVED] = payload
            with self.subTest(bad=bad), self.assertRaises(release.ReleaseError):
                release.approved_archive(release.digest(payload))
        stream = io.BytesIO()
        with warnings.catch_warnings(), zipfile.ZipFile(stream, 'w') as archive:
            warnings.simplefilter('ignore', UserWarning)
            archive.writestr('APPROVED_MANIFEST.json', b'{}')
            archive.writestr('APPROVED_MANIFEST.json', b'{}')
        self.disk[release.APPROVED] = stream.getvalue()
        with self.assertRaisesRegex(release.ReleaseError, 'member set'):
            release.approved_archive(release.digest(stream.getvalue()))

    def test_archive_is_rechecked_before_mutation_after_staging(self):
        original = release.replacement_allowed
        calls = 0
        def changed_archive(paths):
            nonlocal calls
            calls += 1
            if calls == 3:
                self.disk[release.APPROVED] += b'changed during staging'
            return original(paths)
        with patch.object(release, 'replacement_allowed', side_effect=changed_archive), \
             self.assertRaisesRegex(release.ReleaseError, 'archive changed'):
            release.write(release.SOURCE, b'new')
        self.assertEqual(self.disk[release.SOURCE], self.before[release.SOURCE])
        self.replace.assert_not_called()

    def test_no_replace_flag_keeps_original_exclusive_write_behavior(self):
        with patch.object(release, 'REPLACEMENT_SHA', None), self.assertRaises(FileExistsError):
            release.write(release.SOURCE, b'new')
        self.assertEqual(self.disk[release.SOURCE], self.before[release.SOURCE])


if __name__ == '__main__':
    unittest.main()
