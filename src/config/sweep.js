// Garde-fou anti-explosion combinatoire.
// SWEEP_WARNING_THRESHOLD : au-delà, l'API renvoie warning:true (le front doit demander confirmation).
// SWEEP_MAX_COMBINATIONS  : au-delà, l'API rejette (SWEEP_TOO_LARGE).
module.exports = {
  SWEEP_WARNING_THRESHOLD: 200,
  SWEEP_MAX_COMBINATIONS: 1000,
}
