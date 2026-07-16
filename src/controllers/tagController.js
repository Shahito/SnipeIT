const { listTags, createTag, updateTag, deleteTag, setJobTags } = require('../services/tagService')

const KNOWN = new Set(['TAG_NAME_REQUIRED','TAG_NAME_TOO_LONG','TAG_COLOR_INVALID','TAG_NOT_FOUND','JOB_NOT_FOUND','MISSING_FIELDS'])
const code  = (e, fb = 'UNKNOWN') => KNOWN.has(e.message) ? e.message : fb

async function listController(req, res) {
  try { res.json({ tags: await listTags(req.user.id) }) }
  catch (e) { res.status(500).json({ error: code(e) }) }
}

async function createController(req, res) {
  try {
    const { name, color } = req.body
    if (!name) return res.status(400).json({ error: 'MISSING_FIELDS' })
    res.status(201).json({ tag: await createTag(req.user.id, name, color) })
  } catch (e) { res.status(400).json({ error: code(e) }) }
}

async function updateController(req, res) {
  try {
    const { name, color } = req.body
    res.json({ tag: await updateTag(parseInt(req.params.id), req.user.id, name, color) })
  } catch (e) { res.status(400).json({ error: code(e) }) }
}

async function deleteController(req, res) {
  try {
    await deleteTag(parseInt(req.params.id), req.user.id)
    res.json({ success: true })
  } catch (e) { res.status(404).json({ error: code(e) }) }
}

async function setJobTagsController(req, res) {
  try {
    const { tagIds } = req.body
    if (!Array.isArray(tagIds)) return res.status(400).json({ error: 'MISSING_FIELDS' })
    const job = await setJobTags(parseInt(req.params.jobId), req.user.id, tagIds)
    res.json({ job })
  } catch (e) { res.status(400).json({ error: code(e) }) }
}

module.exports = { listController, createController, updateController, deleteController, setJobTagsController }
