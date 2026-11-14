"""Xmas gifts: a tiny Flask app that runs as a Databricks App or on any web host.

Who is looking at the page is decided by AUTH_MODE:

* ``header`` (default, Databricks Apps): the SSO header X-Forwarded-Email that
  Databricks puts on every request. It cannot be forged by the viewer.
* ``email`` (Render and other plain hosts): the viewer types their work e-mail
  on the first screen and the browser sends it in X-Xmas-Email. There is no
  real authentication here, so the personal message is protected only by
  knowing the e-mail address. ALLOWED_EMAIL_DOMAINS narrows who can ask.

Either way a person only ever receives their own message, and only when they
actually open their gift.
"""
import json
import os
import re
import time
from collections import defaultdict, deque
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
MESSAGES_FILE = BASE_DIR / "messages.json"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

app = Flask(__name__, static_folder=str(BASE_DIR / "static"), static_url_path="/static")

_hits: dict[str, deque] = defaultdict(deque)


# --------------------------------------------------------------------------- helpers
def auth_mode() -> str:
    return "email" if os.getenv("AUTH_MODE", "header").strip().lower() == "email" else "header"


def expires_at() -> datetime:
    """Moment after which the gifts are gone (default: 1 Jan 2027, Manila time)."""
    return datetime.fromisoformat(os.getenv("EXPIRES_AT", "2027-01-01T00:00:00+08:00"))


def is_expired() -> bool:
    limit = expires_at()
    return datetime.now(limit.tzinfo) >= limit


def load_data() -> dict:
    with open(MESSAGES_FILE, encoding="utf-8") as f:
        data = json.load(f)
    data["people"] = {k.strip().lower(): v for k, v in data.get("people", {}).items()}
    return data


def current_email() -> str:
    """E-mail of the viewer, lower-cased ('' when unknown).

    The ?as= override only exists for local testing and only works when the
    environment variable XMAS_DEV=1 is set. It is never set in production.
    """
    email = ""
    if os.getenv("XMAS_DEV") == "1":
        email = request.args.get("as", "")
    if not email:
        if auth_mode() == "email":
            email = request.headers.get("X-Xmas-Email", "")
        else:  # only the SSO headers count here; X-Xmas-Email is deliberately ignored
            email = (
                request.headers.get("X-Forwarded-Email")
                or request.headers.get("X-Forwarded-Preferred-Username")
                or ""
            )
    return email.strip().lower()


def domain_ok(email: str) -> bool:
    allowed = [d.strip().lower().lstrip("@") for d in os.getenv("ALLOWED_EMAIL_DOMAINS", "").split(",") if d.strip()]
    return not allowed or email.rsplit("@", 1)[-1] in allowed


def rate_limited() -> bool:
    """Crude per-IP flood guard (email mode only). Generous: an office may share one IP."""
    limit = int(os.getenv("RATE_LIMIT_PER_MIN", "300"))
    ip = (request.access_route[0] if request.access_route else request.remote_addr) or "?"
    now = time.monotonic()
    q = _hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= limit:
        return True
    q.append(now)
    return False


def resolve_viewer():
    """Return (email, error_response). error_response is None when all is fine."""
    if auth_mode() != "email":
        return current_email(), None
    if rate_limited():
        return "", (jsonify(error="rate_limited"), 429)
    email = current_email()
    if not email:
        return "", None  # the caller asks for the e-mail
    if not EMAIL_RE.match(email):
        return "", (jsonify(error="invalid_email"), 400)
    if not domain_ok(email):
        return "", (jsonify(error="domain"), 403)
    return email, None


def guess_name(email: str) -> str:
    """maria.santos@corp.com -> Maria; unknown -> friend."""
    first = re.split(r"[._\-+0-9]+", email.split("@")[0])[0]
    return first.capitalize() if first else "friend"


def lookup(email: str, data: dict) -> tuple[str, str]:
    entry = data["people"].get(email) or {}
    name = entry.get("name") or guess_name(email)
    message = entry.get("message") or data["default"]["message"].replace("{name}", name)
    return name, message


# --------------------------------------------------------------------------- routes
@app.after_request
def add_headers(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "no-referrer"
    if request.path.startswith("/api/") or request.path == "/":
        resp.headers["Cache-Control"] = "no-store"
    return resp


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/healthz")
def healthz():
    return jsonify(ok=True)


@app.get("/api/state")
def api_state():
    """Everything that is the same for everybody, plus the viewer's first name.

    The personal message is NOT part of this response; see /api/gift.
    """
    email, err = resolve_viewer()
    if err:
        return err
    data = load_data()
    name, _ = lookup(email, data)
    if is_expired():
        return jsonify(expired=True, name=name, closing=data["closing"])
    if auth_mode() == "email" and not email:
        return jsonify(expired=False, needs_email=True)
    return jsonify(
        expired=False,
        name=name,
        gifts=data["gifts"],
        star=data["star"],
        closing=data["closing"],
    )


@app.get("/api/gift")
def api_gift():
    """The viewer's personal message (only theirs, only before expiry)."""
    email, err = resolve_viewer()
    if err:
        return err
    if is_expired():
        return jsonify(error="expired"), 410
    if auth_mode() == "email" and not email:
        return jsonify(error="email_required"), 401
    name, message = lookup(email, load_data())
    return jsonify(name=name, message=message)


# --------------------------------------------------------------------------- main
if __name__ == "__main__":
    port = int(os.getenv("DATABRICKS_APP_PORT") or os.getenv("PORT") or 8000)
    try:
        from waitress import serve

        serve(app, host="0.0.0.0", port=port, threads=8)
    except ImportError:  # local fallback
        app.run(host="0.0.0.0", port=port)
