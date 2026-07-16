const prisma = require('../utils/prisma')

const HEX_RE = /^#[0-9A-Fa-f]{6}$/

function validate(name, color) {
  if (!name || name.trim().length < 1) throw new Error('TAG_NAME_REQUIRED')
  if (name.trim().length > 32)         throw new Error('TAG_NAME_TOO_LONG')
  if (color && !HEX_RE.test(color))    throw new Error('TAG_COLOR_INVALID')
}

async function listTags(userId) {
  return prisma.tag.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { jobTags: true } } },
  })
}

async function createTag(userId, name, color = '#6c8eff') {
  validate(name, color)
  return prisma.tag.create({
    data: { userId, name: name.trim(), color },
  })
}

async function updateTag(id, userId, name, color) {
  const tag = await prisma.tag.findFirst({ where: { id, userId } })
  if (!tag) throw new Error('TAG_NOT_FOUND')
  validate(name ?? tag.name, color ?? tag.color)
  return prisma.tag.update({
    where: { id },
    data: {
      ...(name  !== undefined ? { name: name.trim() } : {}),
      ...(color !== undefined ? { color }              : {}),
    },
  })
}

async function deleteTag(id, userId) {
  const tag = await prisma.tag.findFirst({ where: { id, userId } })
  if (!tag) throw new Error('TAG_NOT_FOUND')
  await prisma.tag.delete({ where: { id } })
}

// --- Assigner / retirer des tags d'un job ---

async function setJobTags(jobId, userId, tagIds) {
  // Vérifier que le job appartient à l'user
  const job = await prisma.backtestJob.findFirst({
    where: { id: jobId, strategy: { userId } },
  })
  if (!job) throw new Error('JOB_NOT_FOUND')

  // Vérifier que tous les tagIds appartiennent à l'user
  const tags = await prisma.tag.findMany({ where: { id: { in: tagIds }, userId } })
  if (tags.length !== tagIds.length) throw new Error('TAG_NOT_FOUND')

  // Remplacer tous les tags du job
  await prisma.jobTag.deleteMany({ where: { jobId } })
  if (tagIds.length) {
    await prisma.jobTag.createMany({
      data: tagIds.map(tagId => ({ jobId, tagId })),
    })
  }
  return prisma.backtestJob.findUnique({
    where: { id: jobId },
    include: { jobTags: { include: { tag: true } } },
  })
}

module.exports = { listTags, createTag, updateTag, deleteTag, setJobTags }
