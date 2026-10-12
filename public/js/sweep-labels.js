/**
 * sweep-labels.js
 * Translates a raw sweep-axis path (e.g. "conditions.entry[0][0].period")
 * into a readable label, based on definitionSnapshot (the condition context
 * at sweep launch time). The condition key schema must
 * mirror _refKeys() in condition-settings.js - keep them in sync if it changes.
 */
document.addEventListener('header:ready', async () => {
    const SWEEP_OPERATOR_LABELS = {
    '>': '>', '<': '<', '>=': '>=', '<=': '<=', '==': '==',
    cross_above: t('editor.cond.cross_above'),
    cross_below: t('editor.cond.cross_below'),
    }

    const SWEEP_TOP_LEVEL_LABELS = {
    positionSize:     t('editor.field.position_size'),
    timeframe:        t('editor.field.timeframe'),
    }

    // Sweep paths under exits.* / execution.* -> readable label
    function resolveExitLabel(path) {
    const m = path.match(/^exits\.(sl|tsl|tp)\.(value|type|order)$/)
    if (m) {
        const leg = t('exits.leg.' + m[1])
        if (m[2] === 'type') return t('sweep.param.exit_type', { leg })
        if (m[2] === 'order') return t('sweep.param.exit_order', { leg })
        return leg
    }
    // Regexes on purpose: quoted literals would be mistaken for i18n keys by the i18n usage test
    if (/^exits\.atrPeriod$/.test(path)) return t('editor.field.atr_period')
    if (/^execution\.slippage$/.test(path)) return t('exits.field.slippage')
    return null
    }

    function normalizeGroups(arr) {
    if (!arr || !arr.length) return []
    return Array.isArray(arr[0]) ? arr : [arr]
    }

    // "conditions.entry[0][0].value" -> { cond, field, subfield }
    function resolveConditionFromPath(path, definition) {
    const tokens = path.match(/[^.[\]]+/g) || []
    if (tokens[0] !== 'conditions') return null

    const type  = tokens[1]
    const gIdx  = parseInt(tokens[2])
    const rIdx  = parseInt(tokens[3])
    const field = tokens[4]
    const subfield = tokens[5] || null

    const groups = normalizeGroups(definition?.conditions?.[type])
    const cond = groups?.[gIdx]?.[rIdx]
    return cond ? { cond, field, subfield } : null
    }

    function indicatorName(cond, prefix) {
    return (prefix ? cond[`${prefix}Indicator`] : cond.indicator) || '?'
    }

    // "RSI(14)" / "EMA(20) [close]"
    function describeRef(cond, prefix) {
    const ind    = indicatorName(cond, prefix)
    const period = prefix ? cond[`${prefix}IndicatorPeriod`] : cond.period
    const source = prefix ? cond[`${prefix}IndicatorSource`] : cond.source
    let label = ind
    if (period != null && typeof period !== 'object') label += `(${period})`
    if (source != null && typeof source !== 'object') label += ` [${source}]`
    return label
    }

    function describeCombinedRef(cond, prefix) {
    const copKey  = prefix ? `${prefix}CombineOp` : 'combineOp'
    const cindKey = prefix ? `${prefix}CombineIndicator` : 'combineIndicator'
    const cperKey = prefix ? `${prefix}CombinePeriod` : 'combinePeriod'
    const csrcKey = prefix ? `${prefix}CombineSource` : 'combineSource'
    let label = describeRef(cond, prefix)
    if (cond[copKey]) {
        const combineRef = { indicator: cond[cindKey], period: cond[cperKey], source: cond[csrcKey] }
        label += ` ${cond[copKey]} ${describeRef(combineRef, '')}`
    }
    return label
    }

    // Mirrors the number/% toggle in condition-settings.js: valueMultiplier is
    // always stored as a plain multiplier, '%' is purely a display choice.
    function formatMultiplierValue(cond, value) {
    return cond.valueMultiplierMode === 'percent' ? `${value * 100}%` : `${value}`
    }


    function describeRule(cond) {
        const op = SWEEP_OPERATOR_LABELS[cond.operator] || cond.operator
        const v = cond.value
        const right = cond.valueIndicator ? describeRef(cond, 'value') : (v && typeof v === 'object' ? v.sweep.join('/') : v)
        return `${describeRef(cond, '')} ${op} ${right}`
    }

    function describeSweepAxis(path, definition) {
        const hit = resolveConditionFromPath(path, definition)
        if (!hit) return SWEEP_TOP_LEVEL_LABELS[path] || resolveExitLabel(path) || path

        const { cond, field, subfield } = hit
        switch (field) {
            case 'enabled': return describeRule(cond)
            case 'period': return `${indicatorName(cond, '')} - ${t('editor.cond.period')}`
            case 'source': return `${indicatorName(cond, '')} - ${t('editor.cond.source')}`
            case 'value':
            return `${describeRef(cond, '')} ${SWEEP_OPERATOR_LABELS[cond.operator] || cond.operator} ${t('editor.cond.fixed_value')}`
            case 'valueIndicatorPeriod':
            return `${indicatorName(cond, 'value')} - ${t('editor.cond.period')}`
            case 'valueIndicatorSource':
            return `${indicatorName(cond, 'value')} - ${t('editor.cond.source')}`
            case 'valueIndicator':
            return `${describeRef(cond, '')} ${SWEEP_OPERATOR_LABELS[cond.operator] || cond.operator} ${describeRef(cond, 'value')}`
            case 'valueMultiplier':
            return `${describeCombinedRef(cond, '')} ${SWEEP_OPERATOR_LABELS[cond.operator] || cond.operator} ${describeCombinedRef(cond, 'value')} × ${t('editor.cond.multiplier')}${cond.valueMultiplierMode === 'percent' ? ' (%)' : ''}`
            case 'settings':
            return `${indicatorName(cond, '')} - ${subfield || t('editor.cond.settings')}`
            default:
            return `${indicatorName(cond, '')} - ${field}`
        }
        }

    // PARAM=VALUE label (used in table rows and Best/Worst)
    function describeSweepValue(path, value, definition) {
    const hit = resolveConditionFromPath(path, definition)
    if (!hit) return `${SWEEP_TOP_LEVEL_LABELS[path] || resolveExitLabel(path) || path} = ${JSON.stringify(value)}`

    const { cond, field } = hit
    if (field === 'enabled')             return `${describeRule(cond)} : ${value ? t('editor.cond.state_on') : t('editor.cond.state_off')}`
    if (field === 'period')              return `${cond.indicator}(${value})`
    if (field === 'source')               return `${indicatorName(cond, '')}[${value}]`
    if (field === 'value')               return `${describeRef(cond, '')} ${SWEEP_OPERATOR_LABELS[cond.operator] || cond.operator} ${value}`
    if (field === 'valueIndicatorPeriod') return `${cond.valueIndicator}(${value})`
    if (field === 'valueIndicatorSource') return `${indicatorName(cond, 'value')}[${value}]`
    if (field === 'valueMultiplier')      return `${describeCombinedRef(cond, '')} ${SWEEP_OPERATOR_LABELS[cond.operator] || cond.operator} ${describeCombinedRef(cond, 'value')} × ${formatMultiplierValue(cond, value)}`

    return `${describeSweepAxis(path, definition)} = ${JSON.stringify(value)}`
    }

    window.describeSweepAxis  = describeSweepAxis
    window.describeSweepValue = describeSweepValue
})