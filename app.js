const APP_VERSION = "help-tooltips-1";

const state = {
  tileW: 64,
  tileH: 64,
  margin: 0,
  spacing: 0,
  mapW: 30,
  mapH: 20,
  projection: "orthogonal",
  isoFlat: true,
  isoStepH: 0,
  stackCount: 1,
  stackRise: 0,
  zoom: 1,
  offsetX: 24,
  offsetY: 24,
  activeTileset: 0,
  selectedTile: 0,
  activeObject: 0,
  objectScale: 100,
  objectOffsetX: 0,
  objectOffsetY: 0,
  objectSnap: false,
  objectSnapAsTile: false,
  objectSnapPoint: "center",
  objectPivot: "bottom-center",
  nextObjectId: 1,
  tool: "paint",
  layer: "ground",
  layerLift: { ground: 0, detail: 0, stack: 0, above: 0 },
  layerIsoAnchor: { ground: "origin", detail: "origin", stack: "origin", above: "origin" },
  tilesets: [],
  objectImages: [],
  objects: [],
  selectedObjectId: null,
  objectDragMode: null,
  objectDragStart: null,
  dragging: false,
  panning: false,
  showGrid: false,
  spaceDown: false,
  lastPointer: null,
  lastPaintCell: null,
  boxStartCell: null,
  boxPreviewCell: null,
  undoStack: [],
  currentStroke: null,
  layers: {}
};

const layerNames = ["ground", "detail", "stack", "above", "collision"];
const mapCanvas = document.querySelector("#mapCanvas");
const mapCtx = mapCanvas.getContext("2d");
const tilesetCanvas = document.querySelector("#tilesetCanvas");
const tilesetCtx = tilesetCanvas.getContext("2d");
const wrap = document.querySelector("#canvasWrap");
const statusEl = document.querySelector("#status");
const tilesetList = document.querySelector("#tilesetList");
const objectList = document.querySelector("#objectList");

function blankLayer(fill = -1) {
  return Array.from({ length: state.mapH }, () => Array(state.mapW).fill(fill));
}

function blankStackLayer() {
  return Array.from({ length: state.mapH }, () => Array.from({ length: state.mapW }, () => []));
}

function resetLayers() {
  state.layers = {
    ground: blankLayer(-1),
    detail: blankLayer(-1),
    stack: blankStackLayer(),
    above: blankLayer(-1),
    collision: blankLayer(0)
  };
}

function setStatus(text) {
  statusEl.textContent = text;
}

function syncTileInputs() {
  document.querySelector("#tileW").value = state.tileW;
  document.querySelector("#tileH").value = state.tileH;
}

function autoDetectTileSize(image) {
  if (state.tilesets.length > 0) return;
  if (image.width === 256 && image.height === 256) {
    state.tileW = 64;
    state.tileH = 64;
    syncTileInputs();
    setStatus("Auto tile size 64x64");
  }
}

function activeTileset() {
  return state.tilesets[state.activeTileset] ?? null;
}

function selectedRef() {
  return `${state.activeTileset}:${state.selectedTile}`;
}

function selectedTileEntry() {
  return {
    set: state.activeTileset,
    tile: state.selectedTile,
    lift: 0,
    anchor: state.layerIsoAnchor?.[state.layer] ?? "origin",
    rise: state.stackRise
  };
}

function parseTileRef(value) {
  if (value === -1 || value === null || value === undefined) return null;
  if (typeof value === "number") return { set: 0, tile: value };
  if (typeof value === "string") {
    const parts = value.split(":").map(Number);
    if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      return { set: parts[0], tile: parts[1] };
    }
  }
  if (typeof value === "object" && Number.isFinite(value.set) && Number.isFinite(value.tile)) {
    return { set: value.set, tile: value.tile };
  }
  return null;
}

function parseTileStack(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeTileEntry).filter(Boolean);
}

function normalizeTileEntry(value) {
  const ref = parseTileRef(value);
  if (!ref) return null;
  if (typeof value === "object") {
    return {
      set: ref.set,
      tile: ref.tile,
      lift: Number(value.lift ?? 0),
      anchor: value.anchor ?? "origin",
      rise: Number(value.rise ?? 0)
    };
  }
  return { set: ref.set, tile: ref.tile, lift: 0, anchor: "origin", rise: 0 };
}

function cloneCellValue(value) {
  if (Array.isArray(value)) return value.map(item => ({ ...item }));
  if (value && typeof value === "object") return { ...value };
  return value;
}

function resizeCanvases() {
  mapCanvas.width = wrap.clientWidth;
  mapCanvas.height = wrap.clientHeight;
  drawMap();
}

function isoOrigin(tileDrawW) {
  return (state.mapH - 1) * tileDrawW / 2;
}

function cellToScreen(x, y, tileDrawW, tileDrawH) {
  if (state.projection === "isometric") {
    const cellH = isoCellHeight(tileDrawW, tileDrawH);
    return {
      x: (x - y) * tileDrawW / 2 + isoOrigin(tileDrawW),
      y: (x + y) * cellH / 2
    };
  }
  return { x: x * tileDrawW, y: y * tileDrawH };
}

function isoCellHeight(tileDrawW, tileDrawH) {
  if (state.projection === "isometric" && state.isoFlat) {
    const drawScale = state.tileW > 0 ? tileDrawW / state.tileW : 1;
    return state.isoStepH > 0 ? state.isoStepH * drawScale : Math.min(tileDrawH, tileDrawW / 2);
  }
  return tileDrawH;
}

function isoSourceTopHeight(src) {
  return src.h;
}

function tileSourceRect(tileId, tilesetIndex = state.activeTileset) {
  const set = state.tilesets[tilesetIndex];
  if (!set) return null;
  const col = tileId % set.tilesPerRow;
  const row = Math.floor(tileId / set.tilesPerRow);
  return {
    x: state.margin + col * (state.tileW + state.spacing),
    y: state.margin + row * (state.tileH + state.spacing),
    w: state.tileW,
    h: state.tileH
  };
}

function selectedTileCanvas() {
  const set = activeTileset();
  const src = tileSourceRect(state.selectedTile);
  if (!set || !src) return null;
  const canvas = document.createElement("canvas");
  canvas.width = state.tileW;
  canvas.height = state.tileH;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(set.image, src.x, src.y, src.w, src.h, 0, 0, state.tileW, state.tileH);
  return { canvas, name: set.name };
}

