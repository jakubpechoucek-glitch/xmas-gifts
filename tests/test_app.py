import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app as xmas  # noqa: E402


def hdr(email):
    return {"X-Forwarded-Email": email}


ENV_KEYS = ("XMAS_DEV", "EXPIRES_AT", "AUTH_MODE", "ALLOWED_EMAIL_DOMAINS", "RATE_LIMIT_PER_MIN")


def clean_env():
    for k in ENV_KEYS:
        os.environ.pop(k, None)
    xmas._hits.clear()


class AppTests(unittest.TestCase):
    def setUp(self):
        clean_env()
        self.c = xmas.app.test_client()

    def test_known_user_gets_own_name_and_message(self):
        s = self.c.get("/api/state", headers=hdr("Maria.Santos@Example.com")).get_json()
        self.assertEqual(s["name"], "Maria")
        g = self.c.get("/api/gift", headers=hdr("maria.santos@example.com")).get_json()
        self.assertIn("Maria,", g["message"])

    def test_messages_are_isolated_between_users(self):
        a = self.c.get("/api/gift", headers=hdr("maria.santos@example.com")).get_json()
        b = self.c.get("/api/gift", headers=hdr("juan.delacruz@example.com")).get_json()
        self.assertNotEqual(a["message"], b["message"])
        self.assertNotIn("Juan", a["message"])
        self.assertNotIn("Maria", b["message"])

    def test_state_never_contains_personal_messages(self):
        raw = self.c.get("/api/state", headers=hdr("maria.santos@example.com")).get_data(as_text=True)
        self.assertNotIn("Monday calls", raw)
        self.assertNotIn("Juan,", raw)

    def test_unknown_user_gets_default_with_guessed_name(self):
        g = self.c.get("/api/gift", headers=hdr("pedro.cruz@corp.com")).get_json()
        self.assertEqual(g["name"], "Pedro")
        self.assertTrue(g["message"].startswith("Dear Pedro,"))

    def test_no_identity_falls_back_to_friend(self):
        g = self.c.get("/api/gift").get_json()
        self.assertEqual(g["name"], "friend")

    def test_dev_override_ignored_unless_enabled(self):
        s = self.c.get("/api/state?as=juan.delacruz@example.com").get_json()
        self.assertEqual(s["name"], "friend")
        os.environ["XMAS_DEV"] = "1"
        s = self.c.get("/api/state?as=juan.delacruz@example.com").get_json()
        self.assertEqual(s["name"], "Juan")

    def test_header_wins_over_nothing_but_dev_param_only_in_dev(self):
        s = self.c.get("/api/state?as=juan.delacruz@example.com", headers=hdr("ana.reyes@example.com")).get_json()
        self.assertEqual(s["name"], "Ana")

    def test_expiry(self):
        os.environ["EXPIRES_AT"] = "2020-01-01T00:00:00+08:00"
        s = self.c.get("/api/state", headers=hdr("maria.santos@example.com")).get_json()
        self.assertTrue(s["expired"])
        self.assertNotIn("gifts", s)
        r = self.c.get("/api/gift", headers=hdr("maria.santos@example.com"))
        self.assertEqual(r.status_code, 410)

    def test_not_expired_before_deadline(self):
        os.environ["EXPIRES_AT"] = "2999-01-01T00:00:00+08:00"
        s = self.c.get("/api/state").get_json()
        self.assertFalse(s["expired"])
        self.assertEqual(len(s["gifts"]), 4)

    def test_html_message_is_returned_verbatim_as_json_data(self):
        # The client renders with textContent, so markup is never interpreted.
        g = self.c.get("/api/gift", headers=hdr("x@y.z")).get_json()
        self.assertEqual(self.c.get("/api/gift", headers=hdr("x@y.z")).mimetype, "application/json")
        self.assertIsInstance(g["message"], str)

    def test_api_not_cached(self):
        r = self.c.get("/api/state")
        self.assertEqual(r.headers["Cache-Control"], "no-store")

    def test_static_files_served(self):
        for path, mime in [("/", "text/html"), ("/static/app.js", "javascript"), ("/static/style.css", "text/css")]:
            r = self.c.get(path)
            self.assertEqual(r.status_code, 200, path)
            self.assertIn(mime, r.mimetype, path)

    def test_messages_file_is_valid(self):
        data = xmas.load_data()
        self.assertEqual(len(data["gifts"]), 4)
        for key in ("default", "star", "closing"):
            self.assertIn(key, data)
        for email, entry in data["people"].items():
            self.assertEqual(email, email.lower())
            self.assertTrue(entry.get("message"), email)


