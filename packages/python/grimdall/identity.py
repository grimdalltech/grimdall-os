"""Ed25519 agent identity for the Python SDK.

Provides key generation, signing, verification, and fingerprint computation.
Signature format is compatible with the Node.js implementation so that
Node can verify Python-signed entries and vice versa.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
from typing import Any, Dict, Optional

from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives import serialization


KEY_DIR_NAME = "keys"
PRIVATE_KEY_FILE = "agent.key"
PUBLIC_KEY_FILE = "agent.pub"
IDENTITY_FILE = "identity.json"


def fingerprint_from_public_key(public_key_pem: str) -> str:
    """Compute a 16-hex-digit fingerprint from a public key PEM string.

    Matches the Node.js ``fingerprintFromPublicKey`` computation:
    SHA-256 of the raw public key bytes (the JWK ``x`` field), first 16 hex chars.
    """
    public_key = serialization.load_pem_public_key(public_key_pem.encode("utf-8"))
    raw_bytes = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return hashlib.sha256(raw_bytes).hexdigest()[:16]


def generate_keypair(keys_dir: str) -> Dict[str, Any]:
    """Generate an Ed25519 keypair and persist it locally under ``keys_dir``.

    Creates ``.grimdall/keys/agent.key`` (private, PKCS8 PEM) and
    ``.grimdall/keys/agent.pub`` (public, SPKI PEM). Returns a dict with
    ``agentId``, ``fingerprint``, and ``publicKeyPem``.

    The private key never leaves the machine.
    """
    os.makedirs(keys_dir, exist_ok=True)

    private_key = ed25519.Ed25519PrivateKey.generate()
    public_key = private_key.public_key()

    private_key_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")

    public_key_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SPKI,
    ).decode("utf-8")

    fingerprint = fingerprint_from_public_key(public_key_pem)

    _write_file(os.path.join(keys_dir, PRIVATE_KEY_FILE), private_key_pem)
    _write_file(os.path.join(keys_dir, PUBLIC_KEY_FILE), public_key_pem)

    stored: Dict[str, Any] = {"version": 1, "agentId": "default", "fingerprint": fingerprint}
    _write_json_file(os.path.join(keys_dir, IDENTITY_FILE), stored)

    return {
        "agentId": "default",
        "fingerprint": fingerprint,
        "publicKeyPem": public_key_pem,
    }


def load_keypair(keys_dir: str) -> Dict[str, Any]:
    """Load an existing Ed25519 keypair from ``keys_dir``.

    Returns a dict with ``agentId``, ``fingerprint``, ``publicKeyPem``, and
    ``sign`` function. Raises ``FileNotFoundError`` if no identity exists.
    """
    if not _key_file_exists(os.path.join(keys_dir, PRIVATE_KEY_FILE)):
        raise FileNotFoundError(
            f"No agent identity found at {keys_dir}. Run generate_keypair first.",
        )

    public_key_pem = _read_file(os.path.join(keys_dir, PUBLIC_KEY_FILE))
    fingerprint = fingerprint_from_public_key(public_key_pem)
    private_key_pem = _read_file(os.path.join(keys_dir, PRIVATE_KEY_FILE))
    private_key = serialization.load_pem_private_key(
        private_key_pem.encode("utf-8"),
        password=None,
    )

    return {
        "agentId": "default",
        "fingerprint": fingerprint,
        "publicKeyPem": public_key_pem,
        "sign": lambda data: base64.b64encode(
            private_key.sign(data.encode("utf-8"))
        ).decode("utf-8"),
    }


def verify_signature(
    data: str,
    signature_b64: str,
    public_key_pem: str,
    fingerprint: Optional[str] = None,
) -> bool:
    """Verify an Ed25519 signature against data.

    :param data: The original data string that was signed.
    :param signature_b64: Base64-encoded 64-byte Ed25519 signature.
    :param public_key_pem: PEM-encoded public key to verify against.
    :param fingerprint: Optional expected fingerprint; if provided and differs,
        verification fails.
    :returns: ``True`` if the signature is valid and (optionally) the fingerprint
        matches.
    """
    try:
        sig_bytes = base64.b64decode(signature_b64)
    except Exception:
        return False

    if fingerprint is not None:
        expected_fp = fingerprint_from_public_key(public_key_pem)
        if fingerprint != expected_fp:
            return False

    try:
        public_key = serialization.load_pem_public_key(public_key_pem.encode("utf-8"))
        public_key.verify(sig_bytes, data.encode("utf-8"))
        return True
    except Exception:
        return False


def _key_file_exists(path: str) -> bool:
    return os.path.exists(path)


def _write_file(path: str, content: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def _read_file(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _write_json_file(path: str, data: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(data, indent=2) + "\n")