# Coaches Skin Studio v0.4.4 — Window-to-body seams

Fixes two separate problems visible in window artwork previews:

- Decals on the opposite side were rendered through the bus, creating floating fragments. Preview decals now render only on their outward-facing side.
- A separate full-frame window design was clipped at the sill, losing artwork that crossed onto the body. That portion is now composited into the body texture in both the preview and exported .scs file.

Full-frame window artwork uses the same 4096 × 2048 or 8192 × 4096 atlas as the body. Transparent portions leave existing paint unchanged. Clearing the separate window file restores the original body texture. DDS body input is decoded for composition when necessary.

The original PNG/DDS artwork files are not overwritten. Existing exports need to be exported again to include the missing body portion.

The reported Lignite body PNG and Frame 2 window artwork were reproduced and visually checked from both sides in the preview. Actual in-game lighting and final appearance still require checking in ETS2.

Download the Windows x64 ZIP, extract the entire folder, and open Coaches Skin Studio.exe. SHA256SUMS.txt is included; the Windows app remains unsigned.
