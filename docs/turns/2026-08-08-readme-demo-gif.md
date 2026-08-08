# Turn report — README demo GIF, and the hot-apply round it follows

**Date:** 2026-08-08
**Agent seat:** Claude (architect / chair)
**Status:** Complete
**Authority:** Operator request — "push it to git, with gif of
`C:\Users\IRP\Downloads\Google Maps - Google Chrome-preview.mp4` 30fps"

## 1. Objective

Convert the operator's screen recording to a 30fps GIF, put it in the
repository, and push. This report also closes out the preceding round (hover
animation + hot-apply, commit `b38889b`), which shipped without its own `.md`.

## 2. Plan / routing

No lanes. Mechanical media conversion plus a one-line README edit; delegating it
would have cost more in spec-writing than in doing it.

## 3. What changed

| Path | Change |
|---|---|
| `docs/media/demo.gif` | new — 640×360, 30fps, 482 frames, 18.8 MB |
| `README.md` | demo GIF above the existing tile comparison, with a caption |
| `tools/mp4-to-gif.py` | new — the script that produced the asset |

Commit `6fed519`, pushed; `origin/main` is at `6fed519`.

## 4. Verification evidence

- Source probed: `963 frames, 60.0 fps, 16.05 s, 1920×1080`.
- Output re-opened with PIL: `482 frames, size (640, 360), duration 30`.
  482 = 963 // 2 + 1, i.e. every second source frame — a true 30fps decimation.
- Four frames decoded back to PNG and read visually (0/120/240/400): the panel,
  the three switches, the Ko-fi and GitHub buttons and the dark map are all
  legible at 640px.
- `git show --stat HEAD` confirms exactly three files, `19,751,147` bytes of GIF.
- `git push` reported `b38889b..6fed519  main -> main`.

Size decisions were measured, not guessed:

| encoding | size |
|---|---|
| per-frame ADAPTIVE palette, 960px | 100.9 MB |
| global palette + Floyd–Steinberg, 720px | 45.8 MB |
| global palette, no dither, 720px | 22.9 MB |
| global palette, no dither, 640px (**shipped**) | 18.8 MB |
| the above + explicit transparent-delta pass, 640px | 18.8 MB (no gain) |

The delta pass gained nothing because the map pans continuously — almost every
pixel genuinely changes, so there is no static region to elide. Recorded in the
script's docstring so it is not retried.

## 5. Gate A / Gate B

- **Gate A (hygiene):** pass — file committed, tracked, not ignored, decodes.
- **Gate B (product):** pass for the stated objective — the GIF renders on the
  GitHub README path and shows the feature. No code path changed.

## 6. Residual hazards

- **MEDIUM — 18.8 MB in git history, permanently.** Every clone pays it. It was
  a deliberate trade: 480px roughly halves the size but makes the switch labels
  unreadable, which is the one thing the recording exists to show. If the repo
  size becomes a problem the fix is a release-asset URL, not a rewrite.
- **LOW — no ffmpeg or gifsicle on this machine.** The cv2+PIL path is a
  substitute, not an equal; a proper `gifsicle -O3 --lossy` pass would likely cut
  the file materially. `tools/mp4-to-gif.py` documents this.
- **LOW — the recording is windowed**, so roughly a quarter of each frame is
  desktop wallpaper. Cropping was considered and rejected: the browser window's
  left edge moves during the clip (measured — the change bbox is the full frame),
  so a fixed crop risks cutting content.

## 7. Not done / open items

- `npm run gate:live:firefox` — Firefox has still never been driven with the
  widget or any of the last two rounds of fixes. Unchanged from the prior turn.
- The GIF is not covered by any test; nothing asserts the README's image path
  resolves. Low value, but it is a real gap.

## 8. Go / No-Go

**GO** for the operator's request. It is documentation only and touches no
shipped code path; `test:full` state from `b38889b` is unaffected.

**Not** a greenlight for a store resubmission — that would need the Firefox gate.

## 9. Suggested next moves

- **P1** — `npm run gate:live:firefox`, to close the standing Firefox gap before
  any further store work. **DO NOT claim cross-browser parity until this runs.**
- **P2** — if repo weight matters, move the GIF to a GitHub release asset and
  reference it by URL.

## 10. Artefacts

- This report: `docs/turns/2026-08-08-readme-demo-gif.md`
- Prior round (hover animation, hot-apply reload, `node --check` build guard):
  commit `b38889b`; its reasoning is in the commit body, which is why this
  report does not restate it in full.
- WIKI N/A — no `wiki/` tree in this repository.
