const prisma = require('../utils/prisma')

const PAIR_RE = /^[A-Z]+\/[A-Z]+$/

function validatePairs(pairs) {
  if (!Array.isArray(pairs)) throw new Error('PAIRS_INVALID')
  pairs.forEach(p => { if (typeof p !== 'string' || !PAIR_RE.test(p)) throw new Error('PAIRS_INVALID') })
}

async function listCategories(userId) {
  return prisma.pairCategory.findMany({
    where: { userId },
    orderBy: { name: 'asc' },
    include: { items: true },
  })
}

async function createCategory(userId, { name, color, pairs = [] }) {
  if (!name || name.trim().length < 2) throw new Error('NAME_REQUIRED')
  validatePairs(pairs)

  return prisma.pairCategory.create({
    data: {
      userId,
      name:  name.trim(),
      color: color || '#6c8eff',
      items: { create: [...new Set(pairs)].map(pair => ({ pair })) },
    },
    include: { items: true },
  })
}

async function updateCategory(id, userId, { name, color, pairs }) {
  const existing = await prisma.pairCategory.findFirst({ where: { id, userId } })
  if (!existing) throw new Error('CATEGORY_NOT_FOUND')
  if (pairs !== undefined) validatePairs(pairs)

  return prisma.$transaction(async (tx) => {
    if (pairs !== undefined) {
      await tx.pairCategoryItem.deleteMany({ where: { categoryId: id } })
      await tx.pairCategoryItem.createMany({
        data: [...new Set(pairs)].map(pair => ({ categoryId: id, pair })),
      })
    }
    return tx.pairCategory.update({
      where: { id },
      data: {
        name:  name  !== undefined ? name.trim() : undefined,
        color: color !== undefined ? color : undefined,
      },
      include: { items: true },
    })
  })
}

async function deleteCategory(id, userId) {
  const existing = await prisma.pairCategory.findFirst({ where: { id, userId } })
  if (!existing) throw new Error('CATEGORY_NOT_FOUND')
  await prisma.pairCategory.delete({ where: { id } })
  return true
}

module.exports = { listCategories, createCategory, updateCategory, deleteCategory }
