# Changelog

## 0.5.0

- `codemode` rows: `JS Run codemode script  3 calls  12 lines  1.4s`. The nested
  calls, the script itself and its output sit one `ctrl+o` away; failures show the
  tail. Attached through `registerToolRenderer`, so codemode's own tool definition
  (and every other tool's rendering) stays untouched.
- `/copilot-style preview` renders a codemode row alongside the shell and file rows.
