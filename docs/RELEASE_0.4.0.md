# Coaches Skin Studio v0.4.0

## Side-window liveries for every included coach

Preview window artwork, save a full-size window guide, and export body paint plus side-window decals together in one .scs file for:

- Scania Touring 12.9 m and 13.7 m
- MAN Lion’s Coach 12.1 m and 13.9 m
- Volvo 9700 DD 14.3 m, including both decks

Each model has its own window mesh, cabin attachment transform, and body-aligned 4096 × 2048 UV layout. Transparent PNG and DDS window imports are supported. Legacy compact Scania 13.7 m artwork can still be imported and converted.

## Vehicle switching

A loading indicator replaces the temporary block-shaped vehicle. Rapid changes keep the most recent selection, discard outdated model loads, and release their graphics resources. If a model cannot be loaded, use the retry button.

## Download

Download the Windows x64 ZIP, extract the entire folder, and open Coaches Skin Studio.exe. Models, templates, window export assets, and the image converter are included.

## Validation

- Unit and package dependency checks passed for all five variants.
- Desktop tests passed for all five bundled models, template export, window-guide export, DDS window import, and combined .scs export.
- Rapid vehicle switching passed.
- The packaged Windows application loaded the included models and recovered through retry after a simulated missing model.

In-game appearance, material lighting, vehicle attachment, and removal still need validation in ETS2. The Windows application is unsigned; SHA256SUMS.txt is provided to verify the download.
