// new file — src/utils/env.js

const isProd = !process.env.NODE_ENV ||
                process.env.NODE_ENV === 'production' ||
                process.env.NODE_ENV === 'prod'

module.exports = { isProd }