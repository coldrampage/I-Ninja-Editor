# I-Ninja level-model interchange bundle (`.inilevel`), version 1

This document describes the Blender export interchange format introduced in Step 113. It is **not** a native retail LCM or a loadable VOL resource. The editor's native LCM writer is a later milestone.

## Container

A `.inilevel` file is a ZIP archive written with `ZIP_STORED` (no compression). Required entries:

- `manifest.json`
- `render.bin`

Optional entries:

- `collision.bin` — present when one or more objects have the `Collision Mesh` role.
- `textures/*.tga` — referenced by exported materials.

JSON is UTF-8. Binary records are little-endian.

## Coordinate convention

The exporter evaluates Blender modifiers, applies each object's world transform, multiplies by `gameUnitScale`, then maps Blender Z-up coordinates to the I-Ninja/editor convention:

`(x, y, z) -> (x, z, -y)`

The transform is baked into positions; the manifest records that policy. The exporter does not repair winding for negative-determinant/mirrored transforms. Apply transforms and verify face normals before export where mirrored scales are involved.

## `manifest.json`

Top-level fields:

| Field | Meaning |
|---|---|
| `format` | Literal `ininja-level-model` |
| `version` | Integer `1` |
| `name` | Export filename stem |
| `coordinateSystem` | `i-ninja-y-up` |
| `units` | `game-units` |
| `transformPolicy` | Human-readable statement that object transforms and scale are baked |
| `render` | Render stream layout and mesh ranges |
| `collision` | Optional separate collision stream description and per-object ranges |
| `materials` | Material/texture metadata referenced by render parts |
| `sourceObjects` | Blender object names, roles and exported part counts |
| `nativeOutputStatus` | States that this is an interchange bundle pending native LCM support |

### Render stream

`render.bin` consists of mesh parts described in `render.meshes`. Each part stores a contiguous vertex array followed by a contiguous index array. `vertexOffset` and `indexOffset` are byte offsets from the start of `render.bin`; `vertexCount` and `indexCount` are element counts. Indices are local to the part's vertex array.

Each vertex is 24 bytes (`<3f4B2f`):

| Byte offset | Type | Contents |
|---:|---|---|
| 0 | 3 × float32 | Position X, Y, Z |
| 12 | 4 × uint8 | Diffuse colour B, G, R, A |
| 16 | 2 × float32 | UV U, V |

The layout string is `position3-bgra8-uv2-f32`; index format is `uint16-triangles`. Parts are grouped by source object and material slot. This is a triangle-list interchange layout; a native writer must convert/reorder it into the retail LCM draw-part/triangle-strip representation and create the corresponding vertex-buffer and material resources.

The colour bytes come from a Blender mesh colour attribute on the `POINT` or `CORNER` domain (`FLOAT_COLOR` or `BYTE_COLOR`). A named attribute can be selected in the export dialog; blank uses the active colour attribute. If no attribute exists, the exporter writes opaque white. The exporter **does not bake lighting**: the user must bake or paint lighting into the colour attribute in Blender before export. Values are quantized directly to BGRA8; no extra gamma conversion is applied at this stage.

`materials` contains the material name, base colour, alpha/blend metadata, double-sided state and optional TGA path. The texture exporter retains the add-on's current 32-bit TGA constraints (power-of-two dimensions, 4–512 pixels). A later native LCM writer must translate these records into the game's actual material/texture resource structures; the interchange metadata is not itself a native material block.

### Collision stream

`collision.bin` is a separate stream built only from Blender objects whose I-Ninja Export Role is `Collision Mesh`. Render-role objects are never implicitly reused as collision.

Each triangle consists of three 16-byte records (`<3fI`): float32 XYZ followed by uint32 flags. The first two records have `0x80` (valid); the third has `0x80 | 0x40` (valid + triangle-end). The raw 16-bit material tag occupies bits 31–16 of every record. Thus a tag such as `0x0105` is preserved as a full 16-bit value.

This is the same record layout parsed by the editor's retail LCM collision reader. It is emitted as independent triangle triplets for interchange; the future native writer must build the final collision record order, relocations, bounds and KD tree appropriate for the target LCM.

Per-face tag resolution order:

1. FACE-domain INT mesh attribute (default name `ininja_collision_tag`), when present.
2. The Blender material's `ininja_collision_tag` property (a negative value means inherit the export default).
3. The export dialog's default collision tag (default `0x0001`).

Every final tag must be in the unsigned 16-bit range `0x0000`–`0xFFFF`. `collision.materialTagTriangleCounts` gives a summary; `collision.objects` records each source collision object's range in record/triangle units.

The exporter keeps Blender's loop-triangle winding. It does not close open meshes, generate a convex hull, correct inconsistent normals, remove degenerates, or rebuild the KD tree. The collision object should be a deliberate, reasonably low-poly collision mesh with consistent outward-facing normals.

## Blender workflow

1. Make visible level geometry and assign its I-Ninja Export Role to `Render Mesh`.
2. Make a separate simplified collision object and assign its role to `Collision Mesh`.
3. Bake lighting into a `POINT` or `CORNER` colour attribute on render geometry (or paint the attribute). Select that attribute in the export dialog, or make it active.
4. For collision faces, create an integer mesh attribute named `ininja_collision_tag` on the `FACE` domain. In Edit Mode, select faces, choose a named material preset (which fills the numeric tag field), or enter a custom 16-bit decimal value in the I-Ninja panel, and use **Assign I-Ninja Collision Tag to Selected Faces**. You can also assign a material-level fallback property or use the export-wide default.
5. Select the relevant objects and use **File → Export → I-Ninja Level Model (.inilevel)**.

The known tag names discovered with the in-game debug text viewer are documented in `COLLISION-MATERIAL-TAG-REFERENCE.md`. The exported tag itself is numeric; labels are editorial notes, not encoded in `collision.bin`.

## Version 1 limits

- No editor `.inilevel` importer or viewport preview yet.
- No native LCM or VOL builder support yet; do not insert this ZIP into a retail VOL.
- No native kind-`0x23` vertex-buffer or kind-`0x20` draw-part writer, material wrappers, native texture resources, relocation links or render queues.
- No strip stitching or native collision KD-tree/bounds generation.
- No per-face render material mapping beyond normal material-slot grouping; per-face tags apply to the separate collision mesh.
- No automatic baked-light generation; colour attributes must already contain the desired lighting.
- No automatic collision cleanup, mesh closure or winding correction.
- Parts are limited to 65,535 unique vertices because the interchange index format is uint16.

The exported bundle is an authoring/interchange milestone only. In-game compatibility cannot be assessed until a native LCM writer consumes it and a small test level is built and exercised in the game.