function shadePolygon(ctx, points, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawIsoTopFromTexture(ctx, texture, cellX, cellY, w, h) {
  const topH = Math.min(h / 2, w / 2);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(cellX, cellY);
  ctx.transform(w / (2 * texture.width), topH / (2 * texture.width), -w / (2 * texture.height), topH / (2 * texture.height), w / 2, 0);
  ctx.drawImage(texture, 0, 0);
  ctx.restore();
}

function drawIsoLeftFaceFromTexture(ctx, texture, cellX, cellY, w, h) {
  const topH = Math.min(h / 2, w / 2);
  const sideH = h - topH;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(cellX, cellY);
  ctx.transform(w / (2 * texture.width), topH / (2 * texture.width), 0, sideH / texture.height, 0, topH / 2);
  ctx.drawImage(texture, 0, 0);
  ctx.restore();
  shadePolygon(ctx, [
    { x: cellX, y: cellY + topH / 2 },
    { x: cellX + w / 2, y: cellY + topH },
    { x: cellX + w / 2, y: cellY + h },
    { x: cellX, y: cellY + h - topH / 2 }
  ], "rgba(0,0,0,0.18)");
}

function drawIsoRightFaceFromTexture(ctx, texture, cellX, cellY, w, h) {
  const topH = Math.min(h / 2, w / 2);
  const sideH = h - topH;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(cellX, cellY);
  ctx.transform(w / (2 * texture.width), -topH / (2 * texture.width), 0, sideH / texture.height, w / 2, topH);
  ctx.drawImage(texture, 0, 0);
  ctx.restore();
  shadePolygon(ctx, [
    { x: cellX + w / 2, y: cellY + topH },
    { x: cellX + w, y: cellY + topH / 2 },
    { x: cellX + w, y: cellY + h - topH / 2 },
    { x: cellX + w / 2, y: cellY + h }
  ], "rgba(0,0,0,0.28)");
}

function generateSkewTileset() {
  const source = selectedTileCanvas();
  if (!source) {
    setStatus("Select a tile first");
    return;
  }
  const w = state.tileW;
  const h = state.tileH;
  const out = document.createElement("canvas");
  out.width = w * 4;
  out.height = h;
  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  drawIsoTopFromTexture(ctx, source.canvas, 0, 0, w, h);
  drawIsoLeftFaceFromTexture(ctx, source.canvas, w, 0, w, h);
  drawIsoRightFaceFromTexture(ctx, source.canvas, w * 2, 0, w, h);
  drawIsoLeftFaceFromTexture(ctx, source.canvas, w * 3, 0, w, h);
  drawIsoRightFaceFromTexture(ctx, source.canvas, w * 3, 0, w, h);
  drawIsoTopFromTexture(ctx, source.canvas, w * 3, 0, w, h);
  addTileset(`skewed-${source.name}-tile-${state.selectedTile}.png`, out.toDataURL("image/png"));
  setStatus("Generated skewed tile variants");
}

// Render one iso face of an arbitrary object PNG onto its own transparent canvas.
function objectFaceDataUrl(image, faceFn, w, h) {
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  faceFn(ctx, image, 0, 0, w, h);
  return out.toDataURL("image/png");
}

function generateSkewObject() {
  const source = state.objectImages[state.activeObject];
  if (!source) {
    setStatus("Select an object first");
    return;
  }
  const w = source.image.width;
  const h = source.image.height;
  const base = source.name.replace(/\.[^.]+$/, "");
  addObjectImage(`${base}-iso-left.png`, objectFaceDataUrl(source.image, drawIsoLeftFaceFromTexture, w, h));
  addObjectImage(`${base}-iso-right.png`, objectFaceDataUrl(source.image, drawIsoRightFaceFromTexture, w, h));
  addObjectImage(`${base}-iso-top.png`, objectFaceDataUrl(source.image, drawIsoTopFromTexture, w, h));
  setStatus("Generated skewed object variants");
}

function drawTileset() {
  const set = activeTileset();
  tilesetCtx.clearRect(0, 0, tilesetCanvas.width, tilesetCanvas.height);
  if (!set) {
    tilesetCanvas.width = 256;
    tilesetCanvas.height = 256;
    tilesetCtx.fillStyle = "#a9b2ba";
    tilesetCtx.font = "14px Segoe UI, sans-serif";
    tilesetCtx.fillText("Add one or more tilesets", 48, 128);
    return;
  }

  tilesetCanvas.width = Math.max(256, set.image.width);
  tilesetCanvas.height = Math.max(256, set.image.height);
  tilesetCtx.imageSmoothingEnabled = false;
  tilesetCtx.drawImage(set.image, 0, 0);

  tilesetCtx.strokeStyle = "rgba(126, 200, 165, 0.55)";
  tilesetCtx.lineWidth = 1;
  for (let i = 0; i < set.tileCount; i++) {
    const rect = tileSourceRect(i);
    tilesetCtx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w, rect.h);
  }

  if (set.tileCount > 0) {
    state.selectedTile = Math.min(state.selectedTile, set.tileCount - 1);
    const selected = tileSourceRect(state.selectedTile);
    tilesetCtx.strokeStyle = "#f1b96a";
    tilesetCtx.lineWidth = 3;
    tilesetCtx.strokeRect(selected.x + 1.5, selected.y + 1.5, selected.w - 2, selected.h - 2);
  }
}

function recalcTilesets() {
  for (const set of state.tilesets) {
    const usableW = set.image.width - state.margin;
    const usableH = set.image.height - state.margin;
    set.tilesPerRow = Math.max(1, Math.floor((usableW + state.spacing) / (state.tileW + state.spacing)));
    const rows = Math.max(1, Math.floor((usableH + state.spacing) / (state.tileH + state.spacing)));
    set.tileCount = set.tilesPerRow * rows;
  }
  const set = activeTileset();
  if (set) state.selectedTile = Math.min(state.selectedTile, set.tileCount - 1);
  renderTilesetList();
  drawTileset();
  drawMap();
}

function renderTilesetList() {
  tilesetList.innerHTML = "";
  state.tilesets.forEach((set, index) => {
    const item = document.createElement("button");
    item.className = `tileset-item${index === state.activeTileset ? " active" : ""}`;
    item.type = "button";
    item.dataset.index = String(index);
    item.innerHTML = `<span>${set.name}</span><small>${set.tileCount || 0} tiles</small>`;
    tilesetList.appendChild(item);
  });
}

function renderObjectList() {
  objectList.innerHTML = "";
  state.objectImages.forEach((object, index) => {
    const item = document.createElement("button");
    item.className = `tileset-item${index === state.activeObject ? " active" : ""}`;
    item.type = "button";
    item.dataset.index = String(index);
    item.innerHTML = `<img class="object-thumb" src="${object.src}" alt=""><span>${object.name}</span><small>${object.image.width}x${object.image.height}</small>`;
    objectList.appendChild(item);
  });
}

function drawMap() {
  mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
  mapCtx.imageSmoothingEnabled = false;

  const tileDrawW = state.tileW * state.zoom;
  const tileDrawH = state.tileH * state.zoom;

  mapCtx.save();
  mapCtx.translate(Math.round(state.offsetX), Math.round(state.offsetY));
  drawMapTiles(mapCtx, tileDrawW, tileDrawH);
  drawObjects(mapCtx, state.zoom);

  for (let y = 0; y < state.mapH; y++) {
    for (let x = 0; x < state.mapW; x++) {
      if (state.layers.collision[y][x] === 1) {
        if (state.projection === "isometric") {
          const cellH = isoCellHeight(tileDrawW, tileDrawH);
          const p = cellToScreen(x, y, tileDrawW, tileDrawH);
          mapCtx.fillStyle = "rgba(217, 111, 111, 0.42)";
          mapCtx.beginPath();
          mapCtx.moveTo(p.x + tileDrawW / 2, p.y);
          mapCtx.lineTo(p.x + tileDrawW, p.y + cellH / 2);
          mapCtx.lineTo(p.x + tileDrawW / 2, p.y + cellH);
          mapCtx.lineTo(p.x, p.y + cellH / 2);
          mapCtx.closePath();
          mapCtx.fill();
          mapCtx.strokeStyle = "rgba(217, 111, 111, 0.95)";
          mapCtx.stroke();
          continue;
        }
        mapCtx.fillStyle = "rgba(217, 111, 111, 0.42)";
        mapCtx.fillRect(x * tileDrawW, y * tileDrawH, tileDrawW, tileDrawH);
        mapCtx.strokeStyle = "rgba(217, 111, 111, 0.95)";
        mapCtx.strokeRect(x * tileDrawW + 0.5, y * tileDrawH + 0.5, tileDrawW - 1, tileDrawH - 1);
      }
    }
  }

  if (state.showGrid) drawGrid(mapCtx, tileDrawW, tileDrawH);
  drawBoxPreview(mapCtx, tileDrawW, tileDrawH);
  mapCtx.restore();
}

