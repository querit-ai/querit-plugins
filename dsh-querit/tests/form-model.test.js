/**
 * Unit tests for the dsh-querit settings-form model (src/form-model.js) — the
 * exact code the browser bundle inlines at build time.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  numberField,
  textField,
  listField,
  booleanField,
  enumField,
  secretSpec,
  QueritFormModel,
  makeStore,
} from '../src/form-model.js';

/** Build a scope that mimics the host-backed SettingsScopeController (set/unset). */
function hostScope({ base = {}, user = {} } = {}) {
  let current = { value: { ...base, ...user }, base, user, revision: 1, status: 'ready', writable: true };
  const listeners = new Set();
  return {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (field, value) => {
      const nextUser = { ...current.user, [field]: value };
      current = { value: { ...current.base, ...nextUser }, base: current.base, user: nextUser, revision: current.revision + 1, status: 'ready', writable: true };
      for (const listener of listeners) listener();
    },
    unset: (field) => {
      const nextUser = { ...current.user };
      delete nextUser[field];
      current = { value: { ...current.base, ...nextUser }, base: current.base, user: nextUser, revision: current.revision + 1, status: 'ready', writable: true };
      for (const listener of listeners) listener();
    },
  };
}

describe('field conversions', () => {
  it('numberField formats numbers and parses integers, blanks clear, junk is invalid', () => {
    const spec = numberField('count');
    expect(spec.format(8)).toBe('8');
    expect(spec.format(undefined)).toBe('');
    expect(spec.parse('12')).toEqual({ kind: 'set', value: 12 });
    expect(spec.parse('  3 ')).toEqual({ kind: 'set', value: 3 });
    expect(spec.parse('')).toEqual({ kind: 'clear' });
    expect(spec.parse('abc')).toBeUndefined();
  });

  it('textField trims and clears on empty', () => {
    const spec = textField('timeRange');
    expect(spec.format('m3')).toBe('m3');
    expect(spec.parse('  m3  ')).toEqual({ kind: 'set', value: 'm3' });
    expect(spec.parse('  ')).toEqual({ kind: 'clear' });
  });

  it('listField round-trips arrays and dedupes comma lists', () => {
    const spec = listField('languages');
    expect(spec.format(['english', 'japanese'])).toBe('english, japanese');
    expect(spec.format(undefined)).toBe('');
    expect(spec.parse(' english , japanese , english ')).toEqual({ kind: 'set', value: ['english', 'japanese'] });
    expect(spec.parse('')).toEqual({ kind: 'clear' });
  });

  it('booleanField and enumField accept only their shapes', () => {
    const bool = booleanField('includeContent');
    expect(bool.parse('true')).toEqual({ kind: 'set', value: true });
    expect(bool.parse('false')).toEqual({ kind: 'set', value: false });

    const fmt = enumField('fetchFormat', ['markdown', 'text', 'html']);
    expect(fmt.format('text')).toBe('text');
    expect(fmt.parse('html')).toEqual({ kind: 'set', value: 'html' });
    expect(fmt.parse('pdf')).toBeUndefined();
    expect(fmt.parse('')).toEqual({ kind: 'clear' });
  });
});

describe('QueritFormModel', () => {
  const specs = [textField('apiKeyEnv'), numberField('count'), listField('languages'), booleanField('includeContent')];

  it('projects effective values and override presence from the user layer', () => {
    const scope = hostScope({ base: { count: 5 }, user: { count: 9 } });
    const model = new QueritFormModel(scope, specs);
    expect(model.field('count')).toEqual({ text: '9', overridden: true, invalid: false });
    expect(model.field('languages')).toEqual({ text: '', overridden: false, invalid: false });
    expect(model.shell()).toMatchObject({ available: true, writable: true, dirty: false, invalid: false });
  });

  it('stages edits and plans writes; a save lands them on the scope', async () => {
    const scope = hostScope({ base: { count: 5 } });
    const model = new QueritFormModel(scope, specs);
    const store = model.bind(() => model.shell());

    model.actions().edit('count', '12');
    expect(model.shell().dirty).toBe(true);
    expect(model.field('count')).toEqual({ text: '12', overridden: true, invalid: false });

    await model.actions().save();
    expect(scope.getSnapshot().user.count).toBe(12);
    expect(model.shell().dirty).toBe(false);
    expect(store.getSnapshot().dirty).toBe(false);
  });

  it('an invalid draft blocks the save and leaves the draft', async () => {
    const scope = hostScope({ base: { count: 5 } });
    const model = new QueritFormModel(scope, specs);
    model.actions().edit('count', 'abc');
    expect(model.shell().invalid).toBe(true);
    await model.actions().save();
    expect(scope.getSnapshot().user.count).toBeUndefined();
    expect(model.shell().dirty).toBe(true);
  });

  it('clears a stored field when the draft is emptied', async () => {
    const scope = hostScope({ user: { count: 9 } });
    const model = new QueritFormModel(scope, specs);
    model.actions().edit('count', '');
    await model.actions().save();
    expect(scope.getSnapshot().user.count).toBeUndefined();
  });

  it('reset returns the field toward the base value and clears the override on save', async () => {
    const scope = hostScope({ base: { count: 5 }, user: { count: 9 } });
    const model = new QueritFormModel(scope, specs);
    model.actions().resetField('count');
    expect(model.field('count').text).toBe('5');
    await model.actions().save();
    expect(scope.getSnapshot().user.count).toBeUndefined();
  });

  it('discard drops staged edits without writing', () => {
    const scope = hostScope({ base: { count: 5 } });
    const model = new QueritFormModel(scope, specs);
    model.actions().edit('count', '88');
    model.actions().discard();
    expect(model.shell().dirty).toBe(false);
    expect(scope.getSnapshot().user.count).toBeUndefined();
  });

  it('writes a staged secret through its writer and clears it after landing', async () => {
    const write = vi.fn().mockResolvedValue(true);
    const scope = hostScope();
    const model = new QueritFormModel(scope, [textField('apiKeyEnv')], [secretSpec('apiKey', write)]);
    model.actions().edit('apiKey', '  sk-live  ');
    await model.actions().save();
    expect(write).toHaveBeenCalledWith('sk-live');
    expect(model.shell().dirty).toBe(false);
  });

  it('skips a write for an empty secret draft', async () => {
    const write = vi.fn();
    const model = new QueritFormModel(hostScope(), [textField('apiKeyEnv')], [secretSpec('apiKey', write)]);
    model.actions().edit('apiKey', '   ');
    await model.actions().save();
    expect(write).not.toHaveBeenCalled();
  });

  it('tracks list fields as comma text in the UI', () => {
    const scope = hostScope({ user: { languages: ['english', 'korean'] } });
    const model = new QueritFormModel(scope, specs);
    expect(model.field('languages').text).toBe('english, korean');
    const store = model.bind(() => model.field('languages'));
    expect(store.getSnapshot().text).toBe('english, korean');
  });
});

describe('makeStore', () => {
  it('holds a stable snapshot and notifies subscribers on set', () => {
    const store = makeStore({ a: 1 });
    const spy = vi.fn();
    const off = store.subscribe(spy);
    expect(store.getSnapshot()).toEqual({ a: 1 });
    store.set({ a: 2 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual({ a: 2 });
    off();
    store.set({ a: 3 });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});