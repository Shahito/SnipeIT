const urlParams = new URLSearchParams(location.search)
window._editId  = urlParams.get('id') ? parseInt(urlParams.get('id')) : null

document.getElementById('addTradingHourBtn').addEventListener('click', () => addTradingHourSlot())
document.getElementById('tabEntry').addEventListener('click', () => showTab('entry'))
document.getElementById('tabExit').addEventListener('click', () => showTab('exit'))

document.addEventListener('header:ready', async () => {
  applyToDOM()
  const today = new Date()
  const oneYearAgo = new Date(today); oneYearAgo.setFullYear(today.getFullYear() - 1)
  document.getElementById('fStartDate').value = oneYearAgo.toISOString().slice(0, 10)
  document.getElementById('fEndDate').value   = today.toISOString().slice(0, 10)

  document.getElementById('fBaseCoins').setSilent(['BTC'])
  document.getElementById('fQuoteCoins').setSilent(['USDT'])
  renderChipGroup('fTimeframeGroup', TIMEFRAMES_LIST, ['1h'])
  renderChipGroup('fSlTypeGroup', RISK_TYPES, ['percent'])
  renderChipGroup('fTpTypeGroup', RISK_TYPES, ['percent'])
  bindSweepChipGroups()
  bindCoinPickers()

  if (window._editId) {
    document.getElementById('pageTitle').textContent = t('editor.title.edit')
    await loadStrategy(window._editId)
  } else {
    // document.getElementById('fName').value = generateStrategyName()
    updatePairsPreview()
    conditions.entry = [[{ indicator: 'RSI', period: INDICATOR_DEFAULT_PERIOD['RSI'], operator: '<', value: 30 }]]
    conditions.exit  = [[{ indicator: 'RSI', period: INDICATOR_DEFAULT_PERIOD['RSI'], operator: '>', value: 70 }]]
    renderConditions(); updatePreview()
  }
})
initI18n()