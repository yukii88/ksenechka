// crypto.js — шифрование и расшифровка личного содержимого подарка.
// Этот файл используют и сайт (чтобы расшифровать), и tools/encrypt.html (чтобы зашифровать).
//
// Как это устроено:
//   пароль → PBKDF2 (600 000 раундов, очень медленно подбирать) → ключ AES-256
//   содержимое (JSON с текстами и фото) → AES-GCM (шифр + проверка целостности)
// Без правильного пароля файл secret.json — просто случайные байты.

const GiftCrypto = (() => {
  const ITERATIONS = 600000;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // Приводим пароль к одному виду, чтобы «Наша Фраза » и «наша фраза» считались одинаковыми
  // (айфон любит сам ставить заглавную букву в начале).
  function normalizePassword(p) {
    return p.normalize('NFC').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
  }

  function toB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  function fromB64(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  async function deriveKey(password, salt, iterations) {
    const base = await crypto.subtle.importKey(
      'raw', enc.encode(normalizePassword(password)), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }

  // Зашифровать объект. hint — подсказка к паролю, она НЕ шифруется (видна всем).
  async function encrypt(obj, password, hint) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, ITERATIONS);
    const data = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
    return {
      v: 1,
      hint: hint || '',
      iterations: ITERATIONS,
      salt: toB64(salt),
      iv: toB64(iv),
      data: toB64(new Uint8Array(data)),
    };
  }

  // Расшифровать готовым ключом. При неверном ключе бросает ошибку.
  async function decryptWithKey(box, key) {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.data));
    return JSON.parse(dec.decode(plain));
  }

  // Расшифровать паролем. Возвращает и содержимое, и ключ (чтобы запомнить его на телефоне).
  async function unlock(box, password) {
    const key = await deriveKey(password, fromB64(box.salt), box.iterations);
    const content = await decryptWithKey(box, key);
    return { key, content };
  }

  async function exportKey(key) {
    return toB64(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
  }

  function importKey(b64) {
    return crypto.subtle.importKey('raw', fromB64(b64), 'AES-GCM', false, ['decrypt']);
  }

  return { encrypt, unlock, decryptWithKey, exportKey, importKey, normalizePassword };
})();
