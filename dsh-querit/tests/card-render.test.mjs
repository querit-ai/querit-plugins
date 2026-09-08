/**
 * Render-level smoke tests for the built browser bundle (lib/card.js).
 *
 * The bundle is a loader-wrapped script, so it is executed inside a vm
 * sandbox that provides `module`/`exports`/`require` (mirroring the browser
 * loader contract); the exported QueritCard component is then rendered with
 * react-dom/server to assert the card actually draws its controls.
 * Run `npm run build` before `npm test`.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const bundlePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'card.js');

function loadBundle() {
  const module = { exports: {} };
  const sandbox = { module, exports: module.exports, require, console };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(bundlePath, 'utf8'), sandbox);
  return module.exports;
}

/** A ready, writable projection as the card component would receive it. */
function snapshot(over = {}) {
  return {
    available: true,
    writable: true,
    dirty: false,
    invalid: false,
    saving: false,
    failed: false,
    apiKeyEnv: { text: 'QUERIT_API_KEY', overridden: true, invalid: false },
    count: { text: '5', overridden: false, invalid: false },
    timeRange: { text: '', overridden: false, invalid: false },
    languages: { text: '', overridden: false, invalid: false },
    countries: { text: '', overridden: false, invalid: false },
    includeDomains: { text: '', overridden: false, invalid: false },
    excludeDomains: { text: '', overridden: false, invalid: false },
    includeContent: { text: 'false', overridden: false, invalid: false },
    fetchFormat: { text: 'markdown', overridden: false, invalid: false },
    apiKey: { text: '', overridden: false, invalid: false },
    apiKeyConfigured: false,
    apiKeyWritable: true,
    apiKeyRef: 'QUERIT_API_KEY',
    ...over,
  };
}

function render(snap) {
  const { QueritCard } = loadBundle();
  return renderToStaticMarkup(
    React.createElement(QueritCard, {
      t: (key) => key,
      defaultOpen: true,
      useQueritCard: (select) => select(snap),
      edit: () => {},
      resetField: () => {},
      save: () => {},
      discard: () => {},
    }),
  );
}

describe('QueritCard rendering (built bundle)', () => {
  it('draws an input control for every section field', () => {
    const html = render(snapshot());
    const inputs = html.match(/class="qr-input/g) ?? [];
    expect(inputs.length).toBeGreaterThanOrEqual(8);
    expect(html).toContain('countLabel');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('type="password"');
  });

  it('renders nothing while the namespace is unavailable', () => {
    expect(render(snapshot({ available: false }))).toBe('');
  });

  it('keeps controls enabled in a writable deployment', () => {
    const html = render(snapshot());
    const numberTag = html.match(/<input[^>]*type="number"[^>]*>/)?.[0] ?? '';
    expect(numberTag).toContain('value="5"');
    expect(numberTag).not.toContain('disabled');
  });

  it('disables controls in a read-only deployment', () => {
    const html = render(snapshot({ writable: false }));
    const numberTag = html.match(/<input[^>]*type="number"[^>]*>/)?.[0] ?? '';
    expect(numberTag).toContain('disabled');
  });

  it('enables save only when the form is dirty', () => {
    const saveTag = (html) => html.match(/<button[^>]*class="qr-btn qr-save"[^>]*>/)?.[0] ?? '';
    expect(saveTag(render(snapshot()))).toContain('disabled');
    expect(saveTag(render(snapshot({ dirty: true, invalid: false })))).not.toContain('disabled');
  });
});

/**
 * Wiring tests for the browser half: `apply` must mount through the client
 * seams dsh 0.1.2 provides (`remote.credentials`, dotted fiber inject), and
 * the controller must unwrap the new describe/set response shapes.
 */

/** Let promise chains inside the vm bundle settle before asserting. */
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

/** A ready, writable settings scope over an in-memory section. */
function scopeStub(section = { apiKeyEnv: 'QUERIT_API_KEY' }) {
  let snapshot = {
    status: 'ready',
    value: section,
    base: {},
    user: {},
    revision: 1,
    writable: true,
    mode: 'host',
  };
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn());
  return {
    getSnapshot: () => snapshot,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async set(field, value) {
      snapshot = { ...snapshot, value: { ...snapshot.value, [field]: value } };
      notify();
    },
    async unset(field) {
      const value = { ...snapshot.value };
      delete value[field];
      snapshot = { ...snapshot, value };
      notify();
    },
  };
}

/** A `remote` service recording every credentials call it serves. */
function remoteStub() {
  const calls = { describe: [], set: [], events: {} };
  return {
    calls,
    remote: {
      $on(event, handler) {
        calls.events[event] = handler;
        return () => {};
      },
      credentials: {
        describe(refs) {
          calls.describe.push(refs);
          return Promise.resolve({
            ok: true,
            value: { QUERIT_API_KEY: { configured: true, writable: false } },
          });
        },
        set(ref, value) {
          calls.set.push([ref, value]);
          return Promise.resolve();
        },
      },
    },
  };
}

describe('browser apply wiring (built bundle)', () => {
  it('declares the 0.1.2 client services and mounts the card slot', async () => {
    const { apply, inject } = loadBundle();
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.credentials', 'settingsScope']);

    const { calls, remote } = remoteStub();
    const injected = [];
    const services = {
      slots: {
        inject(name, register) {
          injected.push([name, register()]);
        },
        register(options) {
          return options;
        },
      },
      locale: {
        register: () => () => {},
        bind: () => (key) => key,
      },
      settingsScope: { bind: () => scopeStub() },
      remote,
    };
    const ctx = {
      get: (name) => services[name],
      remote,
      effect(fn) {
        fn();
        return () => {};
      },
    };

    apply(ctx);
    await flush();

    expect(injected).toHaveLength(1);
    const [slotName, registration] = injected[0];
    expect(slotName).toBe('settings.plugin.item');
    expect(registration.key).toBe('web-search-querit');
    expect(typeof calls.events['credentials/reference-updated']).toBe('function');
    expect(calls.describe).toEqual([['QUERIT_API_KEY']]);
  });

  it('reads and writes the key through remote.credentials shapes', async () => {
    const { QueritCardController } = loadBundle();
    const { calls, remote } = remoteStub();
    const controller = new QueritCardController(scopeStub(), { remote });

    await flush();
    expect(calls.describe).toEqual([['QUERIT_API_KEY']]);
    expect(controller.credential).toEqual({ ref: 'QUERIT_API_KEY', configured: true, writable: false });

    await controller.writeKey('sk-new');
    expect(calls.set).toEqual([['QUERIT_API_KEY', 'sk-new']]);
  });
});
