import importlib.util
import stat
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("staging_config", ROOT / "scripts/staging_config.py")
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

def valid_env():
    return {
        "IOETI_ENV": "staging", "IOETI_STAGING_ORIGIN": "https://internal.ioeti.test",
        "VITE_IOETI_DEMO": "false", "IOETI_DB_HOST": "127.0.0.1",
        "IOETI_DB_PORT": "5432", "IOETI_DB_NAME": "ioeti_stage",
        "IOETI_DB_USER": "ioeti_stage", "IOETI_DB_PASSWORD": "DB_" + "x" * 35,
        "IOETI_ENCRYPTION_PASSWORD": "ENC_" + "y" * 35,
        "IOETI_BANKORDER_ENCRYPTION_PASSWORD": "BANK_" + "z" * 35,
        "IOETI_LOCALE": "ar", "IOETI_DATA_DIR": "/var/lib/ioeti/data",
        "IOETI_LOG_DIR": "/var/log/ioeti",
    }

class StagingConfigTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.template = (ROOT / "infra/axelor/axelor-config.ioeti.template.properties").read_text()

    def test_enforces_secure_properties(self):
        rendered = module.render(self.template, valid_env())
        module.validate_properties(rendered)
        self.assertIn("db.default.ddl = none", rendered)
        self.assertIn("application.mode = prod", rendered)
        self.assertIn("session.cookie.secure = true", rendered)
        self.assertIn("ioeti.security.generic-api = restricted", rendered)
        self.assertNotIn("@@", rendered)

    def test_demo_forbidden(self):
        env = valid_env(); env["VITE_IOETI_DEMO"] = "true"
        with self.assertRaises(module.StagingError):
            module.render(self.template, env)

    def test_http_forbidden(self):
        env = valid_env(); env["IOETI_STAGING_ORIGIN"] = "http://internal.ioeti.test"
        with self.assertRaises(module.StagingError):
            module.render(self.template, env)

    def test_placeholder_and_localhost_forbidden(self):
        for url in ("https://crm.example.org", "https://localhost", "https://user:pass@internal.ioeti.test"):
            with self.subTest(url=url):
                env = valid_env(); env["IOETI_STAGING_ORIGIN"] = url
                with self.assertRaises(module.StagingError):
                    module.render(self.template, env)

    def test_default_password_forbidden(self):
        env = valid_env(); env["IOETI_DB_PASSWORD"] = "admin"
        with self.assertRaises(module.StagingError):
            module.render(self.template, env)

    def test_template_secret_forbidden(self):
        env = valid_env(); env["IOETI_DB_PASSWORD"] = "REPLACE_WITH_LONG_RANDOM_SECRET"
        with self.assertRaises(module.StagingError):
            module.render(self.template, env)

    def test_reused_secrets_forbidden(self):
        env = valid_env(); env["IOETI_DB_PASSWORD"] = env["IOETI_ENCRYPTION_PASSWORD"]
        with self.assertRaises(module.StagingError):
            module.render(self.template, env)

    def test_relative_storage_forbidden(self):
        env = valid_env(); env["IOETI_DATA_DIR"] = ".local/data"
        with self.assertRaises(module.StagingError):
            module.render(self.template, env)

    def test_detects_unsafe_ddl_after_render(self):
        output = module.render(self.template, valid_env()).replace(
            "db.default.ddl = none", "db.default.ddl = update")
        with self.assertRaises(module.StagingError):
            module.validate_properties(output)

    def test_owner_only_output(self):
        with tempfile.TemporaryDirectory() as dirname:
            output = Path(dirname) / "axelor.properties"
            module.save_private(output, module.render(self.template, valid_env()))
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
            self.assertTrue(output.read_text())

    def test_missing_output_parent_forbidden(self):
        with tempfile.TemporaryDirectory() as dirname:
            with self.assertRaises(module.StagingError):
                module.save_private(Path(dirname) / "missing" / "app.properties", "unused")

if __name__ == "__main__":
    unittest.main()
