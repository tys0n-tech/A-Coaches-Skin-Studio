# Coaches Skin Studio v0.4.2 — SCS export hotfix

Fixes exported mods being rejected by ETS2. Versions 0.4.0 and 0.4.1 generated a 13-character unit-name component for paint jobs and window accessories; the game permits a maximum of 12.

- Body-only and combined body/window exports now use valid unit names on all five coach variants.
- The original archive filenames and accessory paths are retained so corrected exports replace the previous files.
- Export validates unit names before writing a package.
- Regression tests cover declarations, suitability references, and compatibility with previous filenames.

Already exported files must be exported again with v0.4.2 and replace the old .scs file. Updating the application alone does not repair existing exports. Enable the corrected mod, then select the paint job again in the vehicle workshop.

The reported Lignite export has also been repaired locally with its texture and model payloads unchanged.

Validation: unit/package tests and desktop export tests passed for all five variants. See docs/QA_CHECKLIST.md for game-validation details.

Download the Windows x64 ZIP, extract the entire folder, and open Coaches Skin Studio.exe. SHA256SUMS.txt is included. The Windows app remains unsigned.
