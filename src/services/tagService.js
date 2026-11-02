const prisma = require('../utils/prisma')
const { MAX_TAGS } = require('../config/quotas')

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
  if (await prisma.tag.count({ where: { userId } }) >= MAX_TAGS) throw new Error('QUOTA_EXCEEDED')
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

// Assign / remove tags from a job

async function setJobTags(jobId, userId, tagIds) {
  // Check that the job belongs to the user
  const job = await prisma.backtestJob.findFirst({
    where: { id: jobId, strategy: { userId, deletedAt: null } },
  })
  if (!job) throw new Error('JOB_NOT_FOUND')

  // Positive integers only, duplicates collapsed
  if (!tagIds.every(id => Number.isInteger(id) && id > 0)) throw new Error('TAG_NOT_FOUND')
  const ids = [...new Set(tagIds)]

  // Check that all tagIds belong to the user
  const tags = await prisma.tag.findMany({ where: { id: { in: ids }, userId } })
  if (tags.length !== ids.length) throw new Error('TAG_NOT_FOUND')

  // Replace all the job's tags in one transaction
  const ops = [prisma.jobTag.deleteMany({ where: { jobId } })]
  if (ids.length) {
    ops.push(prisma.jobTag.createMany({ data: ids.map(tagId => ({ jobId, tagId })) }))
  }
  await prisma.$transaction(ops)
  return prisma.backtestJob.findUnique({
    where: { id: jobId },
    include: { jobTags: { include: { tag: true } } },
  })
}

module.exports = { listTags, createTag, updateTag, deleteTag, setJobTags }
