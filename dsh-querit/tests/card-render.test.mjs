/**
 * Render-level smoke tests for the built browser bundle (lib/card.js).
 *
 * The bundle is a loader-wrapped script, so it is executed inside a vm
 * sandbox that provides `module`/`exports`/`require` (mirroring the browser
 * loader contract); the exported row-configuration component is then rendered
 * with react-dom/server to assert the page actually draws its controls.
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

const control = (text, overridden = false) => ({ text, overridden, invalid: false });

/** A ready, writable projection as the page component would receive it. */
function snapshot(over = {}) {
  return {
    available: true,
    writable: true,
    dirty: false,
    invalid: false,
    saving: false,
    failed: false,
    apiKeyEnv: control('QUERIT_API_KEY', true),
    count: control(''),
    timeRange: control(''),
    languages: control(''),
    countries: control(''),
    includeDomains: control(''),
    excludeDomains: control(''),
    includeContent: control('false'),
    contentMaxChars: control(''),
    highlights: control('false'),
    needMarkdown: control('false'),
    rank: control(''),
    vertical: control(''),
    resourceTags: control(''),
    chunksPerDoc: control(''),
    fetchFormat: control('markdown'),
    apiKey: control(''),
    apiKeyConfigured: false,
    apiKeyWritable: true,
    apiKeyRef: 'QUERIT_API_KEY',
    ...over,
  };
}

function render(view, snap) {
  const { QueritRowConfig } = loadBundle();
  return renderToStaticMarkup(
    React.createElement(QueritRowConfig, {
      view,
      t: (key) => key,
      useQueritCard: (select) => select(snap),
      edit: () => {},
      resetField: () => {},
      save: () => {},
      discard: () => {},
    }),
  );
}

