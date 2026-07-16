/**
 * export.js - Backtest results export modal
 * Depends on: t(), fmtDate(), fmtDateTime(), fmtNum() (globals from results.html)
 * Usage: initExport() once on page load, then openExportModal(resultData) on button click.
 */

(function () {
    /* State */
    let _data = null
    let _format = 'json'   // 'json' | 'text'
    let _opts = {
        includeSummary: true,
        includeMonthly: true,
        includeTrades: false,
        includeEquity: false,
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
            <span class="exp-title">${t('export.title')}</span>
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
                <label class="exp-check">
                <input type="checkbox" id="chkSummary" checked>
                <span>${t('export.include.summary')}</span>
                </label>
                <label class="exp-check">
                <input type="checkbox" id="chkMonthly" checked>
                <span>${t('export.include.monthly')}</span>
                </label>
                <label class="exp-check">
                <input type="checkbox" id="chkTrades">
                <span>${t('export.include.trades')}</span>
                </label>
                <label class="exp-check">
                <input type="checkbox" id="chkEquity">
                <span>${t('export.include.equity')}</span>
                </label>
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

        /* Checkboxes */
        const checks = { chkSummary: 'includeSummary', chkMonthly: 'includeMonthly', chkTrades: 'includeTrades', chkEquity: 'includeEquity' }
        Object.entries(checks).forEach(([id, key]) => {
            document.getElementById(id).addEventListener('change', e => {
                _opts[key] = e.target.checked
                _render()
            })
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

    /* JSON builder */
    function _buildJSON() {
        const r = _data
        const out = {}
        if (_opts.includeSummary) {
            out.summary = {
                pair:       r._pair,
                timeframe:  r._timeframe,
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
    function _buildText() {
        const r = _data
        const lines = []
        const fmt = (v, d = 2) => (v != null ? v.toFixed(d) : 'N/A')
        const sign = v => (v >= 0 ? '+' : '')
        const COL = 20
        const row = (label, value) => `  ${label.padEnd(COL)}${value}`

        lines.push(t('export.text.title'))
        if (r._pair || r._timeframe) {
            lines.push(row(t('export.text.label.symbol'),    r._pair ?? 'N/A'))
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