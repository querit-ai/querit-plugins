/**
 * Pure form model behind the dsh-querit settings card.
 *
 * This file is the SINGLE SOURCE of truth for the card's field conversions and
 * save planning. The browser bundle inlines these exact definitions (see
 * scripts/build-client.mjs); the node-side unit tests import them through the
 * exports at the bottom. Keep everything here free of DOM, React, and window
 * references so both consumers can run it.
 */

/**
 * A whole-number field. An empty draft clears the field; any other draft that
 * is not a finite number blocks the save.
 * @param {string} field - field name inside the namespace section.
 * @returns {import('./client-types.js').FieldSpec} the field's conversion spec.
 */
export function numberField(field) {
  return {
    field,
    format: (value) => (typeof value === 'number' ? String(value) : ''),
    parse: (text) => {
      const trimmed = text.trim();
      if (trimmed === '') return { kind: 'clear' };
      const parsed = Number(trimmed);
      return Number.isFinite(parsed)
        ? { kind: 'set', value: parsed }
        : undefined;
    },
  };
}

/**
 * A free-text field. An empty draft clears the field, so emptying the control
 * and saving is the same gesture as resetting it.
 * @param {string} field - field name inside the namespace section.
 * @returns {import('./client-types.js').FieldSpec} the field's conversion spec.
 */
export function textField(field) {
  return {
    field,
    format: (value) => (typeof value === 'string' ? value : ''),
    parse: (text) => {
      const trimmed = text.trim();
      return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed };
    },
  };
}

/**
 * A comma-separated list field (string[] ↔ "a, b, c"). An empty draft clears
 * the field; duplicates and blank entries are dropped.
 * @param {string} field - field name inside the namespace section.
 * @returns {import('./client-types.js').FieldSpec} the field's conversion spec.
 */
export function listField(field) {
  return {
    field,
    format: (value) => (Array.isArray(value) ? value.join(', ') : ''),
    parse: (text) => {
      const trimmed = text.trim();
      if (trimmed === '') return { kind: 'clear' };
      const seen = new Set();
      const items = [];
      for (const raw of trimmed.split(',')) {
        const item = raw.trim();
        if (item === '' || seen.has(item)) continue;
        seen.add(item);
        items.push(item);
      }
      return { kind: 'set', value: items };
    },
  };
}

/**
 * A boolean toggle field. It always writes a value; there is no "clear".
 * @param {string} field - field name inside the namespace section.
 * @returns {import('./client-types.js').FieldSpec} the field's conversion spec.
 */
export function booleanField(field) {
  return {
    field,
    format: (value) => (typeof value === 'boolean' ? String(value) : 'false'),
    parse: (text) => ({ kind: 'set', value: text === 'true' }),
    choices: ['true', 'false'],
  };
}

/**
 * A single-choice field over a fixed set of strings.
 * @param {string} field - field name inside the namespace section.
 * @param {readonly string[]} choices - acceptable values.
 * @returns {import('./client-types.js').FieldSpec} the field's conversion spec.
 */
export function enumField(field, choices) {
  return {
    field,
    format: (value) => (typeof value === 'string' && choices.includes(value) ? value : ''),
    parse: (text) => {
      const trimmed = text.trim();
      if (trimmed === '') return { kind: 'clear' };
      return choices.includes(trimmed) ? { kind: 'set', value: trimmed } : undefined;
    },
    choices,
  };
}

/**
 * A write-only control staged outside the settings section (the API key is
 * stored in the credentials domain, never in the settings document).
 * @param {string} field - field name this control stages under.
 * @param {(value: string) => Promise<boolean>} write - persist the literal.
 * @returns {import('./client-types.js').SecretSpec} the secret's spec.
 */
export function secretSpec(field, write) {
  return { field, write };
}

/**
 * The staged form model one settings card runs on.
 *
 * A card stages what the user types and writes it only when they save. Each
 * settings write is a durable, revision-fenced document mutation, so nothing
 * commits as the user types. A field shows its effective value — the user
 * layer over the composition layer over the schema default — and whether the
 * user layer carries it; that presence, not a value comparison, is what marks
 * a field overridden.
 */
export class QueritFormModel {
  /** @param {import('./client-types.js').SettingsScope} scope - bound settings scope for the namespace. */
  constructor(scope, specs, secrets = []) {
    this.scope = scope;
    this.specs = new Map(specs.map((spec) => [spec.field, spec]));
    this.secretSpecs = new Map(secrets.map((spec) => [spec.field, spec]));
    this.staged = new Map();
    this.listeners = new Set();
    this.saving = false;
    this.failed = false;
    scope.subscribe(() => this.publish());
  }

