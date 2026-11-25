# Blender I-Ninja Model Exporter

`export_inimodel.py` is a Blender 3.6+ add-on. Install it through **Edit → Preferences → Add-ons → Install from Disk**, select this file, enable it, then export from **File → Export → I-Ninja Model (.inimodel)**.

The `.inimodel` file is a ZIP_STORED bundle for the I-Ninja Editor. It contains a manifest, interleaved mesh data and optional TGA textures. The editor imports it as a persistent 3D-view asset and can emit a first native static-prop implementation into `10-00.LCS` in `10.vol`. Current game output is restricted to one opaque mesh/material, no collision and uniform positive scale. Other levels/material modes are not yet supported, and an in-game runtime check is still required.

## Material custom properties

On a Blender material, add these custom properties:

- `ininja_alpha_mode`: `OPAQUE`, `MASK`, or `BLEND`
- `ininja_blend_mode`: `normal`, `additive`, or `subtractive`
- `ininja_alpha_cutoff`: number between 0 and 1

The exporter reads one image connected to the Principled BSDF Base Color input. The image must be 4–512 pixels in each dimension and power-of-two; it is exported as a 32-bit TGA. Source alpha is preserved where available; RGB textures receive a fully opaque alpha channel. The add-on writes the uncompressed BGRA TGA bytes directly, so the output remains 32-bit regardless of the active scene render output settings. sRGB colour textures are converted from Blender scene-linear pixel values back to sRGB; Non-Color textures are kept unchanged.

The export dialog stores model-level collision metadata for the later native collision writer. Box and sphere metadata currently get a wireframe preview. `capsule` and `mesh` are retained as metadata only.

See `../CUSTOM-MODELS.md` for the data contract, editor steps and next implementation milestones.

## Level collision material tags

The level-export panel includes the 21 named raw-tag presets from the in-game debug text viewer plus a custom numeric field. Tags are assigned to selected collision faces through the `ininja_collision_tag` FACE INT attribute. The strings are debug labels; they do not assert friction or physics beyond what has been tested in-game. See `COLLISION-MATERIAL-TAG-REFERENCE.md` for the full list and the unknown meaning of the `0x0100` variants.
