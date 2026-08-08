/**
 * Mutation controls for the theme tests.
 *
 * WHY THIS EXISTS RATHER THAN A BEFORE/AFTER SNAPSHOT
 * --------------------------------------------------
 * Every fix in `theme.js` needs a test that fails against the code as it was
 * and passes against the code as it is. The obvious way to produce the "as it
 * was" half is to check out the previous revision -- which is not available
 * here: this project is untracked in the shared `F:\` git root, so there is no
 * prior commit of `theme.js` to diff against.
 *
 * The substitute is stronger in the way that matters. Each mutant reverses ONE
 * expression back to exactly what the review found, and the suite requires the
 * corresponding assertion to FAIL when it is applied. That does not merely show
 * the old code was broken; it shows the new test is capable of detecting this
 * specific defect and not something adjacent to it. An assertion that passes
 * under its own mutant is not testing what it claims, and the runner treats
 * that as a failure of the test, not of the code.
 *
 * Every `find` is asserted to occur exactly once in the source, so a rename or
 * a refactor breaks the mutant loudly instead of silently degrading it into a
 * no-op that "passes".
 */

const MUTANTS = {
  /* ---- F2 ------------------------------------------------------------ */

  /**
   * The already-dark guard as the review found it: gated on `stats.passes === 0`.
   * The only pass satisfying that is `runPass('boot')` at document_start, when
   * the sole stylesheet in the document is our own theme.css and it declares no
   * custom properties -- so the guard sees an empty palette, returns "not dark",
   * and is then locked out for the rest of the page's life.
   */
  'f2-guard-first-pass-only': [
    {
      find: 'if (!guardEvaluated && applied.size === 0) {',
      replace: 'if (applied.size === 0 && stats.passes === 0) {',
    },
  ],

  /**
   * The second half of F2: the no-growth branch overwriting a terminal state.
   * Three ladder passes after the guard fires, `skipped-already-dark` was
   * relabelled `settled` -- the one observable proving the guard worked was
   * erased by the scheduler.
   */
  'f2-state-clobbered': [
    {
      find: "if (!TERMINAL_STATES.has(stats.state)) stats.state = 'settled';",
      replace: "stats.state = 'settled';",
    },
  ],

  /**
   * The evidence floor relaxed away, i.e. the guard as "any pass where
   * `applied.size === 0`". The guard runs BEFORE the writes of its own pass, so
   * one mid-ladder pass whose visible fragment happens to be dark is enough to
   * latch it and disable the theme for the rest of the page's life. The floor
   * is what makes that impossible.
   */
  'f2-no-evidence-floor': [
    {
      find: 'const GUARD_MIN_EVIDENCE = 20;',
      replace: 'const GUARD_MIN_EVIDENCE = 1;',
    },
  ],

  /* ---- F4 ------------------------------------------------------------ */

  /**
   * No alias detection at all: `!applied.has(n)` is the only filter, as the
   * review found it. A `:root` alias sheet landing in a later pass resolves
   * through our own `important` override and is inverted a second time.
   */
  'f4-no-alias-check': [
    {
      find: 'const aliases = aliasesOfOurOverrides(todo, resolved, canon);',
      replace: 'const aliases = new Set();',
    },
  ],

  /**
   * The naive form of the F4 fix, which the review explicitly ruled out: treat
   * every value match as an alias, without asking the cascade whether the token
   * actually resolves through us. A genuine Maps token whose own literal value
   * equals one of our outputs -- `#181818` is both a real Maps colour and our
   * output for `#ffffff` -- is then skipped, and dark text stays dark on a dark
   * surface.
   */
  'f4-naive-value-match': [
    {
      find: 'if (after !== undefined && after !== resolved.get(name)) out.add(name);',
      replace: 'out.add(name);',
    },
  ],

  /* ---- F6 ------------------------------------------------------------ */

  /**
   * The cap as a lifetime budget rather than a consecutive-unproductive one.
   * Productive passes spend it, and the only reset lives in `redo()`, which
   * nothing reachable calls -- so a long-lived tab stops theming once it has
   * run 60 passes for any reason at all.
   */
  'f6-lifetime-pass-cap': [
    {
      find: 'if (unproductive >= MAX_UNPRODUCTIVE_PASSES) {',
      replace: 'if (stats.passes >= MAX_UNPRODUCTIVE_PASSES) {',
    },
  ],

  /* ---- settings ------------------------------------------------------ */

  /** theme.js as it was: settings read, then ignored. */
  'settings-ignored': [
    {
      find: 'const wantsChrome = (s) => s.enabled === true && s.darkChrome === true;',
      replace: 'const wantsChrome = () => true;',
    },
  ],

  /** Settings honoured at boot but not followed live. */
  'settings-no-live-updates': [
    {
      find: 'if (host.storage.onChanged && host.storage.onChanged.addListener) {',
      replace: 'if (false && host.storage.onChanged && host.storage.onChanged.addListener) {',
    },
  ],

  /**
   * The ordering hazard pointed the other way: fail LIGHT during the window
   * between theme.css painting and the settings read answering. This is the
   * mutant the no-white-flash assertion has to be able to see.
   */
  'flash-fails-light': [
    {
      find: "root.setAttribute('data-mapsnoir', 'pending');",
      replace: "root.setAttribute('data-mapsnoir', 'off');",
    },
  ],
};

export const MUTANT_NAMES = Object.keys(MUTANTS);

/**
 * Apply a named mutant to theme.js source.
 *
 * @param {string} source
 * @param {string} name
 * @returns {string}
 */
export function mutate(source, name) {
  const edits = MUTANTS[name];
  if (!edits) throw new Error(`unknown mutant: ${name}`);
  let out = source;
  for (const { find, replace } of edits) {
    const occurrences = out.split(find).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `mutant "${name}" expected exactly one occurrence of ${JSON.stringify(find)}, found ${occurrences}. ` +
        'theme.js has been refactored and this mutation control is no longer reversing what it claims.'
      );
    }
    out = out.split(find).join(replace);
  }
  if (out === source) throw new Error(`mutant "${name}" changed nothing`);
  return out;
}
