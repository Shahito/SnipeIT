// Exemple de controller protégé — à dupliquer pour tes features
async function profileController(req, res) {
  // req.user est disponible grâce au middleware authRequired
  res.json({ user: req.user })
}

module.exports = { profileController }
