// Pure helpers for the Models panel's object-material previews. Model parts can
// point directly at a texture, a kind-6 animated wrapper, or a kind-7 layered
// wrapper. Keep the wrapper structure intact so the preview can animate every
// frame and render every material layer instead of silently using only layer 0.
import { previewFrameIndex, previewUvOffset, previewUvRotation } from './material-preview.js?v=step146-strat-appearance-preview';

export function resolveModelMaterialPasses(materialOffset, materialResources = [], fallbackTextureOffset = 0) {
  const byOffset = materialResources instanceof Map
    ? materialResources
    : new Map((materialResources || []).map(resource => [resource.offset, resource]));
  const passes = [];
  const flatten = (offset, layer = null, seen = new Set()) => {
    if (!Number.isInteger(offset) || offset <= 0 || seen.has(offset)) return;
    const resource = byOffset.get(offset);
    if (resource?.valid && resource.type === 'animated') {
      const frameOffsets = (resource.frameOffsets || []).filter(Number.isInteger);
      if (frameOffsets.length) passes.push({ type: 'animated', resourceOffset: offset, frameOffsets, layer });
      return;
    }
    if (resource?.valid && resource.type === 'layered') {
      const next = new Set(seen);
      next.add(offset);
      for (const child of resource.layers || []) flatten(child.textureOffset, child, next);
      return;
    }
    passes.push({ type: 'texture', resourceOffset: 0, frameOffsets: [offset], layer });
  };
  flatten(materialOffset);
  if (!passes.length && Number.isInteger(fallbackTextureOffset) && fallbackTextureOffset > 0)
    flatten(fallbackTextureOffset);
  return passes;
}

export function modelMaterialPassIsDynamic(pass) {
  if (!pass) return false;
  if ((pass.frameOffsets || []).length > 1) return true;
  const layer = pass.layer;
  return !!layer && !!(
    (layer.uMode === 0 && layer.uVelocity) ||
    ((layer.uMode === 1 || layer.uMode === 2) && layer.uVelocity && layer.uFrequency) ||
    (layer.vMode === 0 && layer.vVelocity) ||
    ((layer.vMode === 1 || layer.vMode === 2) && layer.vVelocity && layer.vFrequency) ||
    layer.rotationVelocity
  );
}

export function modelMaterialPassState(pass, elapsedMs, ticksPerSecond = 60) {
  const frames = pass?.frameOffsets || [];
  const frameIndex = previewFrameIndex(frames.length, elapsedMs, ticksPerSecond);
  const layer = pass?.layer || null;
  return {
    frameIndex,
    textureOffset: frames[frameIndex] || 0,
    uvOffset: layer ? previewUvOffset(layer, elapsedMs) : [0, 0],
    rotation: layer ? previewUvRotation(layer, elapsedMs) : 0
  };
}
