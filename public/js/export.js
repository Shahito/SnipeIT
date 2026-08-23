/**
 * export.js - Backtest results export modal
 * Depends on: t(), fmtDate(), fmtDateTime(), fmtNum() (globals from results.html)
 * Usage: initExport() once on page load, then openExportModal(resultData) on button click.
 *
 * Dual-mode: shared between results.html (single job, strategy = job.strategySnapshot,
 * passed in as _strategy) and sweep-results.html (sweep = many jobs, strategy =
 * { name } + definitionSnapshot, passed in as .strategy / .definition).
 */

(function () {
    let _data = null
    let _mode = 'single'
    let _format = 'json'

    const FIELD_DEFS = {
        single: [
            { id: 'chkSummary', opt: 'includeSummary', i18n: 'export.include.summary', default: true },
            { id: 'chkStrategy', opt: 'includeStrategy', i18n: 'export.include.strategy', default: true },
            { id: 'chkMonthly', opt: 'includeMonthly', i18n: 'export.include.monthly', default: true },
            { id: 'chkTrades', opt: 'includeTrades', i18n: 'export.include.trades', default: false },
            { id: 'chkEquity', opt: 'includeEquity', i18n: 'export.include.equity', default: false },
        ],
        sweep: [
            { id: 'chkSwSummary', opt: 'includeSummary', i18n: 'export.include.summary', default: true },
            { id: 'chkSwStrategy', opt: 'includeStrategy', i18n: 'export.include.strategy', default: true },
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

    function _isSweepData(d) {
        return !!d
            && ((Array.isArray(d.best) && Array.isArray(d.worst)) || Array.isArray(d.all))
            && d.global && typeof d.global === 'object' && !Array.isArray(d.global)
    }

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
            <div class="exp-controls">
                <div class="exp-section-label">${t('export.section.format')}</div>
                <div class="exp-format-toggle" id="expFormatToggle">
                <button class="exp-fmt-btn active" data-fmt="json">${t('export.format.json')}</button>
                <button class="exp-fmt-btn" data-fmt="text">${t('export.format.text')}</button>
                </div>

                <div class="exp-section-label" style="margin-top:.9rem">${t('export.section.include')}</div>
                <div id="expIncludeList"></div>
            </div>

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

        document.getElementById('expCloseBtn').addEventListener('click', _closeModal)
        el.addEventListener('click', e => { if (e.target === el) _closeModal() })
        bindModalKeys('exportModal', { onCancel: _closeModal })

        document.getElementById('expFormatToggle').addEventListener('click', e => {
            const btn = e.target.closest('.exp-fmt-btn')
            if (!btn) return
            _format = btn.dataset.fmt
            document.querySelectorAll('.exp-fmt-btn').forEach(b => b.classList.toggle('active', b === btn))
            _render()
        })

        document.getElementById('expCopyBtn').addEventListener('click', async () => {
            const text = document.getElementById('expPreview').textContent
            try {
                await navigator.clipboard.writeText(text)
                _flashCopy()
            } catch {
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

        if (typeof renderIcons === 'function') renderIcons(el)
    }

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

    function _render() {
        if (!_data) return
        const content = _format === 'json' ? _buildJSON() : _buildText()
        document.getElementById('expPreview').textContent = content
    }

    function _buildJSON() {
        return _mode === 'sweep' ? _buildSweepJSON() : _buildSingleJSON()
    }
    function _buildText() {
        return _mode === 'sweep' ? _buildSweepText() : _buildSingleText()
    }

    // Resolve the strategy object for the current mode/data.
    // single: job.strategySnapshot, passed in as r._strategy (results.html)
    // sweep:  { name } from r.strategy + sweepable body from r.definition
    function _resolveStrategy(r) {
        if (_mode === 'sweep') {
            if (!r.definition && !r.strategy) return null
            return { name: r.strategy?.name, ...(r.definition || {}) }
        }
        return r._strategy || null
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

        const strategy = _resolveStrategy(r)
        if (_opts.includeStrategy && strategy) {
            out.strategy = _formatStrategyJSON(strategy)
        }

        if (_opts.includeMonthly && r.monthlyPerf) {
            out.monthlyPerf = r.monthlyPerf
        }

        if (_opts.includeTrades && r.trades) {
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

        return JSON.stringify(_roundDeep(out), null, 2)
    }

    function _buildSingleText() {
        const r = _data
        const lines = []
        const fmt = (v, d = 2) => (v != null ? v.toFixed(d) : 'N/A')
        const sign = v => (v >= 0 ? '+' : '')
        const COL = 20
        const row = (label, value) => `  ${label.padEnd(COL)}${value}`

        lines.push(t('export.text.title'))
        if (r._pair) {
            lines.push(row(t('export.text.label.symbol'), r._pair ?? 'N/A'))
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

        const strategy = _resolveStrategy(r)
        if (_opts.includeStrategy && strategy) {
            lines.push(..._formatStrategyText(strategy))
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

        const strategy = _resolveStrategy(r)
        if (_opts.includeStrategy && strategy) {
            out.strategy = _formatStrategyJSON(strategy)
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

        if (r.all) {
            // Small sweep
            if (_opts.includeBest || _opts.includeWorst) {
                out.all = r.all.map(j => _sweepJobSummary(j, r.definition))
            }
        } else {
            if (_opts.includeBest && r.best) {
                out.best = r.best.map(j => _sweepJobSummary(j, r.definition))
            }

            if (_opts.includeWorst && r.worst) {
                out.worst = r.worst.map(j => _sweepJobSummary(j, r.definition))
            }
        }

        return JSON.stringify(_roundDeep(out), null, 2)
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

        const strategy = _resolveStrategy(r)
        if (_opts.includeStrategy && strategy) {
            lines.push(..._formatStrategyText(strategy))
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
        if (r.all) {
            if (_opts.includeBest || _opts.includeWorst) comboTable(t('sweep.all_title'), r.all)
        } else {
            if (_opts.includeBest)  comboTable(t('sweep.best_title'), r.best)
            if (_opts.includeWorst) comboTable(t('sweep.worst_title'), r.worst)
        }

        return lines.join('\n')
    }

    // Strategy (shared)

    const _STRATEGY_DROP_KEYS = new Set(['id', '_id', 'userId', 'clonedFrom', 'createdAt', 'updatedAt', '__v'])

    function _cleanStrategy(s) {
        const clean = v => {
            if (Array.isArray(v)) return v.map(clean)
            if (v && typeof v === 'object') {
                const o = {}
                for (const k in v) { if (!_STRATEGY_DROP_KEYS.has(k)) o[k] = clean(v[k]) }
                return o
            }
            return v
        }
        return clean(s)
    }

    // JSON condition tree (entry/exit): { left, operator, right, lookback? }
    // Mirrors _refKeys() in condition-settings.js.
    function _condRefKeys(prefix) {
        const p = prefix || ''
        return {
            ind: p ? `${p}Indicator` : 'indicator',
            per: p ? `${p}IndicatorPeriod` : 'period',
            src: p ? `${p}IndicatorSource` : 'source',
            off: p ? `${p}IndicatorOffset` : 'offset',
            tf: p ? `${p}IndicatorTimeframe` : 'timeframe',
        }
    }

    function _buildIndicatorRef(cond, prefix) {
        const k = _condRefKeys(prefix)
        const ref = {}
        if (cond[k.ind] != null) ref.indicator = cond[k.ind]
        if (cond[k.per] != null) ref.period = cond[k.per]
        if (cond[k.tf] != null) ref.timeframe = cond[k.tf]
        if (cond[k.src] != null) ref.source = cond[k.src]
        if (cond[k.off]) ref.offset = cond[k.off]

        // Optional "combine with" second ref (e.g. OPEN - CLOSE), mirrors
        // _refKeys() in condition-settings.js. Was previously dropped
        // silently since nothing referenced these keys.
        const p = prefix || ''
        const copKey  = p ? `${p}CombineOp` : 'combineOp'
        const cindKey = p ? `${p}CombineIndicator` : 'combineIndicator'
        const cperKey = p ? `${p}CombinePeriod` : 'combinePeriod'
        const csrcKey = p ? `${p}CombineSource` : 'combineSource'
        const coffKey = p ? `${p}CombineOffset` : 'combineOffset'
        if (cond[copKey]) {
            ref.combine = { op: cond[copKey], indicator: cond[cindKey] }
            if (cond[cperKey] != null) ref.combine.period = cond[cperKey]
            if (cond[csrcKey] != null) ref.combine.source = cond[csrcKey]
            if (cond[coffKey]) ref.combine.offset = cond[coffKey]
        }
        return ref
    }

    function _transformCondition(cond) {
        const out = {
            left: _buildIndicatorRef(cond, ''),
            operator: cond.operator,
            right: cond.valueIndicator ? _buildIndicatorRef(cond, 'value') : { constant: cond.value },
        }
        // valueMultiplier only applies to an indicator RHS, and can itself be
        // a sweep axis ({ sweep: [...] }) - was previously dropped entirely.
        if (cond.valueIndicator && cond.valueMultiplier != null && cond.valueMultiplier !== 1) {
            out.right.multiplier = cond.valueMultiplier
        }
        if (cond.lookback > 1) {
            out.lookback = {
                periods: cond.lookback,
                mode: cond.lookbackMode === 'any' ? 'ANY' : 'ALL',
                includeCurrent: true,
            }
        }
        return out
    }

    // Group[][] = OR of AND-groups -> single cond, { and: [...] }, or { or: [...] }
    function _transformConditionGroups(groups) {
        if (!groups?.length) return null
        const norm = Array.isArray(groups[0]) ? groups : [groups]
        const andGroups = norm.map(g => g.length === 1 ? _transformCondition(g[0]) : { and: g.map(_transformCondition) })
        return andGroups.length === 1 ? andGroups[0] : { or: andGroups }
    }

    function _formatStrategyJSON(s) {
        const clean = _cleanStrategy(s)

        // signals (renamed from conditions)
        if (clean.conditions) {
            const signals = {}
            ;['entry', 'exit'].forEach(type => {
                const transformed = _transformConditionGroups(clean.conditions[type])
                if (transformed) signals[type] = transformed
            })
            delete clean.conditions
            clean.signals = signals
        }

        // riskManagement (stopLoss / trailingStopLoss / takeProfit / slType / tpType / atrPeriod)
        const hasSL = clean.stopLoss != null || clean.trailingStopLoss != null
        const hasTP = clean.takeProfit != null
        if (hasSL || hasTP) {
            const risk = {}
            if (hasSL) {
                risk.stopLoss = {
                    value: clean.stopLoss ?? clean.trailingStopLoss,
                    type: (clean.slType || 'percent').toUpperCase(),
                    trailing: clean.stopLoss == null && clean.trailingStopLoss != null,
                }
            }
            if (hasTP) {
                risk.takeProfit = { value: clean.takeProfit, type: (clean.tpType || 'percent').toUpperCase() }
            }
            const usesAtr = (hasSL && (clean.slType || 'percent') === 'atr') || (hasTP && (clean.tpType || 'percent') === 'atr')
            if (usesAtr && clean.atrPeriod != null) risk.atrPeriod = clean.atrPeriod
            clean.riskManagement = risk
        }
        delete clean.stopLoss; delete clean.trailingStopLoss; delete clean.takeProfit
        delete clean.slType; delete clean.tpType; delete clean.atrPeriod

        // positionSizing
        if (clean.positionSize != null) {
            clean.positionSizing = { type: 'EQUITY_PERCENT', value: clean.positionSize }
        }
        delete clean.positionSize

        // fees
        if (clean.feeMaker != null || clean.feeTaker != null) {
            clean.fees = { makerPct: clean.feeMaker, takerPct: clean.feeTaker }
        }
        delete clean.feeMaker; delete clean.feeTaker

        return clean
    }

    const OPERATOR_LABELS = () => ({
        '>': '>', '<': '<', '>=': '>=', '<=': '<=', '==': '==',
        cross_above: t('editor.cond.cross_above'),
        cross_below: t('editor.cond.cross_below'),
    })

    function _describeRef(cond, prefix) {
        const ind = (prefix ? cond[`${prefix}Indicator`] : cond.indicator) || '?'
        const period = prefix ? cond[`${prefix}IndicatorPeriod`] : cond.period
        const source = prefix ? cond[`${prefix}IndicatorSource`] : cond.source
        const timeframe = prefix ? cond[`${prefix}IndicatorTimeframe`] : cond.timeframe
        let label = ind
        if (period != null && typeof period !== 'object') label += `(${period})`
        if (source != null && typeof source !== 'object') label += `[${source}]`
        if (timeframe != null && typeof timeframe !== 'object') label += `[${timeframe}]`
        return label
    }

    function _describeCombinedRef(cond, prefix) {
        const copKey  = prefix ? `${prefix}CombineOp` : 'combineOp'
        const cindKey = prefix ? `${prefix}CombineIndicator` : 'combineIndicator'
        const cperKey = prefix ? `${prefix}CombinePeriod` : 'combinePeriod'
        const csrcKey = prefix ? `${prefix}CombineSource` : 'combineSource'
        let label = _describeRef(cond, prefix)
        if (cond[copKey]) {
            const combineRef = { indicator: cond[cindKey], period: cond[cperKey], source: cond[csrcKey] }
            label += ` ${cond[copKey]} ${_describeRef(combineRef, '')}`
        }
        return label
    }

    function _formatSweepableValue(v) {
        if (v && typeof v === 'object' && Array.isArray(v.sweep)) return `sweep(${v.sweep.join(', ')})`
        return v
    }

    function _describeCondition(cond) {
        const lhs = _describeCombinedRef(cond, '')
        const op = OPERATOR_LABELS()[cond.operator] || cond.operator
        let rhs = cond.valueIndicator ? _describeCombinedRef(cond, 'value') : _formatSweepableValue(cond.value)
        if (cond.valueIndicator && cond.valueMultiplier != null && cond.valueMultiplier !== 1) {
            rhs += ` × ${_formatSweepableValue(cond.valueMultiplier)}`
        }
        let line = `${lhs} ${op} ${rhs}`
        if (cond.lookback > 1) {
            const mode = cond.lookbackMode === 'any' ? t('editor.cond.lookback_any') : t('editor.cond.lookback_all')
            line += ` (${mode} ${cond.lookback} ${t('editor.cond.lookback_candles')})`
        }
        if (cond.offset) line += ` [offset ${cond.offset}]`
        return line
    }

    // Group[][] = OR of AND-groups (see normalizeConditions in condition-renderer.js)
    function _describeConditionGroups(groups) {
        if (!groups?.length) return []
        const norm = Array.isArray(groups[0]) ? groups : [groups]
        return norm.map(g => g.map(_describeCondition).join(` ${t('editor.cond.and')} `))
    }

    function _labelize(key) {
        return String(key)
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/[_-]+/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase())
    }

    function _dumpStrategyLines(v, indent) {
        const pad = '  '.repeat(indent)
        const lines = []
        if (Array.isArray(v)) {
            v.forEach(item => {
                if (item && typeof item === 'object' && !Array.isArray(item)) {
                    const entries = Object.entries(item)
                    const primitive = entries.filter(([, val]) => val == null || typeof val !== 'object')
                    const nested = entries.filter(([, val]) => val && typeof val === 'object')
                    lines.push(`${pad}- ${primitive.map(([k, val]) => `${_labelize(k)}: ${val}`).join(', ')}`)
                    nested.forEach(([k, val]) => {
                        lines.push(`${pad}  ${_labelize(k)}:`)
                        lines.push(..._dumpStrategyLines(val, indent + 2))
                    })
                } else {
                    lines.push(`${pad}- ${item}`)
                }
            })
        } else if (v && typeof v === 'object') {
            Object.entries(v).forEach(([k, val]) => {
                if (val == null || val === '') return
                if (Array.isArray(val) || typeof val === 'object') {
                    lines.push(`${pad}${_labelize(k)}:`)
                    lines.push(..._dumpStrategyLines(val, indent + 1))
                } else {
                    lines.push(`${pad}${_labelize(k)}: ${val}`)
                }
            })
        } else {
            lines.push(`${pad}${v}`)
        }
        return lines
    }

    function _formatRiskManagementLines(s) {
        const hasSL = s.stopLoss != null || s.trailingStopLoss != null
        const hasTP = s.takeProfit != null
        if (!hasSL && !hasTP) return []
        const lines = [`  ${t('export.text.section.risk')}:`]
        if (hasSL) {
            const val = s.stopLoss ?? s.trailingStopLoss
            const isAtr = (s.slType || 'percent') === 'atr'
            const trailing = s.stopLoss == null && s.trailingStopLoss != null ? ` (${t('export.text.label.trailing')})` : ''
            lines.push(`    ${t('export.text.label.stop_loss').padEnd(20)}${_formatSweepableValue(val)}${isAtr ? ' x ATR' : '%'}${trailing}`)
        }
        if (hasTP) {
            const isAtr = (s.tpType || 'percent') === 'atr'
            lines.push(`    ${t('export.text.label.take_profit').padEnd(20)}${_formatSweepableValue(s.takeProfit)}${isAtr ? ' x ATR' : '%'}`)
        }
        const usesAtr = (hasSL && (s.slType || 'percent') === 'atr') || (hasTP && (s.tpType || 'percent') === 'atr')
        if (usesAtr && s.atrPeriod != null) lines.push(`    ${t('export.text.label.atr_period').padEnd(20)}${s.atrPeriod}`)
        return lines
    }

    function _formatPositionSizingLines(s) {
        if (s.positionSize == null) return []
        return [
            `  ${t('export.text.section.position_sizing')}:`,
            `    ${t('export.text.label.position_size').padEnd(20)}${_formatSweepableValue(s.positionSize)}%`,
        ]
    }

    function _formatFeesLines(s) {
        if (s.feeMaker == null && s.feeTaker == null) return []
        const lines = [`  ${t('export.text.section.fees')}:`]
        if (s.feeMaker != null) lines.push(`    ${t('export.text.label.maker_fee').padEnd(20)}${s.feeMaker}%`)
        if (s.feeTaker != null) lines.push(`    ${t('export.text.label.taker_fee').padEnd(20)}${s.feeTaker}%`)
        return lines
    }

    function _formatStrategyText(s) {
        const lines = []
        lines.push(`  ${t('export.text.section.strategy')}`)
        if (s.name) lines.push(`  ${t('export.text.label.strategy_name').padEnd(20)}${s.name}`)
        if (s.description) lines.push(`  ${t('export.text.label.strategy_desc').padEnd(20)}${s.description}`)

        const rest = { ...s }
        delete rest.name
        delete rest.description

        const conditions = rest.conditions
        delete rest.conditions
        if (conditions) {
            const TABS = { entry: t('editor.cond.tab_entry'), exit: t('editor.cond.tab_exit') }
            ;['entry', 'exit'].forEach(type => {
                const described = _describeConditionGroups(conditions[type])
                if (!described.length) return
                lines.push(`  ${TABS[type]}:`)
                described.forEach((g, i) => {
                    lines.push(`    ${i > 0 ? t('editor.cond.add_group') + ' ' : ''}${g}`)
                })
            })
        }

        lines.push(..._formatRiskManagementLines(rest))
        lines.push(..._formatPositionSizingLines(rest))
        lines.push(..._formatFeesLines(rest))
        delete rest.stopLoss; delete rest.trailingStopLoss; delete rest.takeProfit
        delete rest.slType; delete rest.tpType; delete rest.atrPeriod
        delete rest.positionSize; delete rest.feeMaker; delete rest.feeTaker

        lines.push(..._dumpStrategyLines(rest, 1))
        lines.push('')
        return lines
    }

    // Shared helpers
    const _ROUND2_KEYS = new Set([
        'pnlPercent', 'pnlAbsolute', 'buyHoldPercent', 'winRate', 'maxDrawdown',
        'sharpeRatio', 'profitFactor', 'exposurePct', 'cumulativePnl',
        'avgPnlPercent', 'medianPnlPercent', 'stdPnlPercent', 'pctProfitable',
        'bestPnlPercent', 'worstPnlPercent',
    ])

    function _round2(n) {
        return typeof n === 'number' ? Math.round(n * 100) / 100 : n
    }

    function _roundDeep(v, key) {
        if (Array.isArray(v)) return v.map(x => _roundDeep(x, key))
        if (v && typeof v === 'object') {
            const o = {}
            for (const k in v) o[k] = _roundDeep(v[k], k)
            return o
        }
        return _ROUND2_KEYS.has(key) ? _round2(v) : v
    }

    function _miniBar(pnl) {
        const blocks = Math.min(10, Math.abs(Math.round(pnl / 2)))
        const chr = pnl >= 0 ? '▪' : '▫'
        return chr.repeat(blocks)
    }

    function _safeDate(d) {
        try { return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) }
        catch { return String(d) }
    }

    window.initExport = initExport
    window.openExportModal = openExportModal
})()