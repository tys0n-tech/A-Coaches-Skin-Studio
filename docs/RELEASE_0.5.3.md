# Coaches Skin Studio 0.5.3

## Truck GLB preview improvements

- Keep imported ETS2 truck GLBs at their original meter scale instead of stretching them to coach length.
- Fit the camera and inspection views to the imported model bounds.
- Add neutral fallback colors for untextured SCS materials so cab exports remain legible in preview.
- Identify cab-only GLBs and missing embedded textures in the interface.
- Label the provided `cab_s_high` model as the Scania S 2016 High Roof cab.

This GLB contains only the cab; chassis and wheels must be imported as separate model parts for a complete truck preview.