  /**
   * Publish a projection of this form rebuilt whenever the scope or a draft
   * changes.
   * @param {() => object} project - build the card's state from the form reads.
   * @returns {import('./client-types.js').SnapshotStore} the store the component reads.
   */
  bind(project) {
    const store = makeStore(project());
    this.listeners.add(() => {
      store.set(project());
    });
    return store;
  }

  /** Read the card-level state: what the Host serves, and what a save would do. */
  shell() {
    const snapshot = this.scope.getSnapshot();
    const plan = this.plan();
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable === true,
      dirty: plan.length > 0,
      invalid: plan.some((item) => item.run === undefined),
      saving: this.saving,
      failed: this.failed,
    };
  }

  /** Read one control's state. */
  field(field) {
    const staged = this.staged.get(field);
    if (this.secretSpecs.has(field)) {
      return { text: staged?.text ?? '', overridden: false, invalid: false };
    }
    const spec = this.spec(field);
    if (staged === undefined) {
      return {
        text: spec.format(this.sectionValue(field)),
        overridden: this.stored(field),
        invalid: false,
      };
    }
    const write = staged.clear ? { kind: 'clear' } : spec.parse(staged.text);
    return {
      text: staged.text,
      overridden: write?.kind === 'set',
      invalid: write === undefined,
    };
  }

  /** The actions a card's slot entry injects. */
  actions() {
    return {
      edit: (field, text) => {
        this.stage(field, { text, clear: false });
      },
      resetField: (field) => {
        if (this.secretSpecs.has(field)) return;
        this.stage(field, { text: this.spec(field).format(this.baseValue(field)), clear: true });
      },
      save: () => {
        return this.save();
      },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return;
        this.staged.clear();
        this.failed = false;
        this.publish();
      },
    };
  }

  /**
   * Write every staged edit, then re-seed from what the Host accepted. The Host
   * is the only authority on whether a value was accepted, so the outcome is
   * read back from the scope rather than predicted here.
   */
  async save() {
    const plan = this.plan();
    const writes = plan.flatMap((item) => (item.run === undefined ? [] : [item.run]));
    if (plan.length === 0 || this.saving || writes.length !== plan.length) return;
    this.saving = true;
    this.failed = false;
    this.publish();
    let landed = true;
    for (const write of writes) landed = (await write()) && landed;
    if (landed) this.staged.clear();
    this.saving = false;
    this.failed = !landed;
    this.publish();
  }

  /** Every staged edit a save would write, in the order the fields were staged. */
  plan() {
    const plan = [];
    for (const [field, staged] of this.staged) {
      const secret = this.secretSpecs.get(field);
      if (secret !== undefined) {
        const value = staged.text.trim();
        if (value !== '') {
          plan.push({ field, run: () => secret.write(value).then((ok) => !!ok) });
        }
        continue;
      }
      const spec = this.spec(field);
      if (staged.clear) {
        if (this.stored(field)) plan.push({ field, run: () => this.clear(field) });
        continue;
      }
      if (staged.text === spec.format(this.sectionValue(field))) continue;
      const write = spec.parse(staged.text);
      if (write === undefined) plan.push({ field, run: undefined });
      else if (write.kind === 'clear') plan.push({ field, run: () => this.clear(field) });
      else plan.push({ field, run: () => this.store(field, write.value) });
    }
    return plan;
  }

  stage(field, draft) {
    this.staged.set(field, draft);
    this.publish();
  }

  publish() {
    for (const listener of this.listeners) listener();
  }

  spec(field) {
    const spec = this.specs.get(field);
    if (spec === undefined) throw new Error(`querit card: unknown field "${field}"`);
    return spec;
  }

  sectionValue(field) {
    return this.scope.getSnapshot().value?.[field];
  }

  stored(field) {
    const user = this.scope.getSnapshot().user;
    return typeof user === 'object' && user !== null && Object.prototype.hasOwnProperty.call(user, field);
  }

  baseValue(field) {
    return this.scope.getSnapshot().base?.[field];
  }

  clear(field) {
    return this.scope.unset(field);
  }

  store(field, value) {
    return this.scope.set(field, value);
  }
}

/** Minimal snapshot store: stable state object, getSnapshot, subscribe, set. */
export function makeStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next) => {
      state = next;
      for (const listener of listeners) listener();
    },
  };
}