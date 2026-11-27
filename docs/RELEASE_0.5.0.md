# v0.5.0 — Truck skin workflow

- Added a separate Truck mode with imported GLB models.
- Added UV layout PNG export for the selected mesh materials and UV channels.
- Truck UV layouts use the selected DDS texture dimensions from an existing ZIP-based SCS/ZIP skin package.
- Existing skin package export replaces the selected DDS and preserves the other archive entries.
- Added a dimension check to prevent replacing a truck texture with a different-size DDS.
- Truck mode requires a matching truck GLB and working skin package; no truck model assets are bundled and generating truck definitions from scratch is not supported.
- Studio projects now remember the vehicle type and selected skin package path.