def em(email):
    return {"X-Xmas-Email": email}


class EmailModeTests(unittest.TestCase):
    """AUTH_MODE=email: used on plain hosts such as Render, where there is no SSO."""

    def setUp(self):
        clean_env()
        os.environ["AUTH_MODE"] = "email"
        self.c = xmas.app.test_client()

    def tearDown(self):
        clean_env()

    def test_without_email_the_client_is_asked_for_one(self):
        s = self.c.get("/api/state").get_json()
        self.assertTrue(s["needs_email"])
        self.assertNotIn("gifts", s)
        self.assertNotIn("name", s)

    def test_with_email_returns_name_and_gifts(self):
        s = self.c.get("/api/state", headers=em("Maria.Santos@Example.com")).get_json()
        self.assertEqual(s["name"], "Maria")
        self.assertEqual(len(s["gifts"]), 4)

    def test_personal_message_by_typed_email_and_isolation(self):
        a = self.c.get("/api/gift", headers=em("maria.santos@example.com")).get_json()
        b = self.c.get("/api/gift", headers=em("juan.delacruz@example.com")).get_json()
        self.assertIn("Monday calls", a["message"])
        self.assertNotIn("Monday calls", b["message"])

    def test_gift_requires_email(self):
        r = self.c.get("/api/gift")
        self.assertEqual(r.status_code, 401)

    def test_sso_header_is_not_used_in_email_mode(self):
        s = self.c.get("/api/state", headers=hdr("maria.santos@example.com")).get_json()
        self.assertTrue(s["needs_email"])

    def test_invalid_email_rejected(self):
        for bad in ("maria", "a@b", "@example.com", "ma ria@example.com"):
            r = self.c.get("/api/state", headers=em(bad))
            self.assertEqual(r.status_code, 400, bad)

    def test_domain_restriction(self):
        os.environ["ALLOWED_EMAIL_DOMAINS"] = "corp.com, @example.com"
        self.assertEqual(self.c.get("/api/state", headers=em("x@gmail.com")).status_code, 403)
        self.assertEqual(self.c.get("/api/gift", headers=em("x@gmail.com")).status_code, 403)
        self.assertEqual(self.c.get("/api/state", headers=em("maria.santos@example.com")).status_code, 200)
        self.assertEqual(self.c.get("/api/state", headers=em("pedro@corp.com")).status_code, 200)

    def test_rate_limit(self):
        os.environ["RATE_LIMIT_PER_MIN"] = "3"
        codes = [self.c.get("/api/state", headers=em("pedro@corp.com")).status_code for _ in range(5)]
        self.assertEqual(codes, [200, 200, 200, 429, 429])

    def test_expired_even_without_email(self):
        os.environ["EXPIRES_AT"] = "2020-01-01T00:00:00+08:00"
        s = self.c.get("/api/state").get_json()
        self.assertTrue(s["expired"])
        self.assertEqual(self.c.get("/api/gift", headers=em("pedro@corp.com")).status_code, 410)


class HeaderModeSpoofTests(unittest.TestCase):
    """On Databricks a viewer must not be able to impersonate anyone with X-Xmas-Email."""

    def setUp(self):
        clean_env()
        self.c = xmas.app.test_client()

    def test_xmas_email_header_ignored_in_header_mode(self):
        g = self.c.get("/api/gift", headers={**hdr("juan.delacruz@example.com"), **em("maria.santos@example.com")}).get_json()
        self.assertNotIn("Monday calls", g["message"])
        self.assertIn("Juan", g["name"])


if __name__ == "__main__":
    unittest.main()
