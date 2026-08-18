/**
 * dsh-querit browser bundle — Querit settings card.
 *
 * Built by scripts/build-client.mjs into lib/card.js (do not edit the
 * generated file). The browser loader wraps this module; the node-side unit
 * tests cover the form model definitions in src/form-model.js, which this
 * bundle inlines below.
 *
 * Plain JavaScript only: no TS, no JSX, no imports — `require` resolves
 * against the browser module loader, and React comes from the shared kernel.
 */
(function (root, factory) {
  if (root && typeof root.__ModuleLoader__ === 'object' && typeof root.__ModuleLoader__.load === 'function') {
    root.__ModuleLoader__.load({ id: 'dsh-querit', factory: factory });
    return;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (require) {
  'use strict';
  var module = { exports: {} };
  var exports = module.exports;
  var React = require('react');

  /* __DSH_QUERIT_FORM_MODEL__ */

  var NS = 'dsh-querit';
  var NAMESPACE = 'web-search-querit';
  var DEFAULT_API_KEY_REF = 'QUERIT_API_KEY';
  var FETCH_FORMATS = ['markdown', 'text', 'html'];

  /* Card styles: scoped classes over the theme's alias tokens. */
  (function injectCardCss() {
    if (typeof document === 'undefined') return;
    var tagId = NS + '/card.css';
    if (document.querySelector('style[data-plugin-css="' + tagId + '"]') !== null) return;
    var css = [
      '.qr-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}',
      '.qr-header{display:flex;align-items:center;gap:8px;width:100%;padding:12px 16px;background:none;border:0;cursor:pointer;color:inherit;font:inherit;text-align:left}',
      '.qr-head{flex:1;min-width:0}',
      '.qr-name{display:block;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:1.5}',
      '.qr-desc{display:block;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}',
      '.qr-badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px}',
      '.qr-chev{color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:1}',
      '.qr-body{border-top:1px solid var(--dsw-alias-border-l2);padding:0 16px 12px}',
      '.qr-readonly{color:var(--dsw-alias-label-tertiary);margin:8px 0 0;font-size:12px}',
      '.qr-field{display:flex;flex-direction:column;gap:6px;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.qr-field:last-child{border-bottom:0}',
      '.qr-fhead{display:flex;align-items:center;gap:8px}',
      '.qr-grow{flex:1}',
      '.qr-label{flex:1;min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5}',
      '.qr-tag{white-space:nowrap;color:var(--dsw-alias-label-tertiary);border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px}',
      '.qr-tagOver{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px}',
      '.qr-reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:none;border:none;padding:0;font-size:12px;line-height:1.5}',
      '.qr-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
      '.qr-reset:disabled{cursor:default}',
      '.qr-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5;box-sizing:border-box}',
      '.qr-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}',
      '.qr-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}',
      '.qr-check{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary);cursor:pointer;flex:none}',
      '.qr-check:disabled{cursor:default}',
      '.qr-invalid{border-color:var(--dsw-alias-label-error)}',
      '.qr-err{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}',
      '.qr-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}',
      '.qr-keybadge{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}',
      '.qr-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding-top:12px}',
      '.qr-failed{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5;flex:1}',
      '.qr-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 14px;font:inherit;font-size:13px;cursor:pointer}',
      '.qr-btn:hover:not(:disabled){border-color:var(--dsw-alias-label-secondary)}',
      '.qr-save{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-weight:600}',
      '.qr-btn:disabled{opacity:.5;cursor:default}'
    ].join('');
    var tag = document.createElement('style');
    tag.dataset.plugin = NS;
    tag.dataset.pluginCss = tagId;
    tag.textContent = css;
    document.head.appendChild(tag);
  })();

  var en = {
    title: 'Querit web search',
    description: 'Querit-backed search and fetch provider.',
    readOnly: 'This deployment stores settings read-only.',
    pass: 'Password',
    save: 'Save',
    saving: 'Saving\u2026',
    discard: 'Discard',
    unsaved: 'Unsaved',
    overridden: 'Overridden',
    reset: 'Reset to default',
    saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
    invalidNumber: 'Enter a number, or leave blank to use the default.',
    keyLabel: 'API key',
    keyHint: 'Stored outside the settings file. Leave blank to keep the current key.',
    keySet: 'A key is configured for',
    keyUnset: 'No key is configured; search fails until one is set via the credentials file or here.',
    refLabel: 'Credential reference',
    refHint: 'Environment variable / credentials-store name the provider resolves per call.',
    countLabel: 'Result count',
    countHint: 'Results per search when no explicit bound is given (1\u201320).',
    timeRangeLabel: 'Time range',
    timeRangeHint: 'Relative (d7, w2, m3, y1, \u2026) or YYYY-MM-DDtoYYYY-MM-DD.',
    languagesLabel: 'Languages',
    languagesHint: 'Comma-separated: english, japanese, korean, german, french, spanish, portuguese.',
    countriesLabel: 'Countries',
    countriesHint: 'Comma-separated country bias (argentina, australia, brazil, \u2026).',
    includeLabel: 'Include domains',
    includeHint: 'Whitelist hostnames; only these domains return results.',
    excludeLabel: 'Exclude domains',
    excludeHint: 'Blacklist hostnames; these domains never return results.',
    contentLabel: 'Include content excerpts',
    contentHint: 'Request sentence-level content excerpts alongside snippets.',
    formatLabel: 'Fetch format',
    formatHint: 'Format requested from /v1/contents for fetch calls.'
  };
  var zh = {
    title: 'Querit 网页搜索',
    description: '基于 Querit 的搜索与抓取提供方。',
    readOnly: '本部署的设置为只读。',
    pass: '密码',
    save: '保存',
    saving: '保存中\u2026',
    discard: '放弃修改',
    unsaved: '未保存',
    overridden: '已覆盖',
    reset: '恢复默认',
    saveFailed: '本部署没有接受这些值，已保留供你修改。',
    invalidNumber: '请填数字；留空表示使用默认值。',
    keyLabel: 'API Key',
    keyHint: '不写入设置文件。留空表示保持当前密钥。',
    keySet: '已为',
    keyUnset: '未配置密钥；请在凭据文件或此处配置后搜索才可用。',
    refLabel: '凭据引用名',
    refHint: '每次调用解析的环境变量 / 凭据存储键名。',
    countLabel: '结果数量',
    countHint: '未指定上限时每次搜索返回的结果数（1–20）。',
    timeRangeLabel: '时间范围',
    timeRangeHint: '相对（d7、w2、m3、y1…）或 YYYY-MM-DDtoYYYY-MM-DD。',
    languagesLabel: '语言',
    languagesHint: '逗号分隔：english、japanese、korean、german、french、spanish、portuguese。',
    countriesLabel: '国家',
    countriesHint: '逗号分隔的国家偏好（argentina、australia、brazil…）。',
    includeLabel: '仅限域名',
    includeHint: '白名单主机名；只返回这些域的结果。',
    excludeLabel: '排除域名',
    excludeHint: '黑名单主机名；这些域永不返回结果。',
    contentLabel: '包含内容摘要',
    contentHint: '在摘要旁请求句子级内容摘录。',
    formatLabel: '抓取格式',
    formatHint: '/v1/contents 抓取请求的格式。'
  };

  /** The credential reference the section names, or the provider default. */
  function refOf(snapshot) {
    var declared = snapshot.value && snapshot.value.apiKeyEnv;
    return declared !== undefined && declared.length > 0 ? declared : DEFAULT_API_KEY_REF;
  }

  /** Bridges the web-search-querit scope and the credentials domain onto the card. */
  function QueritCardController(scope, api) {
    this.scope = scope;
    this.api = api;
    this.credential = { ref: '', configured: false, writable: true };
    this.form = new QueritFormModel(
      scope,
      [
        textField('apiKeyEnv'),
        numberField('count'),
        textField('timeRange'),
        listField('languages'),
        listField('countries'),
        listField('includeDomains'),
        listField('excludeDomains'),
        booleanField('includeContent'),
        enumField('fetchFormat', FETCH_FORMATS)
      ],
      [secretSpec('apiKey', (value) => this.writeKey(value))]
    );
    this.store = this.form.bind(() => this.projection());
    var self = this;
    scope.subscribe(() => {
      self.readCredential();
    });
    this.readCredential();
  }

  QueritCardController.prototype.projection = function () {
    return {
      ...this.form.shell(),
      apiKeyEnv: this.form.field('apiKeyEnv'),
      count: this.form.field('count'),
      timeRange: this.form.field('timeRange'),
      languages: this.form.field('languages'),
      countries: this.form.field('countries'),
      includeDomains: this.form.field('includeDomains'),
      excludeDomains: this.form.field('excludeDomains'),
      includeContent: this.form.field('includeContent'),
      fetchFormat: this.form.field('fetchFormat'),
      apiKey: this.form.field('apiKey'),
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable,
      apiKeyRef: this.credential.ref
    };
  };

  QueritCardController.prototype.readCredential = function () {
    var self = this;
    var ref = refOf(this.scope.getSnapshot());
    if (ref !== this.credential.ref) {
      this.credential = { ref: ref, configured: false, writable: true };
      this.store.set(this.projection());
    }
    this.api.credentials
      .describe({ refs: [ref] })
      .then(function (response) {
        if (!response || !response.result || !response.result.ok) return;
        if (ref !== refOf(self.scope.getSnapshot())) return;
        var view = response.result.value.credentials[ref];
        var next = {
          ref: ref,
          configured: view && view.configured === true,
          writable: !view || view.writable !== false
        };
        if (next.configured === self.credential.configured && next.writable === self.credential.writable) return;
        self.credential = next;
        self.store.set(self.projection());
      })
      .catch(function () {});
  };

  QueritCardController.prototype.refreshCredential = function (ref) {
    if (ref !== this.credential.ref) return;
    this.readCredential();
  };

  QueritCardController.prototype.writeKey = function (value) {
    var self = this;
    return this.api.credentials
      .set({ ref: refOf(this.scope.getSnapshot()), value: value })
      .then(function () {
        return self.readCredential();
      })
      .catch(function () {
        return self.readCredential();
      })
      .then(function () {
        return self.credential.configured;
      });
  };

  QueritCardController.prototype.inject = function () {
    return {
      hooks: { queritCard: this.store },
      ...this.form.actions()
    };
  };

  /** One labeled control row. `inline` puts the control on the label line (toggle rows). */
  function FieldRow(props) {
    var inline = props.inline === true;
    return React.createElement(
      'div',
      { className: 'qr-field' },
      React.createElement(
        'div',
        { className: 'qr-fhead' },
        React.createElement('span', { className: 'qr-label' }, props.label),
        props.state && props.state.overridden
          ? React.createElement('span', { className: 'qr-tagOver' }, props.overriddenLabel)
          : null,
        props.state && props.onReset
          ? React.createElement(
              'button',
              { type: 'button', className: 'qr-reset', disabled: props.disabled || !props.state.overridden, onClick: props.onReset },
              props.resetLabel
            )
          : null,
        inline ? React.createElement('span', { className: 'qr-grow' }) : null,
        inline ? props.children : null
      ),
      inline ? null : props.children,
      props.state && props.state.invalid ? React.createElement('p', { className: 'qr-err' }, props.invalidLabel) : null,
      props.hint ? React.createElement('p', { className: 'qr-hint' }, props.hint) : null
    );
  }

  /** Render one plugin card: header naming the provider, disclosing its controls in place. */
  function QueritCard(props) {
    var t = props.t || function (key) {
      return zh[key] || en[key] || key;
    };
    var state = props.useQueritCard(function (snapshot) {
      return snapshot;
    });
    var openState = React.useState(props.defaultOpen === true);
    var open = openState[0];
    var setOpen = openState[1];
    if (!state.available) return null;
    var disabled = !state.writable;
    var blocked = !state.dirty || state.invalid || state.saving;
    var text = function (control) {
      return control.text;
    };
    return React.createElement(
      'li',
      { className: 'qr-card' + (open ? ' qr-open' : '') },
      React.createElement(
        'button',
        { type: 'button', className: 'qr-header', 'aria-expanded': open ? 'true' : 'false', onClick: function () { setOpen(!open); } },
        React.createElement(
          'span',
          { className: 'qr-head' },
          React.createElement('span', { className: 'qr-name' }, t('title')),
          React.createElement('span', { className: 'qr-desc' }, t('description'))
        ),
        state.dirty ? React.createElement('span', { className: 'qr-badge' }, t('unsaved')) : null,
        React.createElement('span', { className: 'qr-chev' }, open ? '\u2212' : '+')
      ),
      open
        ? React.createElement(
            'div',
            { className: 'qr-body' },
            disabled ? React.createElement('p', { className: 'qr-readonly' }, t('readOnly')) : null,
            React.createElement(
              FieldRow,
              {
                label: t('keyLabel'),
                hint: t('keyHint'),
                state: state.apiKey,
                disabled: disabled || !state.apiKeyWritable,
                invalidLabel: t('invalidNumber')
              },
              React.createElement('input', {
                className: 'qr-input',
                type: 'password',
                autoComplete: 'new-password',
                disabled: disabled || !state.apiKeyWritable,
                placeholder: state.apiKeyConfigured ? '\u2022\u2022\u2022\u2022\u2022\u2022' : '',
                value: text(state.apiKey),
                onChange: function (event) { props.edit('apiKey', event.target.value); }
              })
            ),
            React.createElement(
              'p',
              { className: 'qr-keybadge' },
              state.apiKeyConfigured ? t('keySet') + ' ' + state.apiKeyRef + '.' : t('keyUnset')
            ),
            field(
              props,
              t('refLabel'),
              t('refHint'),
              state.apiKeyEnv,
              'apiKeyEnv',
              disabled
            ),
            field(props, t('countLabel'), t('countHint'), state.count, 'count', disabled),
            field(props, t('timeRangeLabel'), t('timeRangeHint'), state.timeRange, 'timeRange', disabled),
            field(props, t('languagesLabel'), t('languagesHint'), state.languages, 'languages', disabled),
            field(props, t('countriesLabel'), t('countriesHint'), state.countries, 'countries', disabled),
            field(props, t('includeLabel'), t('includeHint'), state.includeDomains, 'includeDomains', disabled),
            field(props, t('excludeLabel'), t('excludeHint'), state.excludeDomains, 'excludeDomains', disabled),
            React.createElement(
              FieldRow,
              {
                label: t('contentLabel'),
                hint: t('contentHint'),
                state: state.includeContent,
                disabled: disabled,
                inline: true,
                overriddenLabel: t('overridden'),
                resetLabel: t('reset'),
                onReset: function () { props.resetField('includeContent'); }
              },
              React.createElement('input', {
                className: 'qr-check',
                type: 'checkbox',
                disabled: disabled,
                checked: state.includeContent.text === 'true',
                onChange: function (event) { props.edit('includeContent', event.target.checked ? 'true' : 'false'); }
              })
            ),
            React.createElement(
              FieldRow,
              {
                label: t('formatLabel'),
                hint: t('formatHint'),
                state: state.fetchFormat,
                disabled: disabled,
                overriddenLabel: t('overridden'),
                resetLabel: t('reset'),
                onReset: function () { props.resetField('fetchFormat'); }
              },
              React.createElement(
                'select',
                {
                  className: 'qr-input',
                  disabled: disabled,
                  value: text(state.fetchFormat),
                  onChange: function (event) { props.edit('fetchFormat', event.target.value); }
                },
                FETCH_FORMATS.map(function (format) {
                  return React.createElement('option', { key: format, value: format }, format);
                })
              )
            ),
            React.createElement(
              'div',
              { className: 'qr-foot' },
              state.failed ? React.createElement('p', { className: 'qr-failed' }, t('saveFailed')) : null,
              React.createElement(
                'button',
                { type: 'button', className: 'qr-btn', disabled: (!state.dirty && !state.failed) || state.saving, onClick: props.discard },
                t('discard')
              ),
              React.createElement(
                'button',
                { type: 'button', className: 'qr-btn qr-save', disabled: blocked, onClick: props.save },
                t(state.saving ? 'saving' : 'save')
              )
            )
          )
        : null
    );
  }

  /** Extract one section field's row into a shared control render. */
  function field(props, label, hint, state, name, disabled) {
    return React.createElement(
      FieldRow,
      {
        label: label,
        hint: hint,
        state: state,
        disabled: disabled,
        invalidLabel: name === 'count' ? props.t('invalidNumber') : '',
        overriddenLabel: props.t('overridden'),
        resetLabel: props.t('reset'),
        onReset: function () { props.resetField(name); }
      },
      React.createElement('input', {
        className: 'qr-input' + (state.invalid ? ' qr-invalid' : ''),
        type: name === 'count' ? 'number' : 'text',
        disabled: disabled,
        value: state.text,
        onChange: function (event) { props.edit(name, event.target.value); }
      })
    );
  }

  /** Required services (cordis fiber inject). */
  var inject = ['slots', 'connection', 'settingsScope', 'remote', 'locale'];

  /**
   * Mount the Querit settings card into the plugins configuration tab.
   * @param ctx - the browser plugin context.
   */
  function apply(ctx) {
    var slots = ctx.get('slots');
    var scopeService = ctx.get('settingsScope');
    var locale = ctx.get('locale');
    var api = ctx.get('connection');
    if (slots === undefined || scopeService === undefined || locale === undefined || api === undefined) return;
    api = api.api;
    // Register the card dictionaries, then bind our own translator. The slot
    // framework may also deliver a `t` seat from the entry's `locale` option,
    // but binding here guarantees text resolves even if that seat is not yet
    // backed for this entry.
    var dicts = { zh: zh, en: en };
    ctx.effect(function () {
      return locale.register(NS, dicts);
    }, 'dsh-querit: card dictionaries');
    var t = locale.bind(NS);
    var scope = scopeService.bind({ namespace: NAMESPACE });
    var controller = new QueritCardController(scope, api);
    var remote = ctx.get('remote');
    if (remote !== undefined) {
      ctx.effect(function () {
        return remote.$on('credentials/updated', function (ref) {
          controller.refreshCredential(ref);
        });
      }, 'dsh-querit: credential invalidations');
    }
    slots.inject('settings.plugin.item', function () {
      return slots.register(
        {
          name: 'settings.plugin.item',
          key: NAMESPACE,
          locale: NS,
          inject: function () {
            var face = controller.inject();
            face.t = t;
            return face;
          }
        },
        QueritCard
      );
    });
  }

  exports.apply = apply;
  exports.inject = inject;
  exports.QueritCardController = QueritCardController;
  exports.QueritCard = QueritCard;
  return module.exports;
});