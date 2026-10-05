// v2 pet packs: 16 look-direction frames in atlas rows 9-10. Pure helpers,
// shared by the main process (cursor → frame) and the renderer (frame → cell).

/** Look frame index 0-15 (0 = up / 000°, clockwise in 22.5° steps) → atlas cell. */
export const lookCell = (index: number) => ({ row: 9 + Math.floor(index / 8), col: index % 8 });

/** Angle in degrees (0 = up, clockwise) → look frame index 0-15. */
export const lookIndex = (degrees: number) => Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16;
