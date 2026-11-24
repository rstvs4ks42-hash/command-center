/**
 * AES-GCM + PBKDF2-SHA256 (Web Crypto API)
 * Формат конверта совместим с bot/crypto_util.py
 */
(function () {
  const ITERATIONS = 250000;
  const SALT_LEN = 16;
  const IV_LEN = 12;

  function bufToB64(buf) {
    const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function b64ToBuf(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function isEnvelope(obj) {
    return !!(obj && obj.v === 1 && obj.alg === "AES-GCM" && obj.kdf === "PBKDF2-SHA256");
  }

  function isInitialized(obj) {
    return isEnvelope(obj) && obj.initialized !== false && !!obj.ct && !!obj.salt && !!obj.iv;
  }

  function emptyEnvelope() {
    return {
      v: 1,
      alg: "AES-GCM",
      kdf: "PBKDF2-SHA256",
      iter: ITERATIONS,
      initialized: false,
      salt: null,
      iv: null,
      ct: null,
    };
  }

  async function deriveKey(password, saltBytes, iterations) {
    const enc = new TextEncoder();
    const material = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: saltBytes,
        iterations: iterations || ITERATIONS,
        hash: "SHA-256",
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptState(password, plaintextObj, existingSaltB64) {
    const salt = existingSaltB64
      ? b64ToBuf(existingSaltB64)
      : crypto.getRandomValues(new Uint8Array(SALT_LEN));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
    const key = await deriveKey(password, salt, ITERATIONS);
    const pt = new TextEncoder().encode(JSON.stringify(plaintextObj));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
    return {
      v: 1,
      alg: "AES-GCM",
      kdf: "PBKDF2-SHA256",
      iter: ITERATIONS,
      initialized: true,
      salt: bufToB64(salt),
      iv: bufToB64(iv),
      ct: bufToB64(ct),
    };
  }

  async function decryptState(password, envelope) {
    if (!isInitialized(envelope)) {
      throw new Error("Хранилище ещё не инициализировано");
    }
    try {
      const key = await deriveKey(password, b64ToBuf(envelope.salt), envelope.iter || ITERATIONS);
      const pt = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: b64ToBuf(envelope.iv) },
        key,
        b64ToBuf(envelope.ct)
      );
      return JSON.parse(new TextDecoder().decode(pt));
    } catch (e) {
      throw new Error("Неверный PIN/пароль или повреждённый файл");
    }
  }

  window.CCCrypto = {
    ITERATIONS,
    isEnvelope,
    isInitialized,
    emptyEnvelope,
    encryptState,
    decryptState,
  };
})();
