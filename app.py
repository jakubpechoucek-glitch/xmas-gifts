"""Xmas gifts: a tiny Flask app that runs locally and as a Databricks App.

Who is looking at the page is decided by the SSO headers that Databricks Apps
put on every request (X-Forwarded-Email). Each person only ever receives their
own personal message, and only when they actually open their gift.
"""
import json
import os
import re
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
MESSAGES_FILE = BASE_DIR / "messages.json"

app = Flask(__name__, static_folder=str(BASE_DIR / "static"), static_url_path="/static")


# --------------------------------------------------------------------------- helpers
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
    """E-mail of the signed-in viewer, lower-cased ('' when unknown).

    The ?as= override only exists for local testing and only works when the
    environment variable XMAS_DEV=1 is set. It is never set on Databricks.
    """
    email = ""
    if os.getenv("XMAS_DEV") == "1":
        email = request.args.get("as", "")
    if not email:
        email = (
            request.headers.get("X-Forwarded-Email")
            or request.headers.get("X-Forwarded-Preferred-Username")
            or ""
        )
    return email.strip().lower()


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
    data = load_data()
    name, _ = lookup(current_email(), data)
    if is_expired():
        return jsonify(expired=True, name=name, closing=data["closing"])
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
    if is_expired():
        return jsonify(error="expired"), 410
    data = load_data()
    name, message = lookup(current_email(), data)
    return jsonify(name=name, message=message)


# --------------------------------------------------------------------------- main
if __name__ == "__main__":
    port = int(os.getenv("DATABRICKS_APP_PORT") or os.getenv("PORT") or 8000)
    try:
        from waitress import serve

        serve(app, host="0.0.0.0", port=port, threads=8)
    except ImportError:  # local fallback
        app.run(host="0.0.0.0", port=port)
