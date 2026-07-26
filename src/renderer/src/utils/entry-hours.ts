/**
 * The hours field's own range rules.
 *
 * `UInputNumber` bounds its steppers by `min`/`max`, but a *typed* value is
 * unbounded until it commits: reka-ui's per-keystroke check deliberately
 * range-checks nothing (you have to be able to type `1` on the way to `12`),
 * and the clamp runs later, inside the component, where this form can neither
 * see it nor report it. So the cap is applied here too — on the value the user
 * actually typed, at the moment they leave the field.
 *
 * Pure, so the rules are unit-tested rather than inferred from a component.
 */

/** Smallest loggable slice — a quarter hour, matching the stepper's `step`. */
export const HOURS_MIN = 0.25

/**
 * Read what was typed into the hours box, or `null` when it isn't a number.
 *
 * Takes the raw `<input>` text rather than the component's model: the model
 * still holds the *previous* value at this point, which is the whole reason a
 * typed over-cap value can slip past. Whitespace and a stray trailing `.`
 * ("8." mid-type) are tolerated; anything else non-numeric is `null` — not 0,
 * which would silently rewrite the field to the minimum.
 */
export function parseTypedHours(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '' || !/^[0-9]*\.?[0-9]*$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

/**
 * `value` brought inside `[HOURS_MIN, max]`.
 *
 * Deliberately only clamps the ends — quarter-hour snapping stays the input's
 * job, so a typed `1.3` isn't rewritten twice (here *and* by the component) with
 * two different answers.
 */
export function clampEntryHours(value: number, max: number): number {
  return Math.min(max, Math.max(HOURS_MIN, value))
}
