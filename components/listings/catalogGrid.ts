// Shared catalog mosaic: two columns on a phone, three on tablet, fluid
// auto-fill once there is room for a 13rem cell. Gaps match the Flutter grid.

export const CATALOG_TILE_GRID =
  'grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 md:gap-4 lg:[grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]';
