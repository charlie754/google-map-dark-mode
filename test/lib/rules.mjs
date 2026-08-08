/**
 * Reading and offline-evaluating the shipped declarativeNetRequest ruleset.
 *
 * The rules are read from `extension/rules/dark-map.json` -- the source of
 * truth, not a copy. A copy would be a second thing to keep in sync and the
 * first thing to drift.
 *
 * The RE2 syntax our rules use is a strict subset of JavaScript regex syntax, so
 * evaluating them with `RegExp` reproduces what Chrome will do for these
 * patterns. That is an approximation in general -- RE2 is leftmost-longest for
 * some constructs where JS backtracking is leftmost-first -- and it is why the
 * offline check is never the only check: the live gate observes the redirect
 * Chrome actually performed, and the 2 KB trap test asks Chrome's own compiled
 * copy via testMatchOutcome.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const RULES_PATH = path.join(ROOT, 'extension', 'rules', 'dark-map.json');

export function loadRules(file = RULES_PATH) {
  const rules = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(rules)) throw new Error(`${file} is not an array of rules`);
  return rules;
}

/**
 * DNR writes back-references as `\1`; String.replace wants `$1`. Escape any
 * literal `$` first so a `$` in the substitution cannot be read as a group ref.
 * (Same transformation the shipped background.js performs -- deliberately
 * re-derived here rather than imported, so a bug in one does not silently
 * validate the other.)
 */
export function dnrSubstitutionToJs(substitution) {
  return substitution.replace(/\$/g, '$$$$').replace(/\\(\d)/g, '$$$1');
}

/** @returns {{matched: boolean, result: string|null}} */
export function applyRule(rule, url) {
  const filter = rule?.condition?.regexFilter;
  const substitution = rule?.action?.redirect?.regexSubstitution;
  if (typeof filter !== 'string' || typeof substitution !== 'string') {
    return { matched: false, result: null };
  }
  const re = new RegExp(filter);
  if (!re.test(url)) return { matched: false, result: null };
  return { matched: true, result: url.replace(re, dnrSubstitutionToJs(substitution)) };
}

/** Which rule ids match this URL, in priority order as shipped. */
export function matchingRuleIds(rules, url) {
  return rules.filter((r) => applyRule(r, url).matched).map((r) => r.id);
}

/**
 * Apply the ruleset the way the browser would: highest-priority match wins, one
 * redirect per pass, repeat until nothing matches or the loop budget is spent.
 * @returns {{result: string, hops: Array<{ruleId:number,from:string,to:string}>, looped: boolean}}
 */
export function applyRuleset(rules, url, maxHops = 8) {
  const hops = [];
  let current = url;
  const seen = new Set([url]);
  for (let i = 0; i < maxHops; i++) {
    const candidates = rules
      .map((r) => ({ rule: r, out: applyRule(r, current) }))
      .filter((c) => c.out.matched)
      .sort((a, b) => (b.rule.priority ?? 1) - (a.rule.priority ?? 1));
    if (candidates.length === 0) return { result: current, hops, looped: false };
    const { rule, out } = candidates[0];
    if (out.result === current) return { result: current, hops, looped: true };
    hops.push({ ruleId: rule.id, from: current, to: out.result });
    if (seen.has(out.result)) return { result: out.result, hops, looped: true };
    seen.add(out.result);
    current = out.result;
  }
  return { result: current, hops, looped: true };
}
