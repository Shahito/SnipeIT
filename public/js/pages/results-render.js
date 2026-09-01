// Metrics
const METRIC_TARGET_CARD = {
  'results.metric.pnl_pct': 'equityCard',
  'results.metric.maxdd': 'maeDistributionCard',
  'results.metric.trades': 'tradesCard',
  'results.metric.winrate': 'pnlDistributionCard',
}
initMetricCardInteractivity('metricsGrid', METRIC_TARGET_CARD)

function renderMetrics(r) {
  const metrics = [
    { key: 'results.metric.pnl_pct', value: r.pnlPercent, fmt: v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, cls: v => v >= 0 ? 'positive' : 'negative' },
    { key: 'results.metric.pnl_cumul', value: r.cumulativePnl, fmt: v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, cls: v => v >= 0 ? 'positive' : 'negative' },
    { key: 'results.metric.buy_hold_pct', value: r.buyHoldPercent, fmt: v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, cls: v => v >= 0 ? 'positive' : 'negative' },
    { key: 'results.metric.capital', value: r.finalCapital, fmt: v => `$${v.toFixed(2)}`, cls: () => 'neutral' },
    { key: 'results.metric.trades', value: r.totalTrades, fmt: v => v, cls: () => 'neutral' },
    { key: 'results.metric.winrate', value: r.winRate, fmt: v => `${v.toFixed(1)}%`, cls: v => v >= 50 ? 'positive' : 'negative' },
    { key: 'results.metric.maxdd', value: r.maxDrawdown, fmt: v => `-${v.toFixed(2)}%`, cls: () => 'negative' },
    { key: 'results.metric.sharpe', value: r.sharpeRatio, fmt: v => v.toFixed(2), cls: v => v >= 1.5 ? 'positive' : v >= 0 ? 'neutral' : 'negative' },
    { key: 'results.metric.profit_factor', value: r.profitFactor, fmt: v => v.toFixed(2), cls: v => v >= 1.75 ? 'positive' : v >= 1 ? 'neutral' : 'negative' },
    { key: 'results.metric.exposure', value: r.exposurePct, fmt: v => `${v.toFixed(1)}%`, cls: () => 'neutral' },
  ]
  document.getElementById('metricsGrid').innerHTML = metrics.map(m => {
    const formatted = m.value != null ? m.fmt(m.value) : '-'
    const cls = m.value != null ? m.cls(m.value) : 'neutral'
    const { cls: interCls, attrs } = metricCardInteractiveAttrs(m.key, METRIC_TARGET_CARD)
    return `<div class="metric-card${interCls}" ${attrs}>
      <div class="metric-label">${t(m.key)}</div>
      <div class="metric-value ${cls}">${formatted}</div>
    </div>`
  }).join('')
}


// Trades
function renderTrades(r, trades, totalTrades) {
  const count = trades.filter(tr => tr.side === 'sell').length
  const label = count < totalTrades
    ? `${count} / ${totalTrades} trades`
    : `${count} trade${count !== 1 ? 's' : ''}`
  document.getElementById('tradesCount').textContent = label
  if (r._tradeSampled) {
    document.getElementById('tradesCount').insertAdjacentHTML(
      'beforeend',
      ` <span class="tag tag-warning">${t('results.trades.sampled', { rate: r._tradeRate })}</span>`
    )
  }
  if (!trades.length) {
    document.getElementById('tradesList').innerHTML = `<div class="text-muted text-sm p-sm">${t('results.no_trades')}</div>`
    return
  }
  document.getElementById('tradesList').innerHTML += trades.map(tr => {
    const pnlClass = tr.pnl != null ? (tr.pnl >= 0 ? 'pnl-positive' : 'pnl-negative') : ''
    const pnlStr = tr.pnl != null ? (tr.pnl >= 0 ? '+' : '') + tr.pnl.toFixed(2) + '%' : '-'
    return `<div class="trade-row trade-${tr.side}">
      <span class="tag ${tr.side === 'buy' ? 'tag-success' : 'tag-danger'}">${t('results.trade.' + tr.side)}</span>
      <span class="text-muted text-sm">${fmtDateTime(tr.date)}</span>
      <span class="trade-price">$${tr.price?.toFixed(2) ?? '-'}</span>
      <span class="trade-qty text-muted text-sm">${tr.quantity?.toFixed(6) ?? '-'}</span>
      <span class="trade-value">$${tr.value?.toFixed(2) ?? '-'}</span>
      <span class="${pnlClass} trade-pnl">${pnlStr}</span>
    </div>`
  }).join('')
}

// Clone & run
document.getElementById('cloneAndRunBtn').addEventListener('click', async () => {
  if (!strategyId) return
  try {
    const { strategy } = await api(`/strategies/${strategyId}/clone`, { method: 'POST' })
    window.location.href = `/strategy-editor.html?id=${strategy.id}`
  } catch (e) { toast(t('error.' + e.code), 'error') }
})

document.getElementById('cloneOriginalBtn').addEventListener('click', async () => {
  if (!jobId) return
  try {
    const { strategy } = await api(`/strategies/jobs/${jobId}/clone-snapshot`, { method: 'POST' })
    window.location.href = `/strategy-editor.html?id=${strategy.id}`
  } catch (e) { toast(t('error.' + e.code), 'error') }
})

// Chart (TV-like)
document.getElementById('graphBtn').addEventListener('click', async () => {
  window.open(`/chart.html?jobId=${jobId}`, '_blank')
})