/* @ds-bundle: {"format":4,"namespace":"MoneyView","components":[{"name":"Button"},{"name":"TextInput"},{"name":"Segmented"},{"name":"Eyebrow"},{"name":"Panel"},{"name":"Delta"},{"name":"Sparkline"},{"name":"StatCard"},{"name":"Ticker"},{"name":"DataTable"}]} */
(function () {
  /* React is resolved at render time, so the bundle may load before React does */
  var React = { useState: function (v) { return window.React.useState(v); }, Fragment: 'div' };
  function h() { var R = window.React; return R.createElement.apply(R, arguments); }
  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(' '); }
  var MINUS = '−';

  function fmtPct(v, digits) {
    var d = digits == null ? 2 : digits;
    if (v === 0) return '0.' + '0'.repeat(d) + '%';
    return (v > 0 ? '+' : MINUS) + Math.abs(v).toFixed(d) + '%';
  }

  function Button(p) {
    var variant = p.variant || 'secondary', size = p.size || 'md';
    var rest = Object.assign({}, p); delete rest.variant; delete rest.size; delete rest.arrow; delete rest.className;
    return h('button', Object.assign({ type: 'button' }, rest, { className: cx('mv-btn', 'mv-btn-' + variant, 'mv-btn-' + size, p.className) }),
      h('span', { className: 'mv-btn-label' }, p.children),
      p.arrow ? h('span', { className: 'mv-btn-arrow', 'aria-hidden': 'true' }, '→') : null);
  }

  function TextInput(p) {
    var id = p.id || ('mv-in-' + Math.random().toString(36).slice(2, 8));
    return h('label', { className: 'mv-field', htmlFor: id },
      p.label ? h('span', { className: 'mv-field-label' }, p.label) : null,
      h('span', { className: 'mv-field-row' },
        h('input', { id: id, className: 'mv-input', type: p.type || 'text', placeholder: p.placeholder, defaultValue: p.defaultValue, disabled: p.disabled, 'aria-invalid': p.error ? 'true' : undefined, onChange: p.onChange }),
        p.action ? h('span', { className: 'mv-field-action' }, p.action) : null),
      p.error ? h('span', { className: 'mv-field-error' }, p.error) : (p.help ? h('span', { className: 'mv-field-help' }, p.help) : null));
  }

  function Segmented(p) {
    var st = React.useState(p.value || (p.options && p.options[0]));
    var val = p.value != null && p.onChange ? p.value : st[0];
    return h('div', { className: 'mv-seg', role: 'tablist', 'aria-label': p.label },
      (p.options || []).map(function (o) {
        return h('button', { key: o, type: 'button', role: 'tab', 'aria-selected': o === val ? 'true' : 'false', className: cx('mv-seg-btn', o === val && 'is-on'),
          onClick: function () { st[1](o); if (p.onChange) p.onChange(o); } }, o);
      }));
  }

  function Eyebrow(p) {
    return h('div', { className: 'mv-eyebrow' },
      p.index != null ? h('span', { className: 'mv-eyebrow-idx' }, '[' + String(p.index).padStart(2, '0') + ']') : null,
      h('span', null, p.children),
      p.en ? h('span', { className: 'mv-eyebrow-en' }, '/ ' + p.en) : null);
  }

  function Panel(p) {
    return h('section', { className: cx('mv-panel', p.flush && 'mv-panel-flush', p.className) },
      h('i', { className: 'mv-tick mv-tick-tl', 'aria-hidden': 'true' }), h('i', { className: 'mv-tick mv-tick-tr', 'aria-hidden': 'true' }),
      h('i', { className: 'mv-tick mv-tick-bl', 'aria-hidden': 'true' }), h('i', { className: 'mv-tick mv-tick-br', 'aria-hidden': 'true' }),
      (p.title || p.meta) ? h('header', { className: 'mv-panel-head' },
        h('div', null, p.title ? h('h3', { className: 'mv-panel-title' }, p.title) : null, p.subtitle ? h('div', { className: 'mv-panel-sub' }, p.subtitle) : null),
        p.meta ? h('div', { className: 'mv-panel-meta' }, p.meta) : null) : null,
      h('div', { className: 'mv-panel-body' }, p.children));
  }

  function Delta(p) {
    var v = +p.value || 0, dir = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
    var glyph = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■';
    var label = p.format === 'abs' ? ((v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: p.digits == null ? 2 : p.digits, maximumFractionDigits: p.digits == null ? 2 : p.digits })) : fmtPct(v, p.digits);
    var sr = dir === 'up' ? '상승 ' : dir === 'down' ? '하락 ' : '보합 ';
    return h('span', { className: cx('mv-delta', 'mv-delta-' + dir, p.chip && 'mv-delta-chip') },
      h('span', { className: 'mv-sr' }, sr),
      h('span', { className: 'mv-delta-glyph', 'aria-hidden': 'true' }, glyph), label);
  }

  function Sparkline(p) {
    var data = p.data || [], w = p.width || 120, ht = p.height || 32, pad = 2;
    if (data.length < 2) return null;
    var min = Math.min.apply(null, data), max = Math.max.apply(null, data), rng = max - min || 1;
    var pts = data.map(function (d, i) { return [pad + i * (w - 2 * pad) / (data.length - 1), pad + (1 - (d - min) / rng) * (ht - 2 * pad)]; });
    var line = pts.map(function (q, i) { return (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join(' ');
    var tone = p.tone || (data[data.length - 1] >= data[0] ? 'up' : 'down');
    var last = pts[pts.length - 1];
    return h('svg', { className: cx('mv-spark', 'mv-spark-' + tone), width: w, height: ht, viewBox: '0 0 ' + w + ' ' + ht, role: 'img', 'aria-label': p.label || 'trend' },
      p.area ? h('path', { className: 'mv-spark-area', d: line + ' L' + last[0].toFixed(1) + ' ' + ht + ' L' + pad + ' ' + ht + ' Z' }) : null,
      h('path', { className: 'mv-spark-line', d: line }),
      h('circle', { className: 'mv-spark-dot', cx: last[0], cy: last[1], r: 2.5 }));
  }

  function StatCard(p) {
    return h('div', { className: 'mv-stat' },
      h('div', { className: 'mv-stat-top' },
        h('span', { className: 'mv-stat-label' }, p.label),
        p.code ? h('span', { className: 'mv-stat-code' }, p.code) : null),
      h('div', { className: 'mv-stat-figure' }, p.value),
      h('div', { className: 'mv-stat-foot' },
        p.change != null ? h(Delta, { value: p.change }) : null,
        p.spark ? h(Sparkline, { data: p.spark, width: 96, height: 28, label: p.label + ' trend' }) : null),
      p.note ? h('div', { className: 'mv-stat-note' }, p.note) : null);
  }

  function Ticker(p) {
    var items = p.items || [];
    var row = function (k) {
      return h('div', { className: 'mv-ticker-row', key: k, 'aria-hidden': k ? 'true' : undefined },
        items.map(function (it, i) {
          return h('span', { className: 'mv-ticker-item', key: i },
            h('span', { className: 'mv-ticker-sym' }, it.symbol),
            h('span', { className: 'mv-ticker-px' }, it.price),
            h(Delta, { value: it.change }));
        }));
    };
    return h('div', { className: 'mv-ticker', role: 'marquee', 'aria-label': p.label || 'Market ticker' },
      p.status ? h('span', { className: 'mv-ticker-status' }, h('i', { className: 'mv-live-dot', 'aria-hidden': 'true' }), p.status) : null,
      h('div', { className: 'mv-ticker-track' }, h('div', { className: 'mv-ticker-move', style: { animationDuration: (p.duration || 14) + 's' } }, row(0), row(1))));
  }

  function DataTable(p) {
    var cols = p.columns || [], rows = p.rows || [];
    return h('div', { className: 'mv-table-wrap' },
      h('table', { className: 'mv-table' },
        p.caption ? h('caption', null, p.caption) : null,
        h('thead', null, h('tr', null, cols.map(function (c) {
          return h('th', { key: c.key, scope: 'col', className: c.align === 'right' ? 'is-num' : null }, c.label, c.en ? h('span', { className: 'mv-th-en' }, c.en) : null);
        }))),
        h('tbody', null, rows.map(function (r, i) {
          return h('tr', { key: i, className: r._selected ? 'is-selected' : null }, cols.map(function (c) {
            var v = r[c.key];
            var content = c.type === 'delta' ? h(Delta, { value: v }) : c.type === 'spark' ? h(Sparkline, { data: v, width: 80, height: 20 }) : v;
            return h('td', { key: c.key, className: cx(c.align === 'right' && 'is-num', c.type === 'name' && 'is-name') }, content);
          }));
        }))));
  }

  window.MoneyView = Object.assign(window.MoneyView || {}, {
    Button: Button, TextInput: TextInput, Segmented: Segmented, Eyebrow: Eyebrow, Panel: Panel,
    Delta: Delta, Sparkline: Sparkline, StatCard: StatCard, Ticker: Ticker, DataTable: DataTable, fmtPct: fmtPct
  });
})();
