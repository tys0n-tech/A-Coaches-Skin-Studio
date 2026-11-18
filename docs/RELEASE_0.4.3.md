# Coaches Skin Studio v0.4.3 — Color and 8K export

Fixes overly dark paint from PNG files exported by Figma. The converter now preserves sRGB on input and output, preventing an extra gamma conversion when ETS2 samples color textures.

A reproduced sample changed blue RGB (0,100,159) into approximately (0,32,90) in previous exports. The corrected BC3 output is approximately (0,101,156), within normal block-compression error.

Supports full-frame 4096 × 2048 and 8192 × 4096 textures for both body paint and side-window artwork on all five coach variants. Window processing keeps the imported resolution.

For sharper artwork, keep your Figma frame at 4096 × 2048 and export the vector design as PNG at 2x. Import that 8192 × 4096 image and export the .scs again.

Existing DDS files are preserved as supplied. Existing .scs files need to be exported again to use corrected color conversion. In-game lighting and material reflection still affect appearance.

Download the Windows x64 ZIP, extract the entire folder, and open Coaches Skin Studio.exe. The Windows application is unsigned; SHA256SUMS.txt is included.
