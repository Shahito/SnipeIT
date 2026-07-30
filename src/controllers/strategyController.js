const {
  listStrategies, getStrategy, createStrategy,
  updateStrategy, cloneStrategy, cloneFromSnapshot, deleteStrategy,
} = require('../services/strategyService')

const KNOWN_CODES = new Set([
  'STRATEGY_NOT_FOUND', 'NAME_REQUIRED', 'NAME_TOO_LONG', 'PAIRS_INVALID', 'TIMEFRAME_INVALID',
  'DATE_INVALID', 'DATE_RANGE_INVALID', 'CAPITAL_INVALID', 'POSITION_SIZE_INVALID',
  'FEE_INVALID', 'TRADING_HOURS_INVALID', 'RISK_TYPE_INVALID', 'ATR_PERIOD_INVALID',
  'CONDITIONS_INVALID', 'MISSING_FIELDS', 'TRAILING_STOP_INVALID', 'SWEEP_AXIS_EMPTY',
  'JOB_NOT_FOUND', 'SNAPSHOT_NOT_FOUND',
])

function errorCode(e, fallback = 'UNKNOWN') {
  return KNOWN_CODES.has(e.message) ? e.message : fallback
}

async function listController(req, res) {
  try {
    const strategies = await listStrategies(req.user.id)
    res.json({ strategies })
  } catch (e) {
    res.status(500).json({ error: errorCode(e) })
  }
}

async function getController(req, res) {
  try {
    const strategy = await getStrategy(parseInt(req.params.id), req.user.id)
    res.json({ strategy })
  } catch (e) {
    res.status(404).json({ error: errorCode(e) })
  }
}

async function createController(req, res) {
  try {
    const { name, description, pairs, timeframe, startDate, endDate,
            initialCapital, positionSize, stopLoss, takeProfit, conditions } = req.body

    if (!name || !pairs || !timeframe || !startDate || !endDate || !conditions)
      return res.status(400).json({ error: 'MISSING_FIELDS' })

    const strategy = await createStrategy(req.user.id, req.body)
    res.status(201).json({ strategy })
  } catch (e) {
    res.status(400).json({ error: errorCode(e) })
  }
}

async function updateController(req, res) {
  try {
    const strategy = await updateStrategy(parseInt(req.params.id), req.user.id, req.body)
    res.json({ strategy })
  } catch (e) {
    res.status(400).json({ error: errorCode(e) })
  }
}

async function cloneController(req, res) {
  try {
    const strategy = await cloneStrategy(parseInt(req.params.id), req.user.id)
    res.status(201).json({ strategy })
  } catch (e) {
    res.status(400).json({ error: errorCode(e) })
  }
}

async function cloneFromSnapshotController(req, res) {
  try {
    const strategy = await cloneFromSnapshot(parseInt(req.params.jobId), req.user.id)
    res.status(201).json({ strategy })
  } catch (e) {
    const code = errorCode(e)
    res.status(code === 'JOB_NOT_FOUND' || code === 'SNAPSHOT_NOT_FOUND' ? 404 : 400).json({ error: code })
  }
}

async function deleteController(req, res) {
  try {
    await deleteStrategy(parseInt(req.params.id), req.user.id)
    res.json({ success: true })
  } catch (e) {
    res.status(404).json({ error: errorCode(e) })
  }
}

module.exports = {
  listController, getController, createController,
  updateController, cloneController, cloneFromSnapshotController, deleteController,
}
