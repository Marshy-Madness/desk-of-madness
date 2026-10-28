"""OpenID Connect sign-in (Authentik, Keycloak, …): authorization code + PKCE, standard library only.

The ID token comes straight from the provider's token endpoint over HTTPS, authenticated with the client
secret, so TLS stands in for checking its signature (OpenID Connect Core 3.1.3.7). Issuer, audience,
expiry and nonce are still checked.
"""
import base64
import hashlib
import json
import os
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ISSUER = (os.environ.get("OIDC_ISSUER") or "").strip()
CLIENT_ID = (os.environ.get("OIDC_CLIENT_ID") or "").strip()
CLIENT_SECRET = os.environ.get("OIDC_CLIENT_SECRET") or ""
LABEL = os.environ.get("OIDC_LABEL") or "Sign in with SSO"
# Create a Desk account on someone's first SSO sign-in (the provider decides who may sign in).
# Off: only people who already have a Desk account (matched by verified email) get in.
AUTO_REGISTER = (os.environ.get("OIDC_AUTO_REGISTER") or "true").lower() not in ("0", "false", "no", "off")
LOGIN_TTL = 600

_lock = threading.Lock()
_metadata = None
_pending = {}  # state -> {nonce, verifier, redirect, link_uid, exp}


def enabled() -> bool:
    return bool(ISSUER and CLIENT_ID)


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "DeskOfMadness-Server"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def metadata() -> dict:
    """Discovery document, fetched on first use (and again later if the provider was down)."""
    global _metadata
    with _lock:
        if _metadata is None:
            meta = _get_json(ISSUER.rstrip("/") + "/.well-known/openid-configuration")
            if meta.get("issuer", "").rstrip("/") != ISSUER.rstrip("/"):
                raise ValueError(f"OIDC issuer mismatch: {meta.get('issuer')} (expected {ISSUER})")
            _metadata = meta
        return _metadata


def start(redirect_uri: str, link_uid: str = None) -> str:
    """URL to send the browser to. link_uid: attach the SSO identity to this signed-in user."""
    meta = metadata()
    state, nonce, verifier = secrets.token_urlsafe(24), secrets.token_urlsafe(24), secrets.token_urlsafe(48)
    challenge = _b64url(hashlib.sha256(verifier.encode()).digest())
    now = time.time()
    with _lock:
        for k in [k for k, v in _pending.items() if v["exp"] < now]:
            del _pending[k]
        _pending[state] = {"nonce": nonce, "verifier": verifier, "redirect": redirect_uri, "link_uid": link_uid,
                           "exp": now + LOGIN_TTL}
    params = {"response_type": "code", "client_id": CLIENT_ID, "redirect_uri": redirect_uri,
              "scope": "openid email profile", "state": state, "nonce": nonce,
              "code_challenge": challenge, "code_challenge_method": "S256"}
    return meta["authorization_endpoint"] + "?" + urllib.parse.urlencode(params)


def _claims(id_token: str) -> dict:
    try:
        payload = id_token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (IndexError, ValueError) as e:
        raise ValueError(f"Unreadable ID token: {e}")


def finish(query: dict) -> tuple:
    """Handles the callback. Returns (claims, link_uid). Raises ValueError with a readable message."""
    if query.get("error"):
        raise ValueError(query.get("error_description") or query["error"])
    with _lock:
        pending = _pending.pop(query.get("state", ""), None)
    if not pending or pending["exp"] < time.time():
        raise ValueError("Sign-in expired. Please try again.")
    if not query.get("code"):
        raise ValueError("The provider sent no code.")
    meta = metadata()
    form = urllib.parse.urlencode({"grant_type": "authorization_code", "code": query["code"],
                                   "redirect_uri": pending["redirect"], "code_verifier": pending["verifier"]}).encode()
    basic = base64.b64encode(f"{urllib.parse.quote(CLIENT_ID, safe='')}:{urllib.parse.quote(CLIENT_SECRET, safe='')}".encode()).decode()
    req = urllib.request.Request(meta["token_endpoint"], data=form, method="POST",
                                 headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json",
                                          "Authorization": f"Basic {basic}", "User-Agent": "DeskOfMadness-Server"})
    if not meta["token_endpoint"].startswith("https://"):
        raise ValueError("The provider's token endpoint must use https")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            tokens = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise ValueError(f"Token exchange failed ({e.code})")
    claims = _claims(tokens.get("id_token") or "")
    aud = claims.get("aud")
    if claims.get("iss", "").rstrip("/") != meta["issuer"].rstrip("/"):
        raise ValueError("ID token from the wrong issuer")
    if CLIENT_ID not in (aud if isinstance(aud, list) else [aud]):
        raise ValueError("ID token for another app")
    if float(claims.get("exp", 0)) < time.time() - 60:
        raise ValueError("ID token expired")
    if not secrets.compare_digest(str(claims.get("nonce", "")), pending["nonce"]):
        raise ValueError("ID token nonce mismatch")
    if not claims.get("sub"):
        raise ValueError("ID token has no subject")
    return claims, pending["link_uid"]
