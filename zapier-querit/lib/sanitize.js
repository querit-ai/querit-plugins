'use strict';

const ESC = 0x1b;
const BEL = 0x07;
const DELETE = 0x7f;
const CSI = 0x9b;
const ST = 0x9c;
const OSC = 0x9d;
const CONTROL_STRING_STARTS = new Set([0x90, 0x98, 0x9e, 0x9f]);
const ESC_CONTROL_STRING_STARTS = new Set([0x50, 0x58, 0x5e, 0x5f]);
const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

const sanitizeUntrustedText = (value) => {
  let output = '';

  for (let index = 0; index < value.length;) {
    const code = value.charCodeAt(index);

    if (code === ESC) {
      const next = value.charCodeAt(index + 1);
      if (next === 0x5b) {
        index = skipCsi(value, index + 2);
      } else if (next === 0x5d) {
        index = skipOsc(value, index + 2);
      } else if (ESC_CONTROL_STRING_STARTS.has(next)) {
        index = skipControlString(value, index + 2);
      } else {
        index += Number.isNaN(next) ? 1 : 2;
      }
      continue;
    }

    if (code === CSI) {
      index = skipCsi(value, index + 1);
      continue;
    }
    if (code === OSC) {
      index = skipOsc(value, index + 1);
      continue;
    }
    if (CONTROL_STRING_STARTS.has(code)) {
      index = skipControlString(value, index + 1);
      continue;
    }

    if (code === 0x0a || code === 0x09) {
      output += value[index];
      index += 1;
      continue;
    }
    if (code < 0x20 || (code >= 0x80 && code <= 0x9f) || code === DELETE) {
      index += 1;
      continue;
    }

    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) break;
    output += String.fromCodePoint(codePoint);
    index += codePoint > 0xffff ? 2 : 1;
  }

  return output.replace(BIDI_CONTROLS, '');
};

const sanitizeErrorMessage = (value, secret) => {
  const rawText = value instanceof Error ? value.message : String(value ?? '');
  const rawSecrets = new Set();

  if (typeof secret === 'string' && secret) {
    rawSecrets.add(secret);
    if (secret.trim()) rawSecrets.add(secret.trim());
  }

  let redacted = rawText;
  for (const candidate of rawSecrets) {
    redacted = redacted.split(candidate).join('[REDACTED]');
  }

  redacted = sanitizeUntrustedText(redacted);
  for (const candidate of rawSecrets) {
    const sanitizedCandidate = sanitizeUntrustedText(candidate);
    if (sanitizedCandidate) {
      redacted = redacted.split(sanitizedCandidate).join('[REDACTED]');
    }
  }

  return redacted.replace(/\s+/gu, ' ').trim().slice(0, 1000);
};

function skipCsi(value, start) {
  let index = start;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    index += 1;
    if (code >= 0x40 && code <= 0x7e) return index;
  }
  return index;
}

function skipOsc(value, start) {
  let index = start;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code === BEL || code === ST) return index + 1;
    if (code === ESC && value.charCodeAt(index + 1) === 0x5c) return index + 2;
    index += 1;
  }
  return index;
}

function skipControlString(value, start) {
  let index = start;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code === ST) return index + 1;
    if (code === ESC && value.charCodeAt(index + 1) === 0x5c) return index + 2;
    index += 1;
  }
  return index;
}

module.exports = {
  sanitizeErrorMessage,
  sanitizeUntrustedText,
};
