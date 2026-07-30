const { SWEEP_MAX_COMBINATIONS } = require('../config/sweep')

// Un axe sweep est repéré par la forme exacte : { sweep: [v1, v2, ...] }
// (un objet avec UNIQUEMENT cette clé). Toute autre forme d'objet est traversée normalement.
function isSweepMarker(node) {
  return (
    node !== null &&
    typeof node === 'object' &&
    !Array.isArray(node) &&
    Object.keys(node).length === 1 &&
    Array.isArray(node.sweep)
  )
}

// Parcourt récursivement `definition` (hors `pairs`, traité à part) et retourne
// la liste des axes trouvés : [{ path: "conditions.entry[0].period", values: [14,15,16] }, ...]
function findSweepAxes(node, path = '') {
  let axes = []

  if (isSweepMarker(node)) {
    if (node.sweep.length === 0) throw new Error('SWEEP_AXIS_EMPTY')
    axes.push({ path, values: node.sweep })
    return axes
  }

  if (Array.isArray(node)) {
    node.forEach((child, i) => {
      axes = axes.concat(findSweepAxes(child, `${path}[${i}]`))
    })
    return axes
  }

  if (node !== null && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      const childPath = path ? `${path}.${key}` : key
      axes = axes.concat(findSweepAxes(node[key], childPath))
    }
    return axes
  }

  return axes
}

// Remplace la valeur à `path` (notation "a.b[0].c") dans un clone de `root` par `value`.
function setAtPath(root, path, value) {
  const tokens = path.match(/[^.[\]]+/g)
  let cur = root
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i]
    cur = cur[/^\d+$/.test(t) ? parseInt(t) : t]
  }
  const last = tokens[tokens.length - 1]
  cur[/^\d+$/.test(last) ? parseInt(last) : last] = value
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

// Point d'entrée. `strategyLikeDefinition` = objet stratégie (pairs[] + champs
// éventuellement porteurs de marqueurs {sweep:[...]}).
// Retourne { totalRuns, axes, combinations }
//   combinations[i] = { pair, paramValues: {path: value, ...}, resolved: <définition 100% scalaire> }
function resolveSweep(strategyLikeDefinition) {
  const { pairs, ...rest } = strategyLikeDefinition

  if (!Array.isArray(pairs) || pairs.length === 0) throw new Error('PAIRS_INVALID')

  const paramAxes = findSweepAxes(rest) // hors pairs
  const allAxes = [{ path: 'pairs', values: pairs }, ...paramAxes]

  const totalRuns = allAxes.reduce((acc, axis) => acc * axis.values.length, 1)
  if (totalRuns > SWEEP_MAX_COMBINATIONS) {
    const err = new Error('SWEEP_TOO_LARGE')
    err.totalRuns = totalRuns
    throw err
  }

  const combinations = []
  const indices = new Array(allAxes.length).fill(0)

  for (let i = 0; i < totalRuns; i++) {
    const resolved = deepClone(rest)
    const paramValues = {}
    let pair = null

    allAxes.forEach((axis, axisIdx) => {
      const value = axis.values[indices[axisIdx]]
      if (axis.path === 'pairs') {
        pair = value
      } else {
        setAtPath(resolved, axis.path, value)
        paramValues[axis.path] = value
      }
    })

    combinations.push({ pair, paramValues, resolved })

    // incrémentation façon compteur à bases mixtes (odometer)
    for (let a = allAxes.length - 1; a >= 0; a--) {
      indices[a]++
      if (indices[a] < allAxes[a].values.length) break
      indices[a] = 0
    }
  }

  return { totalRuns, axes: allAxes, combinations }
}

module.exports = { resolveSweep, findSweepAxes, isSweepMarker, SWEEP_MAX_COMBINATIONS }
