/**
 * dsh-querit browser bundle — the Querit row's configuration page.
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
  /** The plugin entry id: its config form is what this page edits. */
  var NAMESPACE = 'web-search-querit';
  /** `plugins.row.config` key: `<package name>#<row id>`, both as the bundle patch declares them. */
  var ROW_CONFIG_KEY = NS + '#' + NAMESPACE;
  var DEFAULT_API_KEY_REF = 'QUERIT_API_KEY';
  var FETCH_FORMATS = ['markdown', 'text', 'html'];
  var RANK_VALUES = ['relevance', 'freshness'];
  var VERTICAL_VALUES = ['code', 'finance'];

  /* Page styles: scoped classes over the theme's alias tokens. */
  (function injectCardCss() {
    if (typeof document === 'undefined') return;
    var tagId = NS + '/page.css';
    if (document.querySelector('style[data-plugin-css="' + tagId + '"]') !== null) return;
    var css = [
      '.qr-page{display:flex;flex-direction:column}',
      '.qr-readonly{color:var(--dsw-alias-label-tertiary);margin:0 0 4px;font-size:12px;line-height:1.5}',
      '.qr-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}',
      '.qr-field+.qr-field{border-top:1px solid var(--dsw-alias-border-l2)}',
      '.qr-fhead{display:flex;align-items:center;gap:8px}',
      '.qr-label{flex:1;min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5}',
      '.qr-badges{align-items:center;gap:8px;display:inline-flex}',
      '.qr-tagOver{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}',
      '.qr-reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}',
      '.qr-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
      '.qr-reset:disabled{cursor:default}',
      '.qr-input{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5;box-sizing:border-box}',
      '.qr-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}',
      '.qr-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}',
      '.qr-input-invalid{border-color:var(--dsw-alias-label-error)}',
      '.qr-check{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary);cursor:pointer;flex:none}',
      '.qr-check:disabled{cursor:default}',
      '.qr-invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}',
      '.qr-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}',
      '.qr-foot{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}',
      '.qr-failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}',
      '.qr-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}',
      '.qr-discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:transparent}',
      '.qr-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}',
      '.qr-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}',
      '.qr-btn:disabled{opacity:.4;cursor:default}',
      '.qr-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}'
    ].join('');
    var tag = document.createElement('style');
    tag.dataset.plugin = NS;
    tag.dataset.pluginCss = tagId;
    tag.textContent = css;
    document.head.appendChild(tag);
  })();

  var en = {
    summary: 'Querit web search and page fetch. Configure the API key, result count, and search filters.',
    loading: 'Loading settings\u2026',
    readOnly: 'This deployment stores settings read-only.',
    pass: 'Password',
    save: 'Save',
    saving: 'Saving\u2026',
    discard: 'Discard',
    overridden: 'Overridden',
    reset: 'Reset to default',
    useDefault: 'Default (not set)',
    saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
    invalidNumber: 'Enter a whole number, or leave blank to use the default.',
    keyLabel: 'API key',
    keyHint: 'Stored outside the settings file. Leave blank to keep the current key.',
    keySet: 'A key is configured for',
    keyUnset: 'No key is configured; search fails until one is set here or in the credentials store.',
    refLabel: 'Credential reference',
    refHint: 'Credentials-store name the provider resolves per call.',
    countLabel: 'Result count',
    countHint: 'Results per search when no explicit bound is given (1\u2013100). Blank leaves the choice to Querit.',
    timeRangeLabel: 'Time range',
    timeRangeHint: 'Relative (d7, w2, m3, y1, \u2026) or YYYY-MM-DDtoYYYY-MM-DD.',
    languagesLabel: 'Languages',
    languagesHint: 'Comma-separated: english, japanese, korean, german, french, spanish, portuguese, russian.',
    countriesLabel: 'Countries',
    countriesHint: 'Comma-separated country bias (argentina, australia, brazil, \u2026).',
    includeLabel: 'Include domains',
    includeHint: 'Whitelist hostnames; only these domains return results.',
    excludeLabel: 'Exclude domains',
    excludeHint: 'Blacklist hostnames; these domains never return results.',
    contentLabel: 'Include body text',
    contentHint: 'Request sentence-level body text alongside snippets. Billed per page.',
    contentMaxCharsLabel: 'Body text limit',
    contentMaxCharsHint: 'Characters of body text per result (1\u20131000000). Blank returns everything.',
    highlightsLabel: 'Highlights',
    highlightsHint: 'Ask Querit for the passages of each page that match the query, instead of whole pages.',
    markdownLabel: 'Markdown body',
    markdownHint: 'Enterprise plans only: return the snippet and body as Markdown.',
    rankLabel: 'Ranking preference',
    rankHint: 'A nudge on Querit\u2019s default ranking, not a sort. Not supported by the code vertical.',
    verticalLabel: 'Vertical',
    verticalHint: 'Route every search to a vertical data source. A mismatched vertical loses results, so leave unset unless this profile only asks code or finance questions.',
    resourceTagsLabel: 'Vertical sub-tags',
    resourceTagsHint: 'Code vertical only, comma-separated: qa, github. Blank searches the whole vertical.',
    chunksLabel: 'Chunks per document (deprecated)',
    chunksHint: 'Deprecated by Querit; prefer highlights. Blank sends nothing.',
    formatLabel: 'Fetch format',
    formatHint: 'Format requested from /v1/contents for fetch calls.'
  };
  var zh = {
    summary: 'Querit 网页搜索与网页抓取。配置 API Key、结果数量与搜索过滤条件。',
    loading: '正在加载设置\u2026',
    readOnly: '本部署的设置为只读。',
    pass: '密码',
    save: '保存',
    saving: '保存中\u2026',
    discard: '放弃修改',
    overridden: '已覆盖',
    reset: '恢复默认',
    useDefault: '默认（不设置）',
    saveFailed: '本部署没有接受这些值，已保留供你修改。',
    invalidNumber: '请填整数；留空表示使用默认值。',
    keyLabel: 'API Key',
    keyHint: '不写入设置文件。留空表示保持当前密钥。',
    keySet: '已为',
    keyUnset: '未配置密钥；请在此处或凭据存储中配置后搜索才可用。',
    refLabel: '凭据引用名',
    refHint: '每次调用解析的凭据存储键名。',
    countLabel: '结果数量',
    countHint: '未指定上限时每次搜索返回的结果数（1–100）。留空表示由 Querit 决定。',
    timeRangeLabel: '时间范围',
    timeRangeHint: '相对（d7、w2、m3、y1…）或 YYYY-MM-DDtoYYYY-MM-DD。',
    languagesLabel: '语言',
    languagesHint: '逗号分隔：english、japanese、korean、german、french、spanish、portuguese、russian。',
    countriesLabel: '国家',
    countriesHint: '逗号分隔的国家偏好（argentina、australia、brazil…）。',
    includeLabel: '仅限域名',
    includeHint: '白名单主机名；只返回这些域的结果。',
    excludeLabel: '排除域名',
    excludeHint: '黑名单主机名；这些域永不返回结果。',
    contentLabel: '包含正文',
    contentHint: '在摘要旁请求句子级正文。按页计费。',
    contentMaxCharsLabel: '正文长度上限',
    contentMaxCharsHint: '每条结果返回的正文字符数（1–1000000）。留空返回全部。',
    highlightsLabel: '高亮片段',
    highlightsHint: '让 Querit 只返回每个页面中与查询相关的段落，而不是整页。',
    markdownLabel: 'Markdown 正文',
    markdownHint: '仅企业版：以 Markdown 返回摘要与正文。',
    rankLabel: '排序偏好',
    rankHint: '在 Querit 默认排序之上的微调，并非严格排序。代码垂直搜索不支持。',
    verticalLabel: '垂直搜索',
    verticalHint: '把每次搜索都路由到垂直数据源。类型不匹配会丢失结果，除非本配置只问代码或金融问题，否则请留空。',
    resourceTagsLabel: '垂直子标签',
    resourceTagsHint: '仅代码垂直搜索，逗号分隔：qa、github。留空搜索整个垂直。',
    chunksLabel: '每文档分块数（已废弃）',
    chunksHint: 'Querit 已废弃，请改用高亮片段。留空则不发送。',
    formatLabel: '抓取格式',
    formatHint: '/v1/contents 抓取请求的格式。'
  };

  /** The credential reference the section names, or the provider default. */
  function refOf(snapshot) {
    var declared = snapshot.value && snapshot.value.apiKeyEnv;
    return declared !== undefined && declared.length > 0 ? declared : DEFAULT_API_KEY_REF;
  }

  /** Bridges the entry's config form and the credentials domain onto the page. */
  function QueritCardController(form, ctx) {
    this.ctx = ctx;
    this.credential = { ref: '', configured: false, writable: true };
    this.form = new QueritFormModel(
      form,
      [
        textField('apiKeyEnv'),
        numberField('count'),
        textField('timeRange'),
        listField('languages'),
        listField('countries'),
        listField('includeDomains'),
        listField('excludeDomains'),
        booleanField('includeContent'),
        numberField('contentMaxChars'),
        booleanField('highlights'),
        booleanField('needMarkdown'),
        enumField('rank', RANK_VALUES),
        enumField('vertical', VERTICAL_VALUES),
        listField('resourceTags'),
        numberField('chunksPerDoc'),
        enumField('fetchFormat', FETCH_FORMATS)
      ],
      [secretSpec('apiKey', (value) => this.writeKey(value))]
    );
    this.store = this.form.bind(() => this.projection());
    this.unsubscribe = form.subscribe(() => {
      this.readCredential();
    });
    this.readCredential();
  }

  QueritCardController.prototype.dispose = function () {
    this.unsubscribe();
    this.form.dispose();
  };

  QueritCardController.prototype.projection = function () {
    var field = (name) => this.form.field(name);
    return {
      ...this.form.shell(),
      apiKeyEnv: field('apiKeyEnv'),
      count: field('count'),
      timeRange: field('timeRange'),
      languages: field('languages'),
      countries: field('countries'),
      includeDomains: field('includeDomains'),
      excludeDomains: field('excludeDomains'),
      includeContent: field('includeContent'),
      contentMaxChars: field('contentMaxChars'),
      highlights: field('highlights'),
      needMarkdown: field('needMarkdown'),
      rank: field('rank'),
      vertical: field('vertical'),
      resourceTags: field('resourceTags'),
      chunksPerDoc: field('chunksPerDoc'),
      fetchFormat: field('fetchFormat'),
      apiKey: field('apiKey'),
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable,
      apiKeyRef: this.credential.ref
    };
  };

  QueritCardController.prototype.readCredential = function () {
    var self = this;
    var ref = refOf(this.form.scope.getSnapshot());
    if (ref !== this.credential.ref) {
      this.credential = { ref: ref, configured: false, writable: true };
      this.store.set(this.projection());
    }
    this.ctx.remote.credentials
      .describe([ref])
      .then(function (response) {
        if (!response || response.ok !== true) return;
        if (ref !== refOf(self.form.scope.getSnapshot())) return;
        var view = response.value !== undefined ? response.value[ref] : undefined;
        var next = {
          ref: ref,
          configured: view !== undefined && view.configured === true,
          writable: view === undefined || view.writable !== false
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
    return this.ctx.remote.credentials
      .set(refOf(this.form.scope.getSnapshot()), value)
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
    var id = props.id;
    var inputProps = Object.assign({}, props.inputProps || {});
    var as = inputProps.as === 'select' ? 'select' : 'input';
    delete inputProps.as;
    var controlClass = 'qr-input' + (props.state && props.state.invalid ? ' qr-input-invalid' : '');
    inputProps.id = id;
    inputProps.className = controlClass;
    var control;
    if (as === 'select') {
      control = React.createElement('select', inputProps, props.options || []);
    } else {
      control = React.createElement('input', inputProps);
    }
    var headChildren = [
      inline
        ? React.createElement('label', { key: 'label', className: 'qr-label', htmlFor: id }, props.label)
        : React.createElement('span', { key: 'label', className: 'qr-label' }, props.label),
      props.state && props.state.overridden
        ? React.createElement(
            'span',
            { key: 'badges', className: 'qr-badges' },
            React.createElement('span', { className: 'qr-tagOver' }, props.overriddenLabel),
            props.onReset
              ? React.createElement(
                  'button',
                  { type: 'button', className: 'qr-reset', disabled: props.disabled || !props.state.overridden, onClick: props.onReset },
                  props.resetLabel
                )
              : null
          )
        : null,
      inline ? props.children : null
    ];
    var bodyChildren = inline ? null : control;
    var help = props.state && props.state.invalid
      ? React.createElement('p', { className: 'qr-invalid' }, props.invalidLabel)
      : props.hint
        ? React.createElement('p', { className: 'qr-hint' }, props.hint)
        : null;
    return React.createElement(
      'div',
      { className: 'qr-field' },
      React.createElement('div', { className: 'qr-fhead' }, headChildren),
      bodyChildren,
      help
    );
  }

  /** A checkbox row bound to one boolean field. */
  function toggleRow(props, t, state, name, label, hint, id, disabled) {
    return React.createElement(
      FieldRow,
      {
        id: id,
        label: label,
        hint: hint,
        state: state,
        disabled: disabled,
        inline: true,
        overriddenLabel: t('overridden'),
        resetLabel: t('reset'),
        onReset: function () { props.resetField(name); }
      },
      React.createElement('input', {
        className: 'qr-check',
        type: 'checkbox',
        disabled: disabled,
        checked: state.text === 'true',
        onChange: function (event) { props.edit(name, event.target.checked ? 'true' : 'false'); }
      })
    );
  }

  /** A dropdown over a fixed set, with a blank option that clears the field. */
  function selectRow(props, t, state, name, label, hint, choices, id, disabled, optional) {
    var options = (optional === true ? [React.createElement('option', { key: '', value: '' }, t('useDefault'))] : []).concat(
      choices.map(function (choice) {
        return React.createElement('option', { key: choice, value: choice }, choice);
      })
    );
    return React.createElement(
      FieldRow,
      {
        id: id,
        label: label,
        hint: hint,
        state: state,
        disabled: disabled,
        overriddenLabel: t('overridden'),
        resetLabel: t('reset'),
        onReset: function () { props.resetField(name); },
        inputProps: {
          disabled: disabled,
          value: state.text,
          onChange: function (event) { props.edit(name, event.target.value); },
          as: 'select'
        },
        options: options
      }
    );
  }

  /**
   * The entry the Plugins page renders for the Querit row: a one-liner while
   * collapsed (`view: 'summary'`), the settings form on the row's own page
   * (`view: 'page'`). The page draws the row's title itself.
   */
  function QueritRowConfig(props) {
    var t = props.t || function (key) {
      return zh[key] || en[key] || key;
    };
    if (props.view === 'summary') return React.createElement('span', null, t('summary'));

    var state = props.useQueritCard(function (snapshot) {
      return snapshot;
    });
    if (!state.available) return null;
    var disabled = !state.writable;
    var blocked = !state.dirty || state.invalid || state.saving;
    var text = function (control) {
      return control.text;
    };
    var prefix = 'plugin-config-querit-';
    return React.createElement(
      'div',
      { className: 'qr-page', 'data-querit-config': 'page' },
      disabled ? React.createElement('p', { className: 'qr-readonly', role: 'status' }, t('readOnly')) : null,
      React.createElement(
        FieldRow,
        {
          id: prefix + 'key',
          label: t('keyLabel'),
          hint: state.apiKeyConfigured
            ? t('keySet') + ' ' + state.apiKeyRef + '.'
            : t('keyUnset'),
          disabled: disabled || !state.apiKeyWritable,
          inputProps: {
            className: 'qr-input',
            type: 'password',
            autoComplete: 'new-password',
            disabled: disabled || !state.apiKeyWritable,
            placeholder: state.apiKeyConfigured ? '\u2022\u2022\u2022\u2022\u2022\u2022' : '',
            value: text(state.apiKey),
            onChange: function (event) { props.edit('apiKey', event.target.value); }
          }
        }
      ),
      field(props, t('refLabel'), t('refHint'), state.apiKeyEnv, 'apiKeyEnv', disabled, prefix + 'env'),
      field(props, t('countLabel'), t('countHint'), state.count, 'count', disabled, prefix + 'count', true),
      field(props, t('timeRangeLabel'), t('timeRangeHint'), state.timeRange, 'timeRange', disabled, prefix + 'time'),
      field(props, t('languagesLabel'), t('languagesHint'), state.languages, 'languages', disabled, prefix + 'languages'),
      field(props, t('countriesLabel'), t('countriesHint'), state.countries, 'countries', disabled, prefix + 'countries'),
      field(props, t('includeLabel'), t('includeHint'), state.includeDomains, 'includeDomains', disabled, prefix + 'include'),
      field(props, t('excludeLabel'), t('excludeHint'), state.excludeDomains, 'excludeDomains', disabled, prefix + 'exclude'),
      toggleRow(props, t, state.includeContent, 'includeContent', t('contentLabel'), t('contentHint'), prefix + 'content', disabled),
      field(props, t('contentMaxCharsLabel'), t('contentMaxCharsHint'), state.contentMaxChars, 'contentMaxChars', disabled, prefix + 'content-max', true),
      toggleRow(props, t, state.highlights, 'highlights', t('highlightsLabel'), t('highlightsHint'), prefix + 'highlights', disabled),
      toggleRow(props, t, state.needMarkdown, 'needMarkdown', t('markdownLabel'), t('markdownHint'), prefix + 'markdown', disabled),
      selectRow(props, t, state.rank, 'rank', t('rankLabel'), t('rankHint'), RANK_VALUES, prefix + 'rank', disabled, true),
      selectRow(props, t, state.vertical, 'vertical', t('verticalLabel'), t('verticalHint'), VERTICAL_VALUES, prefix + 'vertical', disabled, true),
      field(props, t('resourceTagsLabel'), t('resourceTagsHint'), state.resourceTags, 'resourceTags', disabled, prefix + 'resource-tags'),
      field(props, t('chunksLabel'), t('chunksHint'), state.chunksPerDoc, 'chunksPerDoc', disabled, prefix + 'chunks', true),
      selectRow(props, t, state.fetchFormat, 'fetchFormat', t('formatLabel'), t('formatHint'), FETCH_FORMATS, prefix + 'format', disabled, false),
      React.createElement(
        'div',
        { className: 'qr-foot' },
        state.failed ? React.createElement('p', { className: 'qr-failed', role: 'status' }, t('saveFailed')) : null,
        React.createElement(
          'button',
          { type: 'button', className: 'qr-btn qr-discard', disabled: (!state.dirty && !state.failed) || state.saving, onClick: props.discard },
          t('discard')
        ),
        React.createElement(
          'button',
          { type: 'button', className: 'qr-btn qr-save', disabled: blocked, onClick: props.save },
          t(state.saving ? 'saving' : 'save')
        )
      )
    );
  }

  /** Extract one section field's row into a shared control render. */
  function field(props, label, hint, state, name, disabled, id, numeric) {
    var inputProps = {
      className: 'qr-input' + (state.invalid ? ' qr-input-invalid' : ''),
      type: numeric === true ? 'number' : 'text',
      disabled: disabled,
      value: state.text,
      onChange: function (event) { props.edit(name, event.target.value); }
    };
    if (numeric === true) inputProps.inputMode = 'numeric';
    if (state.invalid) inputProps['aria-invalid'] = true;
    return React.createElement(
      FieldRow,
      {
        id: id,
        label: label,
        hint: hint,
        state: state,
        disabled: disabled,
        invalidLabel: props.t('invalidNumber'),
        overriddenLabel: props.t('overridden'),
        resetLabel: props.t('reset'),
        onReset: function () { props.resetField(name); },
        inputProps: inputProps
      }
    );
  }

  /** Required services (cordis fiber inject); `remote.credentials` gates the page on the credentials namespace. */
  var inject = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms'];

  /**
   * Mount the Querit row's configuration page while the Host serves its namespace.
   * @param ctx - the browser plugin context.
   */
  function apply(ctx) {
    var slots = ctx.get('slots');
    var locale = ctx.get('locale');
    var configForms = ctx.get('configForms');
    if (slots === undefined || locale === undefined || configForms === undefined) return;
    // Register the page dictionaries, then bind our own translator so text
    // resolves even if the slot framework delivers no `t` seat for this entry.
    var dicts = { zh: zh, en: en };
    ctx.effect(function () {
      return locale.register(NS, dicts);
    }, 'dsh-querit: page dictionaries');
    var t = locale.bind(NS);
    var controller = new QueritCardController(configForms.get(NAMESPACE), ctx);
    ctx.effect(function () {
      return function () { controller.dispose(); };
    }, 'dsh-querit: form subscription');
    var remote = ctx.get('remote');
    if (remote !== undefined) {
      // A key written on another surface changes no settings section, so this
      // event is the only signal that it reached the Host.
      ctx.effect(function () {
        return remote.$on('credentials/reference-updated', function (ref) {
          controller.refreshCredential(ref);
        });
      }, 'dsh-querit: credential invalidations');
    }
    // A deployment that never composed this entry shows no trace of the page.
    ctx.effect(function () {
      return configForms.whileServed([NAMESPACE], function () {
        return ctx.slots.inject('plugins.row.config', function () {
          return ctx.slots.register(
            {
              name: 'plugins.row.config',
              key: ROW_CONFIG_KEY,
              locale: NS,
              inject: function () {
                var face = controller.inject();
                face.t = t;
                return face;
              }
            },
            QueritRowConfig
          );
        });
      });
    }, 'dsh-querit: row configuration page');
  }

  exports.apply = apply;
  exports.inject = inject;
  exports.ROW_CONFIG_KEY = ROW_CONFIG_KEY;
  exports.QueritCardController = QueritCardController;
  exports.QueritRowConfig = QueritRowConfig;
  return module.exports;
});
