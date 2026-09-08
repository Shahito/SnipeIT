// Field length guardrails for Strategy.
// STRATEGY_NAME_MAX_LENGTH        : hard cap on `name` (VARCHAR(191) in MySQL is just the
//                                   column's technical ceiling, not a sane limit for a
//                                   short label on a card). Also used to truncate the
//                                   generated name in cloneStrategy/cloneFromSnapshot so
//                                   their suffix (" (copie)", " (snapshot)") can't push a
//                                   name that was already near the cap over it.
// STRATEGY_DESCRIPTION_MAX_LENGTH : description now has a hard cap too, don't leave it
//                                   open-ended.
//
// Keep these in sync with the *_CLIENT copies in public/js/strategy-form.js /
// public/js/form-validate.js (same convention as SWEEP_WARNING_THRESHOLD_CLIENT).
module.exports = {
  STRATEGY_NAME_MAX_LENGTH: 60,
  STRATEGY_DESCRIPTION_MAX_LENGTH: 500,
}