function boxCells(a, b) {
  if (!a || !b) return [];
  const minX = Math.max(0, Math.min(a.x, b.x));
  const maxX = Math.min(state.mapW - 1, Math.max(a.x, b.x));
  const minY = Math.max(0, Math.min(a.y, b.y));
  const maxY = Math.min(state.mapH - 1, Math.max(a.y, b.y));
  const seen = new Set();
  const cells = [];
  const add = (x, y) => {
    const key = `${x}:${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    cells.push({ x, y });
  };
  for (let x = minX; x <= maxX; x++) {
    add(x, minY);
    add(x, maxY);
  }
  for (let y = minY + 1; y < maxY; y++) {
    add(minX, y);
    add(maxX, y);
  }
  return cells;
}

function drawBoxPreview(ctx, tileDrawW, tileDrawH) {
  if (state.tool !== "box" || !state.boxStartCell || !state.boxPreviewCell) return;
  ctx.save();
  ctx.strokeStyle = "#f1b96a";
  ctx.lineWidth = 2;
  const cellH = isoCellHeight(tileDrawW, tileDrawH);
  for (const cell of boxCells(state.boxStartCell, state.boxPreviewCell)) {
    const p = cellToScreen(cell.x, cell.y, tileDrawW, tileDrawH);
    ctx.beginPath();
    if (state.projection === "isometric") {
      ctx.moveTo(p.x + tileDrawW / 2, p.y);
      ctx.lineTo(p.x + tileDrawW, p.y + cellH / 2);
      ctx.lineTo(p.x + tileDrawW / 2, p.y + cellH);
      ctx.lineTo(p.x, p.y + cellH / 2);
      ctx.closePath();
    } else {
      ctx.rect(p.x, p.y, tileDrawW, tileDrawH);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawObjects(ctx, scale) {
  const orderedObjects = [...state.objects].sort((a, b) => {
    const aDepth = a.snapCell ? a.snapCell.x + a.snapCell.y : (a.y + a.h) / Math.max(1, state.tileH);
    const bDepth = b.snapCell ? b.snapCell.x + b.snapCell.y : (b.y + b.h) / Math.max(1, state.tileH);
    if (aDepth !== bDepth) return aDepth - bDepth;
    return (a.snapCell?.x ?? a.x) - (b.snapCell?.x ?? b.x);
  });
  for (const object of orderedObjects) {
    const source = state.objectImages[object.imageIndex];
    if (!source) continue;
    const x = Math.round(object.x * scale);
    const y = Math.round(object.y * scale);
    const w = Math.round(object.w * scale);
    const h = Math.round(object.h * scale);
    ctx.drawImage(source.image, x, y, w, h);
    if (object.id === state.selectedObjectId) {
      ctx.save();
      ctx.strokeStyle = "#f1b96a";
      ctx.lineWidth = Math.max(1, 2 * scale);
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = "#f1b96a";
      const handle = Math.max(8, 10 * scale);
      ctx.fillRect(x + w - handle, y + h - handle, handle, handle);
      ctx.restore();
    }
  }
}

function drawMapTiles(ctx, tileDrawW, tileDrawH) {
  const cells = [];
  for (let y = 0; y < state.mapH; y++) {
    for (let x = 0; x < state.mapW; x++) cells.push({ x, y });
  }
  if (state.projection === "isometric") {
    cells.sort((a, b) => {
      const depth = a.x + a.y - (b.x + b.y);
      if (depth !== 0) return depth;
      return a.x - b.x;
    });
  }
  for (const layerName of ["ground", "detail", "stack", "above"]) {
    for (const { x, y } of cells) {
        const entries = layerName === "stack"
          ? parseTileStack(state.layers.stack[y][x])
          : [normalizeTileEntry(state.layers[layerName][y][x])].filter(Boolean);
        for (let stackIndex = 0; stackIndex < entries.length; stackIndex++) {
          const entry = entries[stackIndex];
          const set = state.tilesets[entry.set];
          if (!set) continue;
          const src = tileSourceRect(entry.tile, entry.set);
          if (!src) continue;
          const screen = cellToScreen(x, y, tileDrawW, tileDrawH);
          const dx = Math.round(screen.x);
          const stackRise = layerName === "stack" ? entry.rise * stackIndex * (tileDrawW / state.tileW) : 0;
          const layerLift = ((state.layerLift?.[layerName] ?? 0) + (entry.lift ?? 0)) * (tileDrawW / state.tileW);
          const anchorLift = layerIsoAnchorLift(entry.anchor, tileDrawW, tileDrawH);
          const dy = Math.round(screen.y - stackRise - layerLift - anchorLift);
          const dw = Math.round(tileDrawW);
          const dh = Math.round(tileDrawH);
          ctx.drawImage(set.image, src.x, src.y, src.w, src.h, dx, dy, dw, dh);
        }
    }
  }
}

function layerIsoAnchorLift(anchor, tileDrawW, tileDrawH) {
  if (state.projection !== "isometric") return 0;
  const cellH = isoCellHeight(tileDrawW, tileDrawH);
  if (anchor === "front") return Math.max(0, tileDrawH - cellH);
  if (anchor === "back") return tileDrawH;
  return 0;
}

function drawGrid(ctx, tileDrawW, tileDrawH) {
  ctx.strokeStyle = "rgba(255,255,255,0.13)";
  ctx.lineWidth = 1;
  if (state.projection === "isometric") {
    const cellH = isoCellHeight(tileDrawW, tileDrawH);
    for (let y = 0; y < state.mapH; y++) {
      for (let x = 0; x < state.mapW; x++) {
        const p = cellToScreen(x, y, tileDrawW, tileDrawH);
        ctx.beginPath();
        ctx.moveTo(p.x + tileDrawW / 2, p.y);
        ctx.lineTo(p.x + tileDrawW, p.y + cellH / 2);
        ctx.lineTo(p.x + tileDrawW / 2, p.y + cellH);
        ctx.lineTo(p.x, p.y + cellH / 2);
        ctx.closePath();
        ctx.stroke();
      }
    }
    return;
  }
  for (let x = 0; x <= state.mapW; x++) {
    ctx.beginPath();
    ctx.moveTo(x * tileDrawW + 0.5, 0);
    ctx.lineTo(x * tileDrawW + 0.5, state.mapH * tileDrawH);
    ctx.stroke();
  }
  for (let y = 0; y <= state.mapH; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * tileDrawH + 0.5);
    ctx.lineTo(state.mapW * tileDrawW, y * tileDrawH + 0.5);
    ctx.stroke();
  }

  ctx.strokeStyle = "#f1b96a";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, state.mapW * tileDrawW - 2, state.mapH * tileDrawH - 2);
}

function pointerToCell(event, allowNearest = false) {
  const rect = mapCanvas.getBoundingClientRect();
  const px = event.clientX - rect.left - state.offsetX;
  const py = event.clientY - rect.top - state.offsetY;
  if (state.projection === "isometric") {
    const worldX = px / state.zoom;
    const worldY = py / state.zoom;
    const cellH = isoCellHeight(state.tileW, state.tileH);
    const relX = worldX - isoOrigin(state.tileW);
    const a = relX / (state.tileW / 2);
    const b = worldY / (cellH / 2);
    const approxX = Math.floor((a + b) / 2);
    const approxY = Math.floor((b - a) / 2);
    let best = null;
    let bestDistance = Infinity;
    for (let y = approxY - 2; y <= approxY + 2; y++) {
      for (let x = approxX - 2; x <= approxX + 2; x++) {
        if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) continue;
        const p = cellToScreen(x, y, state.tileW, state.tileH);
        const centerX = p.x + state.tileW / 2;
        const centerY = p.y + cellH / 2;
        const nx = Math.abs(worldX - centerX) / (state.tileW / 2);
        const ny = Math.abs(worldY - centerY) / (cellH / 2);
        const distance = nx + ny;
        if (distance < bestDistance) {
          best = { x, y };
          bestDistance = distance;
        }
      }
    }
    if (best && (allowNearest || bestDistance <= 1)) return best;
    const clampedX = Math.max(0, Math.min(state.mapW - 1, approxX));
    const clampedY = Math.max(0, Math.min(state.mapH - 1, approxY));
    return allowNearest ? { x: clampedX, y: clampedY } : null;
  }
  const x = Math.floor(px / (state.tileW * state.zoom));
  const y = Math.floor(py / (state.tileH * state.zoom));
  if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) return null;
  return { x, y };
}

function pointerToMapPoint(event) {
  const rect = mapCanvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - state.offsetX) / state.zoom,
    y: (event.clientY - rect.top - state.offsetY) / state.zoom
  };
}

function cellCenter(cell) {
  if (state.projection === "isometric") {
    const p = cellToScreen(cell.x, cell.y, state.tileW, state.tileH);
    return {
      x: p.x + state.tileW / 2,
      y: p.y + isoCellHeight(state.tileW, state.tileH) / 2
    };
  }
  return {
    x: (cell.x + 0.5) * state.tileW,
    y: (cell.y + 0.5) * state.tileH
  };
}

function cellSnapPoint(cell, pointName) {
  if (state.projection === "isometric") {
    const p = cellToScreen(cell.x, cell.y, state.tileW, state.tileH);
    const cellH = isoCellHeight(state.tileW, state.tileH);
    const points = {
      center: { x: p.x + state.tileW / 2, y: p.y + cellH / 2 },
      north: { x: p.x + state.tileW / 2, y: p.y },
      east: { x: p.x + state.tileW, y: p.y + cellH / 2 },
      south: { x: p.x + state.tileW / 2, y: p.y + cellH },
      west: { x: p.x, y: p.y + cellH / 2 }
    };
    return points[pointName] ?? points.center;
  }
  const x = cell.x * state.tileW;
  const y = cell.y * state.tileH;
  const points = {
    center: { x: x + state.tileW / 2, y: y + state.tileH / 2 },
    north: { x: x + state.tileW / 2, y },
    east: { x: x + state.tileW, y: y + state.tileH / 2 },
    south: { x: x + state.tileW / 2, y: y + state.tileH },
    west: { x, y: y + state.tileH / 2 }
  };
  return points[pointName] ?? points.center;
}

function findObjectAt(point) {
  for (let i = state.objects.length - 1; i >= 0; i--) {
    const object = state.objects[i];
    if (
      point.x >= object.x &&
      point.y >= object.y &&
      point.x <= object.x + object.w &&
      point.y <= object.y + object.h
    ) {
      return { object, index: i };
    }
  }
  return null;
}

function selectedObject() {
  return state.objects.find(object => object.id === state.selectedObjectId) ?? null;
}

function syncSelectedObjectInputs() {
  const object = selectedObject();
  document.querySelector("#selectedObjectW").value = object ? object.w : 0;
  document.querySelector("#selectedObjectH").value = object ? object.h : 0;
}

function selectObject(object) {
  state.selectedObjectId = object ? object.id : null;
  syncSelectedObjectInputs();
  drawMap();
}

function syncLayerLiftInput() {
  const input = document.querySelector("#layerLift");
  if (!input) return;
  input.disabled = state.layer === "collision";
  input.value = state.layerLift?.[state.layer] ?? 0;
  const anchor = document.querySelector("#layerIsoAnchor");
  if (anchor) {
    anchor.disabled = state.layer === "collision";
    anchor.value = state.layerIsoAnchor?.[state.layer] ?? "origin";
  }
}

function applyPickedEntrySettings(entry) {
  if (!entry) return;
  state.activeTileset = entry.set;
  state.selectedTile = entry.tile;
  if (state.layer !== "collision") {
    state.layerIsoAnchor[state.layer] = entry.anchor ?? "origin";
    state.stackRise = Number(entry.rise ?? state.stackRise);
  }
  document.querySelector("#stackRise").value = state.stackRise;
  syncLayerLiftInput();
  renderTilesetList();
  drawTileset();
  setStatus(`Set ${entry.set + 1}, tile ${entry.tile}`);
}

function tileEntryMatchesSelection(entry) {
  return entry && entry.set === state.activeTileset && entry.tile === state.selectedTile;
}

function retuneTileEntry(entry) {
  return {
    ...entry,
    lift: 0,
    anchor: state.layerIsoAnchor?.[state.layer] ?? "origin",
    rise: state.stackRise
  };
}

function applyLayerSettingsToSelectedTiles() {
  if (state.layer === "collision") return;
  const layer = state.layers[state.layer];
  let changed = 0;
  beginStroke();
  for (let y = 0; y < state.mapH; y++) {
    for (let x = 0; x < state.mapW; x++) {
      if (state.layer === "stack") {
        const before = cloneCellValue(layer[y][x]);
        const matches = before.filter(tileEntryMatchesSelection);
        if (matches.length === 0) continue;
        const others = before.filter(entry => !tileEntryMatchesSelection(entry));
        const replacement = Array.from({ length: state.stackCount }, () => selectedTileEntry());
        const after = [...others, ...replacement];
        if (!sameValue(before, after)) {
          layer[y][x] = after;
          recordChange(state.layer, x, y, before, after);
          changed += 1;
        }
        continue;
      }
      const entry = normalizeTileEntry(layer[y][x]);
      if (!tileEntryMatchesSelection(entry)) continue;
      const before = cloneCellValue(layer[y][x]);
      const after = retuneTileEntry(entry);
      layer[y][x] = after;
      recordChange(state.layer, x, y, before, after);
      changed += 1;
    }
  }
  finishStroke();
  drawMap();
  setStatus(changed ? `Applied settings to ${changed} cells` : "No matching tiles");
}

function objectHandleHit(object, point) {
  const handle = Math.max(8, Math.min(object.w, object.h, 14));
  return (
    point.x >= object.x + object.w - handle &&
    point.x <= object.x + object.w &&
    point.y >= object.y + object.h - handle &&
    point.y <= object.y + object.h
  );
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function cellKey(layer, x, y) {
  return `${layer}:${x}:${y}`;
}

function recordChange(layerName, x, y, before, after) {
  if (sameValue(before, after) || !state.currentStroke) return;
  const key = cellKey(layerName, x, y);
  if (!state.currentStroke.changes.has(key)) {
    state.currentStroke.changes.set(key, {
      layerName,
      x,
      y,
      before: cloneCellValue(before),
      after: cloneCellValue(after)
    });
    return;
  }
  state.currentStroke.changes.get(key).after = cloneCellValue(after);
}

function beginStroke() {
  state.currentStroke = { changes: new Map() };
}

function finishStroke() {
  if (state.currentStroke && state.currentStroke.changes.size > 0) {
    state.undoStack.push([...state.currentStroke.changes.values()]);
    if (state.undoStack.length > 100) state.undoStack.shift();
  }
  state.currentStroke = null;
}

function undoLast() {
  const changes = state.undoStack.pop();
  if (!changes) {
    setStatus("Nothing to undo");
    return;
  }
  for (let i = changes.length - 1; i >= 0; i--) {
    const change = changes[i];
    if (change.layerName === "objects") {
      const existingIndex = state.objects.findIndex(object => object.id === change.id);
      if (change.before === null && existingIndex !== -1) {
        state.objects.splice(existingIndex, 1);
      } else if (change.before && existingIndex === -1) {
        state.objects.push(change.before);
      } else if (change.before && existingIndex !== -1) {
        state.objects[existingIndex] = change.before;
      }
      state.selectedObjectId = change.before ? change.before.id : null;
    } else {
      state.layers[change.layerName][change.y][change.x] = cloneCellValue(change.before);
    }
  }
  drawMap();
  setStatus("Undid stroke");
}

function recordObjectChange(id, before, after) {
  if (!state.currentStroke) return;
  state.currentStroke.changes.set(`objects:${id}`, {
    layerName: "objects",
    id,
    before: before ? { ...before } : null,
    after: after ? { ...after } : null
  });
}

function objectPivotOffset(object, pivotName) {
  const xMap = {
    left: 0,
    center: object.w / 2,
    right: object.w
  };
  const yMap = {
    top: 0,
    middle: object.h / 2,
    bottom: object.h
  };
  if (pivotName === "center") {
    return { x: object.w / 2, y: object.h / 2 };
  }
  const [vertical, horizontal] = pivotName.split("-");
  return {
    x: xMap[horizontal] ?? object.w / 2,
    y: yMap[vertical] ?? object.h
  };
}

function placeObjectAtAnchor(object, anchor, snapped) {
  const pivot = objectPivotOffset(object, snapped ? state.objectPivot : "center");
  object.x = Math.round(anchor.x - pivot.x + state.objectOffsetX);
  object.y = Math.round(anchor.y - pivot.y + state.objectOffsetY);
}

function placeObjectAsTile(object, cell) {
  const p = cellToScreen(cell.x, cell.y, state.tileW, state.tileH);
  object.x = Math.round(p.x + state.objectOffsetX);
  object.y = Math.round(p.y + state.objectOffsetY);
}

function stampObject(event, cell = null) {
  const source = state.objectImages[state.activeObject];
  if (!source) {
    setStatus("Add an object PNG");
    return;
  }
  const point = pointerToMapPoint(event);
  const snapCell = state.objectSnap ? cell ?? pointerToCell(event) : null;
  if (state.objectSnap && !snapCell) return;
  const scale = state.objectScale / 100;
  const w = Math.round(source.image.width * scale);
  const h = Math.round(source.image.height * scale);
  const object = {
    id: state.nextObjectId++,
    imageIndex: state.activeObject,
    x: 0,
    y: 0,
    w,
    h,
    snapCell: snapCell ? { ...snapCell } : null,
    snapPoint: state.objectSnap ? state.objectSnapPoint : null,
    snapAsTile: state.objectSnap && state.objectSnapAsTile,
    pivot: state.objectSnap ? state.objectPivot : "center",
    offsetX: state.objectOffsetX,
    offsetY: state.objectOffsetY
  };
  if (state.objectSnap && state.objectSnapAsTile) {
    placeObjectAsTile(object, snapCell);
  } else {
    const anchor = snapCell ? cellSnapPoint(snapCell, state.objectSnapPoint) : point;
    placeObjectAtAnchor(object, anchor, state.objectSnap);
  }
  state.objects.push(object);
  recordObjectChange(object.id, null, object);
  state.selectedObjectId = null;
  syncSelectedObjectInputs();
  drawMap();
  setStatus(`Stamped ${source.name}`);
}

function eraseObjectAt(event) {
  const hit = findObjectAt(pointerToMapPoint(event));
  if (!hit) return false;
  state.objects.splice(hit.index, 1);
  recordObjectChange(hit.object.id, hit.object, null);
  drawMap();
  setStatus("Removed object");
  return true;
}

function beginObjectEdit(event) {
  const point = pointerToMapPoint(event);
  const hit = findObjectAt(point);
  if (!hit) {
    selectObject(null);
    return false;
  }
  selectObject(hit.object);
  beginStroke();
  state.objectDragMode = objectHandleHit(hit.object, point) ? "resize" : "move";
  state.objectDragStart = {
    point,
    objectId: hit.object.id,
    before: { ...hit.object },
    offsetX: point.x - hit.object.x,
    offsetY: point.y - hit.object.y
  };
  return true;
}

function updateObjectEdit(event) {
  if (!state.objectDragMode || !state.objectDragStart) return;
  const object = selectedObject();
  if (!object) return;
  const point = pointerToMapPoint(event);
  if (state.objectDragMode === "move") {
    if (state.objectSnap) {
      const snapCell = pointerToCell(event);
      if (!snapCell) return;
      if (state.objectSnapAsTile) {
        placeObjectAsTile(object, snapCell);
      } else {
        const anchor = cellSnapPoint(snapCell, state.objectSnapPoint);
        placeObjectAtAnchor(object, anchor, true);
      }
      object.snapCell = { ...snapCell };
      object.snapPoint = state.objectSnapPoint;
      object.snapAsTile = state.objectSnapAsTile;
      object.pivot = state.objectPivot;
      object.offsetX = state.objectOffsetX;
      object.offsetY = state.objectOffsetY;
    } else {
      object.x = Math.round(point.x - state.objectDragStart.offsetX);
      object.y = Math.round(point.y - state.objectDragStart.offsetY);
      object.snapCell = null;
      object.snapPoint = null;
    }
  }
  if (state.objectDragMode === "resize") {
    object.w = Math.max(1, Math.round(point.x - object.x));
    object.h = Math.max(1, Math.round(point.y - object.y));
  }
  syncSelectedObjectInputs();
  drawMap();
}

function finishObjectEdit() {
  if (!state.objectDragMode || !state.objectDragStart) return;
  const object = selectedObject();
  if (object) recordObjectChange(object.id, state.objectDragStart.before, object);
  finishStroke();
  state.objectDragMode = null;
  state.objectDragStart = null;
}

function applyTool(cell, event) {
  if (!cell) return;
  if (state.tool === "stamp") {
    stampObject(event, cell);
    return;
  }
  if (state.tool === "erase" && event && eraseObjectAt(event)) return;
  if (state.layer === "collision") {
    const before = state.layers.collision[cell.y][cell.x];
    const after = state.tool === "erase" ? 0 : 1;
    state.layers.collision[cell.y][cell.x] = after;
    recordChange("collision", cell.x, cell.y, before, after);
    drawMap();
    return;
  }

  const layer = state.layers[state.layer];
  if (state.layer === "stack") {
    const stack = layer[cell.y][cell.x];
    const stackAddition = Array.from({ length: state.stackCount }, () => selectedTileEntry());
    if (state.tool === "paint") {
      const before = [...stack];
      const after = [...stack, ...stackAddition];
      layer[cell.y][cell.x] = after;
      recordChange("stack", cell.x, cell.y, before, after);
    }
    if (state.tool === "erase") {
      const before = [...stack];
      const after = stack.slice(0, -1);
      layer[cell.y][cell.x] = after;
      recordChange("stack", cell.x, cell.y, before, after);
    }
    if (state.tool === "pick") {
      const top = stack[stack.length - 1];
      applyPickedEntrySettings(normalizeTileEntry(top));
    }
    if (state.tool === "fill") floodFill(cell, parseTileStack(stack), stackAddition, "stack");
    drawMap();
    if (state.tool === "fill") setStatus(`Filled wall height ${state.stackCount}`);
    return;
  }

  if (state.tool === "paint") {
    const before = layer[cell.y][cell.x];
    const after = selectedTileEntry();
    layer[cell.y][cell.x] = after;
    recordChange(state.layer, cell.x, cell.y, before, after);
  }
  if (state.tool === "erase") {
    const before = layer[cell.y][cell.x];
    layer[cell.y][cell.x] = -1;
    recordChange(state.layer, cell.x, cell.y, before, -1);
  }
  if (state.tool === "pick") {
    applyPickedEntrySettings(normalizeTileEntry(layer[cell.y][cell.x]));
  }
  if (state.tool === "fill") floodFill(cell, cloneCellValue(layer[cell.y][cell.x]), selectedTileEntry(), state.layer);
  drawMap();
}

function paintSingleTile(cell, layerName) {
  if (!cell || layerName === "collision") return;
  const layer = state.layers[layerName];
  if (layerName === "stack") {
    const before = [...layer[cell.y][cell.x]];
    const wallTiles = Array.from({ length: state.stackCount }, () => selectedTileEntry());
    const after = [...before, ...wallTiles];
    layer[cell.y][cell.x] = after;
    recordChange(layerName, cell.x, cell.y, before, after);
    return;
  }
  const before = layer[cell.y][cell.x];
  const after = selectedTileEntry();
  layer[cell.y][cell.x] = after;
  recordChange(layerName, cell.x, cell.y, before, after);
}

function applyBoxTool(endCell) {
  if (!state.boxStartCell || !endCell) return;
  beginStroke();
  for (const cell of boxCells(state.boxStartCell, endCell)) {
    paintSingleTile(cell, state.layer);
  }
  finishStroke();
  state.boxStartCell = null;
  state.boxPreviewCell = null;
  drawMap();
  setStatus(state.layer === "stack" ? `Drew wall height ${state.stackCount}` : "Drew box perimeter");
}

function applyDragTool(cell, event) {
  if (!cell) return;
  if (!state.lastPaintCell) {
    applyTool(cell, event);
    state.lastPaintCell = cell;
    return;
  }
  const dx = cell.x - state.lastPaintCell.x;
  const dy = cell.y - state.lastPaintCell.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps === 0) {
    return;
  }
  for (let i = 1; i <= steps; i++) {
    const x = Math.round(state.lastPaintCell.x + dx * (i / steps));
    const y = Math.round(state.lastPaintCell.y + dy * (i / steps));
    applyTool({ x, y }, event);
  }
  state.lastPaintCell = cell;
}

function floodFill(start, target, replacement, layerName) {
  if (sameValue(target, replacement) || state.layer === "collision") return;
  const layer = state.layers[layerName];
  const stack = [start];
  while (stack.length) {
    const { x, y } = stack.pop();
    if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) continue;
    if (!sameValue(layer[y][x], target)) continue;
    const before = cloneCellValue(layer[y][x]);
    layer[y][x] = cloneCellValue(replacement);
    recordChange(layerName, x, y, before, replacement);
    stack.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 });
  }
}

function resizeMap() {
  const old = state.layers;
  state.mapW = Number(document.querySelector("#mapW").value);
  state.mapH = Number(document.querySelector("#mapH").value);
  resetLayers();
  for (const name of layerNames) {
    if (!old[name]) continue;
    for (let y = 0; y < Math.min(old[name].length, state.mapH); y++) {
      for (let x = 0; x < Math.min(old[name][y].length, state.mapW); x++) {
        state.layers[name][y][x] = cloneCellValue(old[name][y][x]);
      }
    }
  }
  drawMap();
}

function download(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function projectData() {
  return {
    version: 4,
    kind: "low-topdown-map",
    tileW: state.tileW,
    tileH: state.tileH,
    margin: state.margin,
    spacing: state.spacing,
    projection: state.projection,
    isoFlat: state.isoFlat,
    isoStepH: state.isoStepH,
    stackCount: state.stackCount,
    stackRise: state.stackRise,
    layerLift: state.layerLift,
    layerIsoAnchor: state.layerIsoAnchor,
    mapW: state.mapW,
    mapH: state.mapH,
    activeTileset: state.activeTileset,
    selectedTile: state.selectedTile,
    activeObject: state.activeObject,
    objectScale: state.objectScale,
    objectOffsetX: state.objectOffsetX,
    objectOffsetY: state.objectOffsetY,
    objectSnap: state.objectSnap,
    objectSnapAsTile: state.objectSnapAsTile,
    objectSnapPoint: state.objectSnapPoint,
    objectPivot: state.objectPivot,
    nextObjectId: state.nextObjectId,
    tilesets: state.tilesets.map(set => ({ name: set.name, src: set.src })),
    objectImages: state.objectImages.map(object => ({ name: object.name, src: object.src })),
    objects: state.objects,
    layers: state.layers
  };
}

function exportProject() {
  download("mapwright-project.json", JSON.stringify(projectData(), null, 2), "application/json");
}

function exportJson() {
  const data = projectData();
  data.tilesets = data.tilesets.map(set => ({ name: set.name }));
  data.objectImages = data.objectImages.map(object => ({ name: object.name }));
  download("map.json", JSON.stringify(data, null, 2), "application/json");
}

function exportPng() {
  const out = document.createElement("canvas");
  if (state.projection === "isometric") {
    out.width = Math.ceil((state.mapW + state.mapH) * state.tileW / 2);
    out.height = Math.ceil((state.mapW + state.mapH) * isoCellHeight(state.tileW, state.tileH) / 2);
  } else {
    out.width = state.mapW * state.tileW;
    out.height = state.mapH * state.tileH;
  }
  const outCtx = out.getContext("2d");
  outCtx.imageSmoothingEnabled = false;
  drawMapTiles(outCtx, state.tileW, state.tileH);
  drawObjects(outCtx, 1);
  out.toBlob(blob => download("map.png", blob, "image/png"));
}

function imageFromSrc(src) {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.src = src;
  });
}

function normalizeLayers() {
  const loaded = state.layers ?? {};
  resetLayers();
  for (const name of layerNames) {
    if (!loaded[name]) continue;
    for (let y = 0; y < Math.min(loaded[name].length, state.mapH); y++) {
      for (let x = 0; x < Math.min(loaded[name][y].length, state.mapW); x++) {
        if (name === "stack") {
          state.layers.stack[y][x] = parseTileStack(loaded.stack[y][x]);
        } else if (name === "collision") {
          state.layers.collision[y][x] = loaded.collision[y][x];
        } else {
          state.layers[name][y][x] = normalizeTileEntry(loaded[name][y][x]) ?? -1;
        }
      }
    }
  }
}

async function addTileset(name, src) {
  const image = await imageFromSrc(src);
  autoDetectTileSize(image);
  state.tilesets.push({ name, src, image, tilesPerRow: 1, tileCount: 0 });
  state.activeTileset = state.tilesets.length - 1;
  state.selectedTile = 0;
  recalcTilesets();
  setStatus(`Added ${name}`);
}

async function addObjectImage(name, src) {
  const image = await imageFromSrc(src);
  state.objectImages.push({ name, src, image });
  state.activeObject = state.objectImages.length - 1;
  renderObjectList();
  setStatus(`Added ${name}`);
}

async function loadProject(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  Object.assign(state, {
    tileW: data.tileW,
    tileH: data.tileH,
    margin: data.margin ?? 0,
    spacing: data.spacing ?? 0,
    projection: data.projection ?? "orthogonal",
    isoFlat: data.isoFlat ?? true,
    isoStepH: data.isoStepH ?? 0,
    stackCount: data.stackCount ?? 1,
    stackRise: data.stackRise ?? 0,
    layerLift: {
      ground: 0,
      detail: 0,
      stack: 0,
      above: 0,
      ...(data.layerLift ?? {})
    },
    layerIsoAnchor: {
      ground: "origin",
      detail: "origin",
      stack: "origin",
      above: "origin",
      ...(data.layerIsoAnchor ?? {})
    },
    mapW: data.mapW,
    mapH: data.mapH,
    activeTileset: data.activeTileset ?? 0,
    selectedTile: data.selectedTile ?? 0,
    activeObject: data.activeObject ?? 0,
    objectScale: data.objectScale ?? 100,
    objectOffsetX: data.objectOffsetX ?? 0,
    objectOffsetY: data.objectOffsetY ?? 0,
    objectSnap: data.objectSnap ?? false,
    objectSnapAsTile: data.objectSnapAsTile ?? false,
    objectSnapPoint: data.objectSnapPoint ?? "center",
    objectPivot: data.objectPivot ?? "bottom-center",
    nextObjectId: data.nextObjectId ?? 1,
    selectedObjectId: null,
    objectDragMode: null,
    objectDragStart: null,
    objects: data.objects ?? [],
    layers: data.layers
  });
  normalizeLayers();
  state.undoStack = [];
  state.currentStroke = null;
  for (const id of ["tileW", "tileH", "margin", "spacing", "stackCount", "stackRise", "mapW", "mapH"]) {
    document.querySelector(`#${id}`).value = state[id];
  }
  document.querySelector("#isoStepH").value = state.isoStepH;
  syncLayerLiftInput();
  document.querySelectorAll("#projection button").forEach(button => {
    button.classList.toggle("active", button.dataset.projection === state.projection);
  });
  document.querySelector("#toggleIsoFlat").classList.toggle("active", state.isoFlat);

  const savedTilesets = data.tilesets ?? (data.tilesetSrc ? [{ name: "Tileset 1", src: data.tilesetSrc }] : []);
  state.tilesets = [];
  for (const set of savedTilesets) {
    const image = await imageFromSrc(set.src);
    state.tilesets.push({ name: set.name, src: set.src, image, tilesPerRow: 1, tileCount: 0 });
  }
  state.activeTileset = Math.min(state.activeTileset, Math.max(0, state.tilesets.length - 1));
  const savedObjects = data.objectImages ?? [];
  state.objectImages = [];
  for (const object of savedObjects) {
    const image = await imageFromSrc(object.src);
    state.objectImages.push({ name: object.name, src: object.src, image });
  }
  state.activeObject = Math.min(state.activeObject, Math.max(0, state.objectImages.length - 1));
  document.querySelector("#objectScale").value = state.objectScale;
  document.querySelector("#objectOffsetX").value = state.objectOffsetX;
  document.querySelector("#objectOffsetY").value = state.objectOffsetY;
  document.querySelector("#toggleObjectSnap").classList.toggle("active", state.objectSnap);
  document.querySelector("#toggleObjectSnapAsTile").classList.toggle("active", state.objectSnapAsTile);
  document.querySelector("#objectSnapPoint").value = state.objectSnapPoint;
  document.querySelector("#objectPivot").value = state.objectPivot;
  syncSelectedObjectInputs();
  renderObjectList();
  recalcTilesets();
  setStatus("Loaded");
}

