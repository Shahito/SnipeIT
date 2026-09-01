const isProd = !process.env.NODE_ENV ||
                process.env.NODE_ENV === 'production' ||
                process.env.NODE_ENV === 'prod'

const allowEmailAliases = process.env.ALLOW_EMAIL_ALIASES !== 'false'

module.exports = { isProd, allowEmailAliases }