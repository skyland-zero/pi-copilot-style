# Changelog

## 0.5.1

- Fixed an edit row repainting itself forever: `remember()` compared the
  `{ additions, deletions }` object that `countDiff()` rebuilds on every render
  with `Object.is`, so a settled row kept requesting a repaint. An idle session
  with an edit in view redrew its whole transcript at the renderer's frame limit
  (~60 fps, about one full core on a long session); plain objects are now
  compared shallowly.

## 0.5.0

- `codemode` rows: `JS Run codemode script  3 calls  12 lines  1.4s`. The nested
  calls, the script itself and its output sit one `ctrl+o` away; failures show the
  tail. Attached through `registerToolRenderer`, so codemode's own tool definition
  (and every other tool's rendering) stays untouched.
- `/copilot-style preview` renders a codemode row alongside the shell and file rows.
