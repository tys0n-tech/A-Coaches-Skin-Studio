# Coaches Skin Studio 0.5.4

## Fix truck GLB import crash

- Fix a temporal-dead-zone error while reading imported model metadata. This caused the GLB to appear in the viewport, then the import workflow to fail before clearing its loading overlay.
- Keep the truck model title and cab-only / missing-texture notices working after import.
