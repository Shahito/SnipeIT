const {
  listCategories, createCategory, updateCategory, deleteCategory,
} = require('../services/pairCategoryService')

const KNOWN_CODES = new Set(['NAME_REQUIRED', 'PAIRS_INVALID', 'CATEGORY_NOT_FOUND'])

function errorCode(e, fallback = 'UNKNOWN') {
  return KNOWN_CODES.has(e.message) ? e.message : fallback
}

async function listController(req, res) {
  try {
    const categories = await listCategories(req.user.id)
    res.json({ categories })
  } catch (e) {
    res.status(500).json({ error: errorCode(e) })
  }
}

async function createController(req, res) {
  try {
    const category = await createCategory(req.user.id, req.body)
    res.status(201).json({ category })
  } catch (e) {
    res.status(400).json({ error: errorCode(e) })
  }
}

async function updateController(req, res) {
  try {
    const category = await updateCategory(parseInt(req.params.id), req.user.id, req.body)
    res.json({ category })
  } catch (e) {
    const code = errorCode(e)
    res.status(code === 'CATEGORY_NOT_FOUND' ? 404 : 400).json({ error: code })
  }
}

async function deleteController(req, res) {
  try {
    await deleteCategory(parseInt(req.params.id), req.user.id)
    res.json({ success: true })
  } catch (e) {
    res.status(404).json({ error: errorCode(e) })
  }
}

module.exports = { listController, createController, updateController, deleteController }