function wireUi() {
  for (const id of ["tileW", "tileH", "margin", "spacing"]) {
    document.querySelector(`#${id}`).addEventListener("change", event => {
      state[id] = Number(event.target.value);
      recalcTilesets();
    });
  }

  document.querySelector("#skewTile").addEventListener("click", generateSkewTileset);
  document.querySelector("#skewObject").addEventListener("click", generateSkewObject);

  document.querySelector("#tilesetInput").addEventListener("change", event => {
    const files = [...event.target.files];
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = () => addTileset(file.name, reader.result);
      reader.readAsDataURL(file);
    }
    event.target.value = "";
  });

  document.querySelector("#objectInput").addEventListener("change", event => {
    const files = [...event.target.files];
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = () => addObjectImage(file.name, reader.result);
      reader.readAsDataURL(file);
    }
    event.target.value = "";
  });

  document.querySelector("#objectScale").addEventListener("change", event => {
    state.objectScale = Number(event.target.value);
  });

  for (const id of ["objectOffsetX", "objectOffsetY"]) {
    document.querySelector(`#${id}`).addEventListener("change", event => {
      state[id] = Math.max(-4096, Math.min(4096, Number(event.target.value)));
      event.target.value = state[id];
      setStatus(`Object offset ${state.objectOffsetX}, ${state.objectOffsetY}`);
    });
  }

  document.querySelector("#toggleObjectSnap").addEventListener("click", event => {
    state.objectSnap = !state.objectSnap;
    event.target.classList.toggle("active", state.objectSnap);
    setStatus(state.objectSnap ? "Object snap on" : "Object snap off");
  });

  document.querySelector("#toggleObjectSnapAsTile").addEventListener("click", event => {
    state.objectSnapAsTile = !state.objectSnapAsTile;
    if (state.objectSnapAsTile) state.objectSnap = true;
    event.target.classList.toggle("active", state.objectSnapAsTile);
    document.querySelector("#toggleObjectSnap").classList.toggle("active", state.objectSnap);
    setStatus(state.objectSnapAsTile ? "Object tile snap on" : "Object tile snap off");
  });

  document.querySelector("#objectSnapPoint").addEventListener("change", event => {
    state.objectSnapPoint = event.target.value;
    setStatus(`Snap point: ${state.objectSnapPoint}`);
  });

  document.querySelector("#objectPivot").addEventListener("change", event => {
    state.objectPivot = event.target.value;
    setStatus(`Object pivot: ${state.objectPivot}`);
  });

  for (const id of ["selectedObjectW", "selectedObjectH"]) {
    document.querySelector(`#${id}`).addEventListener("change", event => {
      const object = selectedObject();
      if (!object) return;
      beginStroke();
      const before = { ...object };
      if (id === "selectedObjectW") object.w = Math.max(1, Number(event.target.value));
      if (id === "selectedObjectH") object.h = Math.max(1, Number(event.target.value));
      recordObjectChange(object.id, before, object);
      finishStroke();
      syncSelectedObjectInputs();
      drawMap();
    });
  }

  document.querySelector("#deleteObject").addEventListener("click", () => {
    const object = selectedObject();
    if (!object) return;
    beginStroke();
    const index = state.objects.findIndex(item => item.id === object.id);
    if (index !== -1) state.objects.splice(index, 1);
    recordObjectChange(object.id, object, null);
    finishStroke();
    selectObject(null);
    setStatus("Deleted object");
  });

  document.querySelector("#duplicateObject").addEventListener("click", () => {
    const object = selectedObject();
    if (!object) return;
    beginStroke();
    const copy = {
      ...object,
      id: state.nextObjectId++,
      x: object.x + Math.round(state.tileW / 2),
      y: object.y + Math.round(isoCellHeight(state.tileW, state.tileH) / 2)
    };
    state.objects.push(copy);
    state.selectedObjectId = copy.id;
    recordObjectChange(copy.id, null, copy);
    finishStroke();
    syncSelectedObjectInputs();
    drawMap();
    setStatus("Duplicated object");
  });

  document.querySelector("#isoStepH").addEventListener("change", event => {
    state.isoStepH = Number(event.target.value);
    drawMap();
  });

  document.querySelector("#stackCount").addEventListener("change", event => {
    state.stackCount = Math.max(1, Math.min(12, Number(event.target.value)));
    event.target.value = state.stackCount;
    if (state.layer === "stack") {
      applyLayerSettingsToSelectedTiles();
    } else {
      setStatus(`Wall height ${state.stackCount}`);
    }
  });

  document.querySelector("#stackRise").addEventListener("change", event => {
    state.stackRise = Math.max(0, Math.min(128, Number(event.target.value)));
    event.target.value = state.stackRise;
    applyLayerSettingsToSelectedTiles();
  });

  document.querySelector("#layerLift").addEventListener("change", event => {
    if (state.layer === "collision") return;
    state.layerLift[state.layer] = Math.max(-256, Math.min(256, Number(event.target.value)));
    event.target.value = state.layerLift[state.layer];
    drawMap();
    setStatus(`${state.layer} lift ${state.layerLift[state.layer]}`);
  });

  document.querySelector("#layerIsoAnchor").addEventListener("change", event => {
    if (state.layer === "collision") return;
    state.layerIsoAnchor[state.layer] = event.target.value;
    applyLayerSettingsToSelectedTiles();
  });

  document.querySelector("#applyLayerSettings").addEventListener("click", applyLayerSettingsToSelectedTiles);

  document.querySelector("#projection").addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    state.projection = button.dataset.projection;
    document.querySelectorAll("#projection button").forEach(el => el.classList.toggle("active", el === button));
    drawMap();
    setStatus(state.projection === "isometric" ? "Iso mode" : "Top mode");
  });

  document.querySelector("#toggleIsoFlat").addEventListener("click", event => {
    state.isoFlat = !state.isoFlat;
    event.target.classList.toggle("active", state.isoFlat);
    drawMap();
    setStatus(state.isoFlat ? "Flat iso on" : "Block iso on");
  });

  objectList.addEventListener("click", event => {
    const item = event.target.closest(".tileset-item");
    if (!item) return;
    state.activeObject = Number(item.dataset.index);
    renderObjectList();
    setStatus(`Object ${state.activeObject + 1}`);
  });

  tilesetList.addEventListener("click", event => {
    const item = event.target.closest(".tileset-item");
    if (!item) return;
    state.activeTileset = Number(item.dataset.index);
    state.selectedTile = 0;
    renderTilesetList();
    drawTileset();
    setStatus(`Tileset ${state.activeTileset + 1}`);
  });

  tilesetCanvas.addEventListener("click", event => {
    const set = activeTileset();
    if (!set) return;
    const rect = tilesetCanvas.getBoundingClientRect();
    const scaleX = tilesetCanvas.width / rect.width;
    const scaleY = tilesetCanvas.height / rect.height;
    const x = (event.clientX - rect.left) * scaleX - state.margin;
    const y = (event.clientY - rect.top) * scaleY - state.margin;
    const stepX = state.tileW + state.spacing;
    const stepY = state.tileH + state.spacing;
    const col = Math.floor(x / stepX);
    const row = Math.floor(y / stepY);
    const withinTileX = x - col * stepX;
    const withinTileY = y - row * stepY;
    if (x < 0 || y < 0 || withinTileX >= state.tileW || withinTileY >= state.tileH) {
      setStatus("Gap ignored");
      return;
    }
    const tileId = row * set.tilesPerRow + col;
    if (tileId >= 0 && tileId < set.tileCount) {
      state.selectedTile = tileId;
      drawTileset();
      setStatus(`Set ${state.activeTileset + 1}, tile ${tileId}`);
    }
  });

  document.querySelector("#tools").addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    state.tool = button.dataset.tool;
    document.querySelectorAll("#tools button").forEach(el => el.classList.toggle("active", el === button));
  });

  document.querySelector("#layers").addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    state.layer = button.dataset.layer;
    document.querySelectorAll("#layers button").forEach(el => el.classList.toggle("active", el === button));
    syncLayerLiftInput();
  });

  mapCanvas.addEventListener("pointerdown", event => {
    mapCanvas.setPointerCapture(event.pointerId);
    state.dragging = true;
    state.panning = state.tool === "pan" || event.button === 1 || state.spaceDown;
    state.lastPointer = { x: event.clientX, y: event.clientY };
    if (!state.panning) {
      if (state.tool === "box") {
        const cell = pointerToCell(event, true);
        state.boxStartCell = cell;
        state.boxPreviewCell = cell;
        drawMap();
        return;
      }
      if (state.tool !== "stamp" && beginObjectEdit(event)) return;
      beginStroke();
      state.lastPaintCell = null;
      applyDragTool(pointerToCell(event), event);
      if (state.tool === "fill" || state.tool === "pick") finishStroke();
    }
  });

  mapCanvas.addEventListener("pointermove", event => {
    if (!state.dragging) return;
    if (state.panning) {
      state.offsetX += event.clientX - state.lastPointer.x;
      state.offsetY += event.clientY - state.lastPointer.y;
      state.lastPointer = { x: event.clientX, y: event.clientY };
      drawMap();
      return;
    }
    if (state.objectDragMode) {
      updateObjectEdit(event);
      return;
    }
    if (state.tool === "box") {
      state.boxPreviewCell = pointerToCell(event, true);
      drawMap();
      return;
    }
    if (state.tool === "paint" || state.tool === "erase" || state.tool === "stamp") applyDragTool(pointerToCell(event), event);
  });

  mapCanvas.addEventListener("pointerup", event => {
    if (state.objectDragMode) finishObjectEdit();
    else if (state.tool === "box") applyBoxTool(pointerToCell(event, true));
    else if (!state.panning) finishStroke();
    state.dragging = false;
    state.panning = false;
    state.lastPaintCell = null;
  });

  mapCanvas.addEventListener("pointercancel", () => {
    if (state.objectDragMode) finishObjectEdit();
    else if (!state.panning) finishStroke();
    state.boxStartCell = null;
    state.boxPreviewCell = null;
    state.dragging = false;
    state.panning = false;
    state.lastPaintCell = null;
  });

  mapCanvas.addEventListener("wheel", event => {
    event.preventDefault();
    const oldZoom = state.zoom;
    state.zoom = Math.min(4, Math.max(0.25, state.zoom + (event.deltaY < 0 ? 0.1 : -0.1)));
    const rect = mapCanvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    state.offsetX = mx - (mx - state.offsetX) * (state.zoom / oldZoom);
    state.offsetY = my - (my - state.offsetY) * (state.zoom / oldZoom);
    document.querySelector("#zoomLabel").textContent = `${Math.round(state.zoom * 100)}%`;
    drawMap();
  }, { passive: false });

  document.querySelector("#resizeMap").addEventListener("click", resizeMap);
  document.querySelector("#newMap").addEventListener("click", () => {
    resetLayers();
    state.layerLift = { ground: 0, detail: 0, stack: 0, above: 0 };
    state.layerIsoAnchor = { ground: "origin", detail: "origin", stack: "origin", above: "origin" };
    state.objects = [];
    state.selectedObjectId = null;
    syncSelectedObjectInputs();
    syncLayerLiftInput();
    state.undoStack = [];
    drawMap();
    setStatus("New map");
  });
  document.querySelector("#saveProject").addEventListener("click", exportProject);
  document.querySelector("#exportJson").addEventListener("click", exportJson);
  document.querySelector("#exportPng").addEventListener("click", exportPng);
  document.querySelector("#loadProject").addEventListener("change", event => {
    if (event.target.files[0]) loadProject(event.target.files[0]);
  });
  document.querySelector("#zoomIn").addEventListener("click", () => {
    state.zoom = Math.min(4, state.zoom + 0.25);
    document.querySelector("#zoomLabel").textContent = `${Math.round(state.zoom * 100)}%`;
    drawMap();
  });
  document.querySelector("#zoomOut").addEventListener("click", () => {
    state.zoom = Math.max(0.25, state.zoom - 0.25);
    document.querySelector("#zoomLabel").textContent = `${Math.round(state.zoom * 100)}%`;
    drawMap();
  });
  document.querySelector("#toggleGrid").addEventListener("click", event => {
    state.showGrid = !state.showGrid;
    event.target.classList.toggle("active", state.showGrid);
    drawMap();
  });

  window.addEventListener("keydown", event => {
    const target = event.target;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    if (event.code === "Space" && !typing) {
      state.spaceDown = true;
      event.preventDefault();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !typing) {
      event.preventDefault();
      undoLast();
    }
  });

  window.addEventListener("keyup", event => {
    if (event.code === "Space") state.spaceDown = false;
  });

  window.addEventListener("resize", resizeCanvases);
}

