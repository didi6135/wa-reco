import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('export_public_source', Path(__file__).parents[1] / 'export-public-source.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PublicSourceChecks(unittest.TestCase):
    def test_private_and_unrelated_files_are_excluded(self):
        names = ['.env', '.env.production', '.env.example', '.planning/STATE.md',
                 'artifacts/call.wav', 'android/local.properties', 'android/signing.properties',
                 'android/app/release.jks', 'android/app/custom.keystore',
                 'android/vendor/private.jar', 'android/vendor/prebuilt.aar',
                 'android/vendor/prebuilt.so', 'src/private.sqlite',
                 'android/app/build/generated/file.java', 'src/session.wav',
                 '../escape', '/absolute', 'src/../../escape', 'other/new.txt',
                 'android/vendor/.git/config', 'src/__pycache__/secret.pyc',
                 'tools/android-device-matrix/artifacts/result.json',
                 'tools/android-device-matrix/local.properties',
                 'src\\unexpected.txt']
        for name in names:
            with self.subTest(name=name):
                self.assertFalse(module.included(name))

    def test_source_and_required_notices_are_included(self):
        for name in ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
                     'LICENSES/LGPL-3.0-only.txt', 'android/vendor/libadb/LICENSES/Apache-2.0',
                     'android/app/build.gradle', 'src/screens/SettingsScreen.tsx',
                     'docs/signing.properties.example', 'android/app/debug.keystore',
                     'tools/android-device-matrix/run-probe.py',
                     'tools/android-device-matrix/README.md',
                     'tools/android-device-matrix/src/com/codaki/usbaudio/RuntimeAudioProbe.java',
                     'tools/build-android.ps1', 'tools/test-telegram-ui.cjs',
                     'android/app/src/main/java/com/didi4164/WhatsAppCallRecorder/OfflineRecoveryPolicy.java',
                     'docs/offline-recovery-setup.md']:
            with self.subTest(name=name):
                self.assertTrue(module.included(name))

    def test_credential_values_and_private_paths_require_review(self):
        # Synthetic examples, never working-directory credentials.
        values = [b'-----BEGIN ' + b'PRIVATE KEY-----', b'123456789:' + b'x' * 35,
                  b'AIza' + b'x' * 35, b'GOCSPX-' + b'x' * 25,
                  b'1//' + b'x' * 35, b'C:\\Users\\Example\\private',
                  b'C:/Us' + b'ers/Example/private', b'R1A' + b'BC123456']
        for value in values:
            with self.subTest(category=value[:6]):
                self.assertTrue(module.findings('src/config.ts', value))

    def test_build_templates_and_public_cert_fingerprints_are_not_secrets(self):
        self.assertFalse(module.findings('docs/signing.properties.example', b'storePassword=CHANGE_ME'))
        self.assertFalse(module.findings('docs/google-drive-setup.md', b'1C:89:6A:4B:F2:3C:63:67:0F:7C:6F:F0:BE:02:FF:4A:FF:5D:15:7D'))


if __name__ == '__main__':
    unittest.main()
