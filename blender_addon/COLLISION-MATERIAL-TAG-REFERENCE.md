# Collision material tag reference — Step 112

Source: user-provided results from the game's debug text material viewer (2026-11-23). The strings below are transcribed as reported; spelling and capitalization are preserved. They are debug labels, not independently verified descriptions of the physical collision response.

| Raw 16-bit value | Debug viewer text | Notes |
|---|---|---|
| `0x0000` | *(no text displayed)* | Viewer returned no string.
| `0x0001` | Can't run on this | Base value.
| `0x0002` | Grass | Base value.
| `0x0003` | Gravel | Base value.
| `0x0004` | Gravel | Separate raw value with same displayed text as `0x0003`.
| `0x0005` | Wood (Rough) | Base value.
| `0x0006` | Wood (Polished) | Base value.
| `0x0007` | Stone | Base value.
| `0x0008` | Marble | Base value.
| `0x0009` | Carpet | Base value.
| `0x000A` | Metal (Solid) | This is also the user-tested standable and wall-running tag on custom geometry.
| `0x000B` | Metal (Hollow) | Base value.
| `0x000C` | Glass | Base value.
| `0x000D` | Water | Base value.
| `0x000E` | Speed Boost | Base value.
| `0x000F` | Slippy | Base value.
| `0x0010` | Sticky | Base value.
| `0x0011` | *(no text displayed)* | Viewer returned no string.
| `0x0101` | Can't run on this | Displays same text as `0x0001`; meaning of the extra `0x0100` component is unknown.
| `0x0105` | Wood (Rough) | Displays same text as `0x0005`; meaning of the extra `0x0100` component is unknown.
| `0x010A` | Metal (Solid) | Displays same text as `0x000A`; meaning of the extra `0x0100` component is unknown.

## Implementation notes

- The editor offers all 21 values in the Advanced raw material tags datalist. The full 16-bit value is written to the CollMesh; values with the high byte set must not be truncated.
- `0x0000` and `0x0011` are selectable even though the debug viewer showed no text for them.
- The UI's descriptions for the `0x0101`, `0x0105`, and `0x010A` options explicitly state that the additional `0x0100` component's meaning is unknown.
- The values are independently assignable to upward-facing, near-vertical side-facing, and other/downward/underside triangles. This release does not infer or hard-code friction, footsteps, traction, or other physics from the debug names.
- This is a label/reference update only. No collision geometry, material tag encoding, class registration, or VOL patch logic changed in Step 112.