// --- Hover help / tooltips --------------------------------------------------

// Each entry: how to find the control -> what it does, how to use it, what it affects.
const HELP_TEXT = {
  "#tilesetInput": "Import tileset image(s). Each sheet you add can be picked from separately. Do this first, before painting. Affects: which tiles are available.",
  "#tileW": "Width in pixels of one tile in the source sheet. Must match the sheet's real tile size or tiles get sliced wrong. Affects: how the sheet is cut up.",
  "#tileH": "Height in pixels of one tile in the source sheet. Must match the sheet's real tile size or tiles get sliced wrong. Affects: how the sheet is cut up.",
  "#margin": "Empty border (px) around the whole sheet before the first tile. Raise it if your sheet has an outer frame. Affects: where tile slicing starts.",
  "#spacing": "Padding (px) between tiles in the sheet. Clicks inside the gap are ignored so you don't grab the wrong tile. Affects: tile slicing and picking.",
  "#skewTile": "Generates iso top/left/right face variants from the selected tile and adds them as a new sheet. Use it to build isometric walls. Affects: adds new tiles.",
  "[data-projection='orthogonal']": "Top-down view: flat rectangular grid. Best for classic 2D top-down maps.",
  "[data-projection='isometric']": "Isometric view: diamond grid drawn at an angle, for 2.5D depth.",
  "#toggleIsoFlat": "Iso only. Squashes iso row spacing so tall tile art isn't clipped. Turn off for full-height block iso. Affects: iso row height.",
  "#isoStepH": "Iso only. Vertical height (px) of a diamond cell's footprint. 0 = automatic (Tile W / 2). Affects: iso cell spacing.",
  "#stackCount": "STACK LAYER ONLY. How many copies of the tile each Brush/Box/Fill adds, piled upward to build wall height. Has no effect on Ground/Detail/Above.",
  "#stackRise": "STACK LAYER ONLY. How far (px) each stacked copy is drawn upward. 0 = all copies sit flat on the same cell, so the wall won't rise. Has no effect on other layers.",
  "#mapW": "Map width in tiles. Click Resize to apply. Tiles outside the new size get cropped. Affects: grid size.",
  "#mapH": "Map height in tiles. Click Resize to apply. Tiles outside the new size get cropped. Affects: grid size.",
  "#resizeMap": "Applies the Width / Height values above to the map grid.",
  "[data-layer='ground']": "Base floor layer, one tile per cell. Paint grass, dirt, floors here. Wall Height / Height Step do nothing on this layer.",
  "[data-layer='detail']": "Decoration overlay above Ground (flowers, cracks, rugs), one tile per cell. Wall Height / Height Step do nothing here.",
  "[data-layer='stack']": "Vertical layer holding MULTIPLE tiles per cell. This is the only layer where Wall Height and Height Step work - use it to build walls and raised blocks.",
  "[data-layer='above']": "Top overlay drawn over everything (rooftops, treetops, props above the player), one tile per cell. Wall Height / Height Step do nothing here.",
  "[data-layer='collision']": "Paints a blocked/walkable flag (shown red) for your game's collision. Draws no tiles - just marks cells. Brush blocks a cell, Erase clears it.",
  "#layerLift": "Shifts the whole active layer up/down on screen (px) live - handy for tuning wall faces. Disabled on Collision. Affects: the active layer only.",
  "#layerIsoAnchor": "Iso only. Where the active layer's tiles anchor in the cell: Origin, Front Edge, or Back Edge. Use Back Edge for upright wall faces.",
  "#applyLayerSettings": "Re-applies the current Wall Height, Height Step, and Iso Anchor to all matching copies of the selected tile already painted on this layer.",
  "#objectInput": "Import PNGs as free-floating stamps (characters, houses, trees) placed on top of the map, separate from tiles.",
  "#objectScale": "Size percent for newly stamped objects. 100 = original pixel size. Affects: new stamps only.",
  "#objectOffsetX": "Nudges newly stamped objects sideways by this many px from the click/snap point.",
  "#objectOffsetY": "Nudges newly stamped objects up/down by this many px from the click/snap point.",
  "#toggleObjectSnap": "When on, stamped or moved objects snap to a tile anchor point instead of the raw cursor. Affects: placement precision.",
  "#toggleObjectSnapAsTile": "Snaps the object exactly where a floor tile would sit (for 64x64 wall chunks). Ignores Snap Point and Object Pivot. Turns Object Snap on.",
  "#objectSnapPoint": "Which point of the target cell an object snaps to: Center or an edge. Works with Object Snap.",
  "#objectPivot": "Which point of the object lines up with the snap point (e.g. Bottom Center sits the feet on the anchor).",
  "#selectedObjectW": "Pixel width of the currently selected object. Edit to resize it precisely.",
  "#selectedObjectH": "Pixel height of the currently selected object. Edit to resize it precisely.",
  "#skewObject": "Generates isometric left-face, right-face, and top variants of the selected object PNG and adds them as new objects you can stamp. Good for turning a flat sprite into iso wall faces.",
  "#duplicateObject": "Copies the selected object one iso tile over - good for laying even wall runs.",
  "#deleteObject": "Removes the selected object from the map.",
  "[data-tool='paint']": "Brush: paint the selected tile on the active layer. Click or drag.",
  "[data-tool='erase']": "Erase: remove the tile (or the top object) under the cursor.",
  "[data-tool='fill']": "Fill: flood-fill all connected matching cells with the selected tile.",
  "[data-tool='box']": "Box: drag a rectangle to paint only its outline/perimeter - the clean way to make room walls.",
  "[data-tool='pick']": "Pick (eyedropper): click a painted cell to load its tile and settings as your current selection.",
  "[data-tool='stamp']": "Stamp: place the selected object PNG on the map.",
  "[data-tool='pan']": "Pan: drag to move the view. You can also hold Space + drag, or middle-mouse drag, with any tool.",
  "#zoomOut": "Zoom out. The mouse wheel also zooms.",
  "#zoomIn": "Zoom in. The mouse wheel also zooms.",
  "#toggleGrid": "Show or hide the cell grid overlay.",
  "#newMap": "Clear the map to a blank grid. Keeps loaded tilesets and objects.",
  "#saveProject": "Save the full project as JSON, including embedded tileset images, so you can reload it later exactly as-is.",
  "#loadProject": "Load a previously saved project JSON.",
  "#exportJson": "Export clean map data as JSON (layers without embedded images) for use in your game engine.",
  "#exportPng": "Export the rendered map as a flat PNG image."
};

