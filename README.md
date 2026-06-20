# Mapwright

A small local low top-down tile map editor.

Open `index.html` in a browser, import a tileset image, choose tile dimensions, and paint on the map canvas.

Current features:

- Tileset import and tile picking
- Multiple tilesets in one project
- Object PNG stamps for characters, houses, trees, and props
- Top-down and isometric map projection modes
- Ground, detail, above, and collision layers
- Stack layer for piling multiple tile sprites on the same cell
- Brush, erase, fill, box, pick, pan, and zoom tools
- Ctrl+Z undo for the last paint stroke
- Space + mouse drag canvas panning
- Resizeable map grid
- Block-type tagging (solid, translucent, plantation, light) for type-aware shadows
- Lighting preview with directional sun shadows and emissive light sources
- Save/load project JSON
- Export clean map JSON
- Export clean map PNG

The project save includes the imported tileset image as embedded data so it can be loaded again later.

Use `Gap` only for transparent or padding pixels between tiles in the source image. Clicks inside that gap are ignored so they do not accidentally select the next tile.

To mix tilesets, use `Add images`, select a tileset from the list, then click a tile in that sheet. Painted cells remember both the tileset and tile number.

To place free PNG objects, use `Add PNGs` in the Objects panel, select an object, choose `Stamp`, then click or drag on the map. Stamp mode ignores existing object selection and does not leave new objects selected, so you can paint object runs without accidentally moving or resizing a nearby object. `Scale` changes the size for newly stamped objects. `Offset X` and `Offset Y` nudge newly stamped objects. With `Object Snap` off, the object is centered on your click. With `Object Snap` on, the selected `Object Pivot` snaps to the selected tile anchor: `Center`, `North Edge`, `East Edge`, `South Edge`, or `West Edge`. Turn on `Snap As Tile` for wall chunks or any 64x64 object that should sit exactly where a floor tile would sit; in that mode snap point and object pivot are ignored. The Erase tool removes the top object first when you click on one.

Placed objects can be selected by clicking them on the canvas. Drag a selected object to move it, drag its bottom-right handle to resize it, or edit `Obj W` / `Obj H` in the Objects panel. If `Object Snap` is on while dragging, the moved object snaps to the selected anchor. `Duplicate Object` makes a matched copy one iso tile over, which is useful for building even wall runs. `Delete Object` removes the selected object.

Use the `Top` / `Iso` buttons in the Map panel to switch projection. Use `Top` for rectangular tiles and `Iso` for diamond tiles. `Flat Iso` changes iso row spacing without cutting off the tile art. `Iso Step H` controls the iso footprint height; leave it at `0` for automatic `Tile W / 2`, or set it manually if your diamond footprint is different.

For the 256x256 iso sheet with 4 columns and 4 rows, use `Tile W = 64` and `Tile H = 64`.

Use the `Box` tool to drag out a perimeter, which is the clean path for room walls. Put grass/floor on `Ground`, switch to `Stack` or `Above`, select the wall/block tile, choose `Box`, then drag from one corner of the room to the opposite corner. It paints only the outline cells, including corners, instead of filling the whole room into a slab.

Use `Layer Lift` and `Iso Anchor` to make the active tile layer render upward. This is the 2D isometric wall trick: the tile still belongs to the same cell, but it draws higher on screen. For skewed wall faces, try painting on `Stack` with `Iso Anchor = Back Edge`, `Layer Lift = 0`, `Wall Height = 1`, and `Height Step = 0`.

Use the `Stack` layer when you want to build wall height. `Wall Height` controls how many copies Brush, Box, and Fill add at once. `Height Step` controls how far upward each copy is drawn. Brush adds the selected tile to the top of the stack, Erase removes the top stacked tile, Pick selects the top stacked tile, and Fill replaces matching stacks with the selected wall height.

Newly painted tiles remember their `Iso Anchor` and `Height Step`. When you change `Wall Height`, `Height Step`, or `Iso Anchor`, matching copies of the selected tile on the active layer retune automatically. `Layer Lift` is layer-wide and moves the whole active layer live, which is useful while tuning a wall up or down.

## Block types and lighting

The editor is universal across textures, so it cannot guess what a tile is made of. The `Block Type` control in the Tileset panel lets you classify the selected tile so the renderer knows how it should cast shadow. Pick a tile, then tag it:

- `Solid` (dirt, marble, stone): casts a full, dark cast shadow.
- `Glass` / translucent (water, glass): casts a colored, slightly distorted shadow tinted by the tile's own color.
- `Plant` / plantation (foliage): casts a broken-up, dappled shadow that lets light filter through the leaves.
- `Light` (bulbs, light blocks): casts no shadow and instead emits a colored glow that brightens nearby cells and washes out their shadows.
- `None` (default): treated as flat floor and casts nothing, so ground tiles do not shadow themselves.

Tagged tiles show a colored dot in the tileset grid. Classifications are stored per tileset tile and saved with the project (and included in the exported `map.json`, so a game engine can read each tile's `tileTypes` entry).

Turn on `Lighting Preview` in the Lighting panel to see the shadow pass. Only the height layers (`Detail`, `Stack`, `Above`) cast shadows, and a `Stack` block casts a longer shadow the taller it is; light sources emit from any layer. `Sun Angle` sets the shadow direction in degrees, `Shadow Len` sets how far shadows stretch (percent of a tile), and `Light Radius` sets the glow size for light blocks. The lighting pass is also baked into the exported PNG when the preview is on.
