#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Расшифровка data/state.json (AES-GCM + PBKDF2-SHA256), совместимо с js/crypto.js."""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import Any, Dict

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

DEFAULT_ITERATIONS = 250000


def is_envelope(obj: Any) -> bool:
    return (
        isinstance(obj, dict)
        and obj.get("v") == 1
        and obj.get("alg") == "AES-GCM"
        and obj.get("kdf") == "PBKDF2-SHA256"
    )


def is_initialized(obj: Any) -> bool:
    return (
        is_envelope(obj)
        and obj.get("initialized") is not False
        and bool(obj.get("ct"))
        and bool(obj.get("salt"))
        and bool(obj.get("iv"))
    )


def decrypt_envelope(envelope: Dict[str, Any], password: str) -> Dict[str, Any]:
    if not is_initialized(envelope):
        raise ValueError("Хранилище не инициализировано (нет зашифрованных данных)")
    if not password:
        raise ValueError("Пустой пароль")

    salt = base64.b64decode(envelope["salt"])
    iv = base64.b64decode(envelope["iv"])
    ct = base64.b64decode(envelope["ct"])
    iterations = int(envelope.get("iter") or DEFAULT_ITERATIONS)

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=iterations,
    )
    key = kdf.derive(password.encode("utf-8"))
    plaintext = AESGCM(key).decrypt(iv, ct, None)
    data = json.loads(plaintext.decode("utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Расшифрованные данные не являются JSON-объектом")
    return data


def encrypt_state(
    plaintext: Dict[str, Any],
    password: str,
    existing_salt_b64: str | None = None,
    iterations: int = DEFAULT_ITERATIONS,
) -> Dict[str, Any]:
    """Совместимо с js/crypto.js — для локальных правок Claude Code / CLI."""
    import os as _os

    if not password:
        raise ValueError("Пустой пароль")
    salt = (
        base64.b64decode(existing_salt_b64)
        if existing_salt_b64
        else _os.urandom(16)
    )
    iv = _os.urandom(12)
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=iterations,
    )
    key = kdf.derive(password.encode("utf-8"))
    ct = AESGCM(key).encrypt(iv, json.dumps(plaintext, ensure_ascii=False).encode("utf-8"), None)
    return {
        "v": 1,
        "alg": "AES-GCM",
        "kdf": "PBKDF2-SHA256",
        "iter": iterations,
        "initialized": True,
        "salt": base64.b64encode(salt).decode("ascii"),
        "iv": base64.b64encode(iv).decode("ascii"),
        "ct": base64.b64encode(ct).decode("ascii"),
    }


def load_and_decrypt(path: Path, password: str | None = None) -> Dict[str, Any]:
    password = (password if password is not None else os.environ.get("APP_PASSWORD", "")).strip()
    raw = json.loads(path.read_text(encoding="utf-8"))

    if is_envelope(raw):
        if raw.get("initialized") is False or not raw.get("ct"):
            raise RuntimeError(
                "Хранилище ещё не инициализировано. Откройте сайт, создайте PIN и синхронизируйте."
            )
        if not password:
            raise RuntimeError(
                "Файл зашифрован. Задайте APP_PASSWORD (тот же PIN/пароль, что в приложении)."
            )
        return decrypt_envelope(raw, password)

    # Обратная совместимость: старый plaintext (до миграции)
    if isinstance(raw, dict) and "monetization" in raw:
        return raw

    raise ValueError(f"Неизвестный формат {path}")