function wireHelpTips() {
  const tip = document.createElement("div");
  tip.className = "help-tip";
  document.body.appendChild(tip);
  let activeTarget = null;

  const position = (x, y) => {
    const pad = 14;
    const rect = tip.getBoundingClientRect();
    let left = x + pad;
    let top = y + pad;
    if (left + rect.width > window.innerWidth - 8) left = x - rect.width - pad;
    if (top + rect.height > window.innerHeight - 8) top = y - rect.height - pad;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, top)}px`;
  };

  // Attach the help text to the visible control (the wrapping label for inputs/selects).
  for (const [selector, text] of Object.entries(HELP_TEXT)) {
    const el = document.querySelector(selector);
    if (!el) continue;
    const host = (el.tagName === "INPUT" || el.tagName === "SELECT") ? (el.closest("label") || el) : el;
    host.dataset.help = text;
    host.removeAttribute("title");
  }

  document.addEventListener("mouseover", event => {
    const el = event.target.closest("[data-help]");
    if (!el) return;
    activeTarget = el;
    tip.textContent = el.dataset.help;
    tip.style.display = "block";
    position(event.clientX, event.clientY);
  });
  document.addEventListener("mousemove", event => {
    if (activeTarget) position(event.clientX, event.clientY);
  });
  document.addEventListener("mouseout", event => {
    const el = event.target.closest("[data-help]");
    if (el && (!event.relatedTarget || !el.contains(event.relatedTarget))) {
      activeTarget = null;
      tip.style.display = "none";
    }
  });
}

resetLayers();
wireUi();
wireHelpTips();
renderTilesetList();
drawTileset();
resizeCanvases();
setStatus(`Ready ${APP_VERSION}`);