describe('QueritRowConfig rendering (built bundle)', () => {
  it('renders a one-liner in the summary view', () => {
    const html = render('summary', snapshot());
    expect(html).toBe('<span>summary</span>');
  });

  it('draws a control for every section field', () => {
    const html = render('page', snapshot());
    const inputs = html.match(/class="qr-input/g) ?? [];
    const toggles = html.match(/class="qr-check"/g) ?? [];
    // Ten text/number inputs, the key, and the three dropdowns.
    expect(inputs.length).toBe(14);
    expect(toggles.length).toBe(3);
    for (const label of [
      'countLabel', 'timeRangeLabel', 'languagesLabel', 'countriesLabel', 'includeLabel', 'excludeLabel',
      'contentLabel', 'contentMaxCharsLabel', 'highlightsLabel', 'markdownLabel', 'rankLabel', 'verticalLabel',
      'resourceTagsLabel', 'chunksLabel', 'formatLabel', 'keyLabel', 'refLabel',
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('type="password"');
    expect(html).toContain('useDefault');
    expect(html).toContain('value="freshness"');
    expect(html).toContain('value="finance"');
  });

  it('renders nothing while the namespace is unavailable', () => {
    expect(render('page', snapshot({ available: false }))).toBe('');
  });

  it('keeps controls enabled in a writable deployment', () => {
    const numberTag = render('page', snapshot({ count: control('5') })).match(/<input[^>]*type="number"[^>]*>/)?.[0] ?? '';
    expect(numberTag).toContain('value="5"');
    expect(numberTag).not.toContain('disabled');
  });

  it('disables controls in a read-only deployment', () => {
    const html = render('page', snapshot({ writable: false }));
    const numberTag = html.match(/<input[^>]*type="number"[^>]*>/)?.[0] ?? '';
    expect(numberTag).toContain('disabled');
    expect(html).toContain('readOnly');
  });

  it('enables save only when the form is dirty', () => {
    const saveTag = (html) => html.match(/<button[^>]*class="qr-btn qr-save"[^>]*>/)?.[0] ?? '';
    expect(saveTag(render('page', snapshot()))).toContain('disabled');
    expect(saveTag(render('page', snapshot({ dirty: true, invalid: false })))).not.toContain('disabled');
  });
});

/**
 * Wiring tests for the browser half: `apply` must mount the row page through
 * the client seams dsh 0.2 provides (`configForms`, `plugins.row.config`,
 * `remote.credentials`), and the controller must unwrap their response shapes.
 */

/** Let promise chains inside the vm bundle settle before asserting. */
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

/** A ready, writable config form over an in-memory section (the `ConfigForm` shape). */
function formStub(section = { apiKeyEnv: 'QUERIT_API_KEY' }) {
  let snapshot = { status: 'ready', value: section, base: {}, user: {}, revision: 1, writable: true };
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
      return true;
    },
    async unset(field) {
      const value = { ...snapshot.value };
      delete value[field];
      snapshot = { ...snapshot, value };
      notify();
      return true;
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
  it('declares the 0.2 client services and mounts the plugins.row.config slot', async () => {
    const { apply, inject, ROW_CONFIG_KEY } = loadBundle();
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.credentials', 'configForms']);
    expect(ROW_CONFIG_KEY).toBe('dsh-querit#web-search-querit');

    const { calls, remote } = remoteStub();
    const injected = [];
    const served = [];
    const form = formStub();
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
      configForms: {
        get: (namespace) => (namespace === 'web-search-querit' ? form : undefined),
        whileServed(namespaces, register) {
          served.push(namespaces);
          return register();
        },
      },
      remote,
    };
    const ctx = {
      get: (name) => services[name],
      slots: services.slots,
      remote,
      effect(fn) {
        fn();
        return () => {};
      },
    };

    apply(ctx);
    await flush();

    expect(served).toEqual([['web-search-querit']]);
    expect(injected).toHaveLength(1);
    const [slotName, registration] = injected[0];
    expect(slotName).toBe('plugins.row.config');
    expect(registration).toMatchObject({ name: 'plugins.row.config', key: 'dsh-querit#web-search-querit', locale: 'dsh-querit' });
    expect(registration.inject().edit('count', '5')).toBeUndefined();
    expect(typeof calls.events['credentials/reference-updated']).toBe('function');
    expect(calls.describe).toEqual([['QUERIT_API_KEY']]);
  });

  it('stays inert without the configForms service', () => {
    const { apply } = loadBundle();
    const injected = [];
    const services = {
      slots: { inject: (name) => injected.push(name), register: () => ({}) },
      locale: { register: () => () => {}, bind: () => (key) => key },
    };
    apply({ get: (name) => services[name], effect: (fn) => fn() });
    expect(injected).toEqual([]);
  });

  it('reads and writes the key through remote.credentials shapes', async () => {
    const { QueritCardController } = loadBundle();
    const { calls, remote } = remoteStub();
    const form = formStub();
    const controller = new QueritCardController(form, { remote });

    await flush();
    expect(calls.describe).toEqual([['QUERIT_API_KEY']]);
    expect(controller.credential).toEqual({ ref: 'QUERIT_API_KEY', configured: true, writable: false });

    await controller.writeKey('sk-new');
    expect(calls.set).toEqual([['QUERIT_API_KEY', 'sk-new']]);

    controller.dispose();
    expect(controller.store.getSnapshot().available).toBe(true);
  });

  it('saves the newer fields through the config form', async () => {
    const { QueritCardController } = loadBundle();
    const { remote } = remoteStub();
    const form = formStub();
    const controller = new QueritCardController(form, { remote });
    const actions = controller.inject();

    actions.edit('highlights', 'true');
    actions.edit('rank', 'freshness');
    actions.edit('count', '50');
    actions.edit('vertical', 'code');
    await actions.save();

    expect(form.getSnapshot().value).toEqual({
      apiKeyEnv: 'QUERIT_API_KEY',
      count: 50,
      highlights: true,
      rank: 'freshness',
      vertical: 'code',
    });
    // A blank dropdown clears the field back to the composition layer.
    actions.edit('rank', '');
    await actions.save();
    expect(form.getSnapshot().value).not.toHaveProperty('rank');
  });
});
