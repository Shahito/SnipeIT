/**
 * export.js - Backtest results export modal
 * Depends on: t(), fmtDate(), fmtDateTime(), fmtNum() (globals from results.html)
 * Usage: initExport() once on page load, then openExportModal(resultData) on button click.
 *
 * Dual-mode: this modal is shared between results.html (single backtest job)
 * and sweep-results.html (a sweep = many jobs). The shape of the object passed
 * to openExportModal() is auto-detected (_isSweepData) and the "include"
 * checkboxes + JSON/text builders adapt accordingly:
 *  - single mode: summary / monthly perf / trades / equity curve
 *  - sweep mode: global summary / categories / sensitivity / best & worst combos
 * Nothing here needs to be told which page it runs on.
 */

(function () {
    /* State */
    let _data = null
    let _mode = 'single'   // 'single' | 'sweep' - detected from the data shape
    let _format = 'json'   // 'json' | 'text'

    /* Field definitions per mode - drives both the checkbox list and the defaults */
    const FIELD_DEFS = {
        single: [
            { id: 'chkSummary', opt: 'includeSummary', i18n: 'export.include.summary', default: true },
            { id: 'chkMonthly', opt: 'includeMonthly', i18n: 'export.include.monthly', default: true },
            { id: 'chkTrades', opt: 'includeTrades', i18n: 'export.include.trades', default: false },
            { id: 'chkEquity', opt: 'includeEquity', i18n: 'export.include.equity', default: false },
        ],
        sweep: [
            { id: 'chkSwSummary', opt: 'includeSummary', i18n: 'export.include.summary', default: true },
            { id: 'chkSwCategories', opt: 'includeCategories', i18n: 'export.include.categories', default: true },
            { id: 'chkSwSensitivity', opt: 'includeSensitivity', i18n: 'export.include.sensitivity', default: true },
            { id: 'chkSwBest', opt: 'includeBest', i18n: 'export.include.best', default: true },
            { id: 'chkSwWorst', opt: 'includeWorst', i18n: 'export.include.worst', default: true },
        ],
    }

    function _defaultOpts(mode) {
        const o = {}
        FIELD_DEFS[mode].forEach(f => { o[f.opt] = f.default })
        return o
    }

    const _optsByMode = { single: _defaultOpts('single'), sweep: _defaultOpts('sweep') }
    let _opts = _optsByMode.single


    /* Detect whether the object passed to openExportModal() is a sweep result
       (many jobs summarized) or a single backtest job result. */
    function _isSweepData(d) {
        return !!d
            && Array.isArray(d.best)
            && Array.isArray(d.worst)
            && d.global && typeof d.global === 'object' && !Array.isArray(d.global)
    }

    /* Init */
    function initExport() {
        document.addEventListener('i18n:ready', () => {
            _injectModal()
            document.getElementById('exportBtn').addEventListener('click', () => {
                if (!window._exportData) return
                openExportModal(window._exportData)
            })
        })
    }

    function openExportModal(data) {
        _data = data
        _mode = _isSweepData(data) ? 'sweep' : 'single'
        _opts = _optsByMode[_mode]
        _updateHeader()
        _renderControls()
        _render()
        openModal('exportModal', 'expCloseBtn')
    }

    function _closeModal() {
        closeModal('exportModal')
    }

    /* Modal skeleton */
    function _injectModal() {
        const el = document.createElement('div')
        el.id = 'exportModal'
        el.className = 'exp-overlay hidden'
        el.innerHTML = `
        <div class="exp-modal">
            <div class="exp-modal-header">
            <div>
                <span class="exp-title" id="expTitleText">${t('export.title')}</span>
                <div class="text-muted text-sm" id="expSubtitle"></div>
            </div>
            <button class="modal-close" id="expCloseBtn" aria-label="${t('export.close')}">
                ${ICONS.cross}
            </button>
            </div>

            <div class="exp-body">
            <!-- Left: controls -->
            <div class="exp-controls">
                <div class="exp-section-label">${t('export.section.format')}</div>
                <div class="exp-format-toggle" id="expFormatToggle">
                <button class="exp-fmt-btn active" data-fmt="json">${t('export.format.json')}</button>
                <button class="exp-fmt-btn" data-fmt="text">${t('export.format.text')}</button>
                </div>

                <div class="exp-section-label" style="margin-top:.9rem">${t('export.section.include')}</div>
                <div id="expIncludeList"></div>
            </div>

            <!-- Right: preview -->
            <div class="exp-preview-wrap">
                <button class="btn btn-surface btn-sm exp-copy-btn" id="expCopyBtn" title="Copier">
                ${ICONS.copy}
                <span>${t('export.copy')}</span>
                </button>
                <pre class="exp-preview" id="expPreview"></pre>
            </div>
            </div>
        </div>
        `
        document.body.appendChild(el)

        /* Close handlers */
        document.getElementById('expCloseBtn').addEventListener('click', _closeModal)
        el.addEventListener('click', e => { if (e.target === el) _closeModal() })
        bindModalKeys('exportModal', { onCancel: _closeModal })

        /* Format toggle */
        document.getElementById('expFormatToggle').addEventListener('click', e => {
            const btn = e.target.closest('.exp-fmt-btn')
            if (!btn) return
            _format = btn.dataset.fmt
            document.querySelectorAll('.exp-fmt-btn').forEach(b => b.classList.toggle('active', b === btn))
            _render()
        })

        /* Copy button */
        document.getElementById('expCopyBtn').addEventListener('click', async () => {
            const text = document.getElementById('expPreview').textContent
            try {
                await navigator.clipboard.writeText(text)
                _flashCopy()
            } catch {
                /* fallback */
                const ta = document.createElement('textarea')
                ta.value = text
                ta.style.position = 'fixed'
                ta.style.opacity = '0'
                document.body.appendChild(ta)
                ta.select()
                document.execCommand('copy')
                document.body.removeChild(ta)
                _flashCopy()
            }
        })

        /* Render icons (if icons.js exposes renderIcons) */
        if (typeof renderIcons === 'function') renderIcons(el)
    }

    /* Rebuild the "include" checkbox list for the current mode */
    function _renderControls() {
        const defs = FIELD_DEFS[_mode]
        const container = document.getElementById('expIncludeList')
        container.innerHTML = defs.map(f => `
            <label class="exp-check">
            <input type="checkbox" id="${f.id}" ${_opts[f.opt] ? 'checked' : ''}>
            <span>${t(f.i18n)}</span>
            </label>
        `).join('')
        defs.forEach(f => {
            document.getElementById(f.id).addEventListener('change', e => {
                _opts[f.opt] = e.target.checked
                _render()
            })
        })
    }

    /* Modal title + subtitle depending on mode */
    function _updateHeader() {
        const titleEl = document.getElementById('expTitleText')
        const subEl = document.getElementById('expSubtitle')
        const r = _data
        if (_mode === 'sweep') {
            titleEl.textContent = t('export.title.sweep')
            subEl.textContent = [
                r.strategy?.name,
                r.totalRuns != null ? `${r.counts?.done ?? 0}/${r.totalRuns} runs` : null,
            ].filter(Boolean).join(' · ')
        } else {
            titleEl.textContent = t('export.title')
            subEl.textContent = [r._pair, r._timeframe].filter(Boolean).join(' · ')
        }
    }

    function _flashCopy() {
        const btn = document.getElementById('expCopyBtn')
        btn.classList.add('exp-copied')
        btn.querySelector('span').textContent = t('export.copied')
        setTimeout(() => {
            btn.classList.remove('exp-copied')
            btn.querySelector('span').textContent = t('export.copy')
        }, 1800)
    }

    /* Render preview */
    function _render() {
        if (!_data) return
        const content = _format === 'json' ? _buildJSON() : _buildText()
        document.getElementById('expPreview').textContent = content
    }

    /* Dispatch to the right builder depending on mode */
    function _buildJSON() {
        return _mode === 'sweep' ? _buildSweepJSON() : _buildSingleJSON()
    }
    function _buildText() {
        return _mode === 'sweep' ? _buildSweepText() : _buildSingleText()
    }

    // Single job (results.html)

    function _buildSingleJSON() {
        const r = _data
        const out = {}
        if (_opts.includeSummary) {
            out.summary = {
                pair: r._pair,
                timeframe: r._timeframe,
                pnlPercent: r.pnlPercent,
                pnlAbsolute: r.pnlAbsolute,
                buyHoldPercent: r.buyHoldPercent,
                initialCapital: r.initialCapital,
                finalCapital: r.finalCapital,
                totalTrades: r.totalTrades,
                winRate: r.winRate,
                maxDrawdown: r.maxDrawdown,
                sharpeRatio: r.sharpeRatio,
                profitFactor: r.profitFactor,
                durationDays: r.durationDays,
                exposurePct: r.exposurePct,
            }
        }

        if (_opts.includeMonthly && r.monthlyPerf) {
            out.monthlyPerf = r.monthlyPerf
        }

        if (_opts.includeTrades && r.trades) {
            out.trades = r.trades.map(tr => ({
                side: tr.side,
                date: tr.date,
                price: tr.price,
                quantity: tr.quantity,
                value: tr.value,
                pnl: tr.pnl ?? null,
                ...(tr.reason ? { exitReason: tr.reason } : {}),
            }))
            out.trades = r.trades
                .filter(tr => tr.side === "buy")
                .map(buy => {
                    const sell = r.trades.find(
                        tr => tr.side === "sell" && tr.date > buy.date
                    );
                    return {
                        entry: buy.date,
                        exit: sell?.date ?? null,
                        entryPrice: round(buy.price, 2),
                        exitPrice: round(sell?.price, 2),
                        pnl: sell?.pnl ?? null,
                        ...(sell?.reason ? { exitReason: sell.reason } : {}),
                    };
                });
        }

        if (_opts.includeEquity && r.equityCurve) {
            out.equityCurve = r.equityCurve
        }

        return JSON.stringify(out, null, 2)
    }

    /* Plain text builder */
    function _buildSingleText() {
        const r = _data
        const lines = []
        const fmt = (v, d = 2) => (v != null ? v.toFixed(d) : 'N/A')
        const sign = v => (v >= 0 ? '+' : '')
        const COL = 20
        const row = (label, value) => `  ${label.padEnd(COL)}${value}`

        lines.push(t('export.text.title'))
        if (r._pair || r._timeframe) {
            lines.push(row(t('export.text.label.symbol'), r._pair ?? 'N/A'))
            lines.push(row(t('export.text.label.timeframe'), r._timeframe ?? 'N/A'))
        }
        lines.push('')

        if (_opts.includeSummary) {
            lines.push(`  ${t('export.text.section.perf')}`)
            lines.push(row(t('export.text.label.pnl'), `${sign(r.pnlPercent)}${fmt(r.pnlPercent)}% (${sign(r.pnlAbsolute)}$${fmt(r.pnlAbsolute)})`))
            lines.push(row(t('export.text.label.pnl_cumul'), `${sign(r.cumulativePnl)}${fmt(r.cumulativePnl)}%`))
            lines.push(row(t('export.text.label.buyhold'), `${sign(r.buyHoldPercent)}${fmt(r.buyHoldPercent)}%`))
            lines.push(row(t('export.text.label.capital_initial'), `$${fmt(r.initialCapital)}`))
            lines.push(row(t('export.text.label.capital_final'), `$${fmt(r.finalCapital)}`))
            lines.push('')
            lines.push(`  ${t('export.text.section.stats')}`)
            lines.push(row(t('export.text.label.trades'), `${r.totalTrades}`))
            lines.push(row(t('export.text.label.winrate'), `${fmt(r.winRate)}%`))
            lines.push(row(t('export.text.label.maxdd'), `-${fmt(r.maxDrawdown)}%`))
            lines.push(row(t('export.text.label.sharpe'), `${fmt(r.sharpeRatio)}`))
            lines.push(row(t('export.text.label.profit_factor'), `${fmt(r.profitFactor)}`))
            lines.push(row(t('export.text.label.duration'), `${r.durationDays} days`))
            lines.push(row(t('export.text.label.exposure'), `${fmt(r.exposurePct)}%`))
            lines.push('')
        }

        if (_opts.includeMonthly && r.monthlyPerf?.length) {
            lines.push(`  ${t('export.text.section.monthly')}`)
            r.monthlyPerf.forEach(m => {
                const strat = m.strat != null ? `${m.strat >= 0 ? '+' : ''}${m.strat.toFixed(2)}%` : 'N/A'
                const asset = m.asset != null ? `${m.asset >= 0 ? '+' : ''}${m.asset.toFixed(2)}%` : 'N/A'
                const bar = _miniBar(m.strat ?? 0)
                lines.push(`  ${(m.month ?? '').padEnd(COL)}strat: ${strat.padStart(8)}   asset: ${asset.padStart(8)}  ${bar}`)
            })
            lines.push('')
        }

        if (_opts.includeTrades && r.trades?.length) {
            lines.push(`  ${t('export.text.section.trades')}`)
            const sells = r.trades.filter(tr => tr.side === 'sell')
            const header = `  ${t('export.text.trades.date').padEnd(18)} ${t('export.text.trades.price').padEnd(12)} ${t('export.text.trades.value').padEnd(12)} ${t('export.text.trades.pnl')}`
            lines.push(header)
            lines.push('  ' + '─'.repeat(header.length - 2))
            sells.forEach(tr => {
                const pnlStr = tr.pnl != null ? `${sign(tr.pnl)}${fmt(tr.pnl)}%` : '-'
                lines.push(`  ${_safeDate(tr.date).padEnd(18)} $${fmt(tr.price).padEnd(11)} $${fmt(tr.value).padEnd(11)} ${pnlStr}`)
            })
            lines.push('')
        }

        if (_opts.includeEquity && r.equityCurve?.length) {
            lines.push(`  ${t('export.text.section.equity')}`)
            lines.push(`  ${t('export.text.equity_range', { count: r.equityCurve.length, from: fmt(r.equityCurve[0]?.e), to: fmt(r.equityCurve[r.equityCurve.length - 1]?.e) })}`)
            r.equityCurve.forEach(p => {
                const d = new Date(p.t * 1000).toISOString().slice(0, 10)
                lines.push(`  ${d.padEnd(COL)}$${fmt(p.e)}`)
            })
            lines.push('')
        }

        return lines.join('\n')
    }

    // Sweep (sweep-results.html)

    function _describeAxis(path, definition) {
        if (typeof describeSweepAxis === 'function') {
            try { return describeSweepAxis(path, definition) } catch (_) {}
        }
        return path
    }
    function _describeValue(path, value, definition) {
        if (typeof describeSweepValue === 'function') {
            try { return describeSweepValue(path, value, definition) } catch (_) {}
        }
        return `${path}=${JSON.stringify(value)}`
    }

    // Strip a sweep job (best/worst entry) down to its summary fields - the
    // full `result` (trades/equity/price curves, per-run snapshot, ...) is
    // huge and not relevant when comparing runs across a sweep.
    function _sweepJobSummary(j, definition) {
        return {
            id: j.id,
            pair: j.pair,
            paramValues: j.paramValues,
            paramLabels: Object.entries(j.paramValues || {})
                .map(([k, v]) => _describeValue(k, v, definition))
                .join(', '),
            pnlPercent: j.pnlPercent,
            pnlAbsolute: j.pnlAbsolute,
            initialCapital: j.initialCapital,
            finalCapital: j.finalCapital,
            totalTrades: j.totalTrades,
            winRate: j.winRate,
            maxDrawdown: j.maxDrawdown,
            sharpeRatio: j.sharpeRatio,
            profitFactor: j.profitFactor,
            durationDays: j.durationDays,
        }
    }

    // Drop the UI-only `color` field, keep what's actually useful for analysis.
    function _sweepCategorySummary(c) {
        return {
            categoryId: c.categoryId,
            name: c.name,
            stats: c.stats,
        }
    }

    function _buildSweepJSON() {
        const r = _data
        const out = {}

        if (_opts.includeSummary) {
            out.summary = {
                strategy: r.strategy?.name,
                totalRuns: r.totalRuns,
                counts: r.counts,
                createdAt: r.createdAt,
                completedAt: r.completedAt,
                global: r.global,
            }
        }

        if (_opts.includeCategories && r.byCategory) {
            out.byCategory = r.byCategory.map(_sweepCategorySummary)
        }

        if (_opts.includeSensitivity && r.sensitivity) {
            out.sensitivity = r.sensitivity.map(axis => ({
                path: axis.path,
                label: _describeAxis(axis.path, r.definition),
                values: axis.values.map(v => ({
                    value: v.value,
                    label: _describeValue(axis.path, v.value, r.definition),
                    stats: v.stats,
                })),
            }))
        }

        if (_opts.includeBest && r.best) {
            out.best = r.best.map(j => _sweepJobSummary(j, r.definition))
        }

        if (_opts.includeWorst && r.worst) {
            out.worst = r.worst.map(j => _sweepJobSummary(j, r.definition))
        }

        return JSON.stringify(out, null, 2)
    }

    function _buildSweepText() {
        const r = _data
        const lines = []
        const fmt = (v, d = 2) => (v != null ? v.toFixed(d) : 'N/A')
        const sign = v => (v != null && v >= 0 ? '+' : '')
        const COL = 22
        const row = (label, value) => `  ${label.padEnd(COL)}${value}`
        const noResults = t('sweep.no_results_yet')

        lines.push(t('export.text.sweep_title'))
        lines.push(row(t('export.text.label.strategy'), r.strategy?.name ?? 'N/A'))
        lines.push(row(t('export.text.label.runs'), `${r.counts?.done ?? 0} / ${r.totalRuns ?? 0}`))
        lines.push('')

        if (_opts.includeSummary && r.global) {
            const g = r.global
            lines.push(`  ${t('sweep.global_title')}`)
            lines.push(row(t('sweep.metric.count'), g.count))
            lines.push(row(t('sweep.metric.avg_pnl'), `${sign(g.avgPnlPercent)}${fmt(g.avgPnlPercent)}%`))
            lines.push(row(t('sweep.metric.median_pnl'), `${sign(g.medianPnlPercent)}${fmt(g.medianPnlPercent)}%`))
            lines.push(row(t('sweep.metric.std_pnl'), `${fmt(g.stdPnlPercent)}%`))
            lines.push(row(t('sweep.metric.pct_profitable'), `${fmt(g.pctProfitable, 1)}%`))
            lines.push(row(t('sweep.metric.best'), `${sign(g.bestPnlPercent)}${fmt(g.bestPnlPercent)}%`))
            lines.push(row(t('sweep.metric.worst'), `${sign(g.worstPnlPercent)}${fmt(g.worstPnlPercent)}%`))
            lines.push('')
        }

        if (_opts.includeCategories && r.byCategory?.length) {
            lines.push(`  ${t('sweep.categories_title')}`)
            r.byCategory.forEach(c => {
                const label = c.categoryId === null ? t('sweep.category.uncategorized') : c.name
                if (!c.stats) { lines.push(`  ${String(label).padEnd(COL)}${noResults}`); return }
                const s = c.stats
                lines.push(`  ${String(label).padEnd(COL)}n=${s.count}  avg=${sign(s.avgPnlPercent)}${fmt(s.avgPnlPercent)}%  profitable=${fmt(s.pctProfitable, 1)}%  best=${sign(s.bestPnlPercent)}${fmt(s.bestPnlPercent)}%  worst=${sign(s.worstPnlPercent)}${fmt(s.worstPnlPercent)}%`)
            })
            lines.push('')
        }

        if (_opts.includeSensitivity && r.sensitivity?.length) {
            lines.push(`  ${t('sweep.sensitivity_title')}`)
            r.sensitivity.forEach(axis => {
                lines.push(`  ${_describeAxis(axis.path, r.definition)}`)
                axis.values.forEach(v => {
                    const val = _describeValue(axis.path, v.value, r.definition)
                    if (!v.stats) { lines.push(`    ${val.padEnd(COL)}${noResults}`); return }
                    lines.push(`    ${val.padEnd(COL)}n=${v.stats.count}  avg=${sign(v.stats.avgPnlPercent)}${fmt(v.stats.avgPnlPercent)}%  profitable=${fmt(v.stats.pctProfitable, 1)}%`)
                })
                lines.push('')
            })
        }

        const comboTable = (title, jobs) => {
            if (!jobs?.length) return
            lines.push(`  ${title}`)
            jobs.forEach(j => {
                const params = Object.entries(j.paramValues || {})
                    .map(([k, v]) => _describeValue(k, v, r.definition))
                    .join(', ') || '-'
                lines.push(`  ${(j.pair || '-').padEnd(12)} ${params.padEnd(28)} pnl=${sign(j.pnlPercent)}${fmt(j.pnlPercent)}%  sharpe=${fmt(j.sharpeRatio)}  winrate=${fmt(j.winRate, 1)}%  maxdd=-${fmt(j.maxDrawdown)}%`)
            })
            lines.push('')
        }
        if (_opts.includeBest)  comboTable(t('sweep.best_title'), r.best)
        if (_opts.includeWorst) comboTable(t('sweep.worst_title'), r.worst)

        return lines.join('\n')
    }

    // Shared helpers

    function _miniBar(pnl) {
        const blocks = Math.min(10, Math.abs(Math.round(pnl / 2)))
        const chr = pnl >= 0 ? '▪' : '▫'
        return chr.repeat(blocks)
    }

    function _safeDate(d) {
        try { return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) }
        catch { return String(d) }
    }

    /* Public API */
    window.initExport = initExport
    window.openExportModal = openExportModal
})()