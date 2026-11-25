// Preview helpers for the material data recovered from the PC executable.
// The native layer routine uses the game's accumulated seconds clock. Kind-6
// frame selection remains an editor approximation; kind-7 UV transforms below
// reproduce the native per-axis equations for mode values 0, 1 and 2.
export function previewFrameIndex(frameCount, elapsedMs, ticksPerSecond = 60) {
  const count = Math.max(0, Math.floor(Number(frameCount) || 0));
  if (!count) return 0;
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const ticks = Math.floor(elapsed * Math.max(0, Number(ticksPerSecond) || 0) / 1000);
  return ticks % count;
}

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Native kind-7 axis equations (time is seconds):
//   mode 0: phase + velocity * time
//   mode 1: phase + sin(frequency * time) * amplitude
//   mode 2: phase + cos(frequency * time) * amplitude
// The native builds a texture transform around the UV centre (0.5, 0.5).
// Translation uses THREE.Texture.offset; rotation is kept as radians and is
// applied through THREE.Texture.rotation with center=(0.5, 0.5). Unknown axis
// modes are held at their phase.
function axisOffset(mode, amplitude, frequency, phase, seconds) {
  const a = finite(amplitude), f = finite(frequency), p = finite(phase);
  switch (Math.floor(finite(mode, -1))) {
    case 0: return p + a * seconds;
    case 1: return p + Math.sin(f * seconds) * a;
    case 2: return p + Math.cos(f * seconds) * a;
    default: return p;
  }
}

export function previewUvOffset(layer, elapsedMs) {
  const seconds = Math.max(0, finite(elapsedMs)) / 1000;
  const data = layer && typeof layer === 'object' ? layer : {};
  return [
    axisOffset(data.uMode, data.uVelocity, data.uFrequency, data.uOffset, seconds),
    axisOffset(data.vMode, data.vVelocity, data.vFrequency, data.vOffset, seconds)
  ];
}

// Kind-7 rotation velocity/offset are radians and radians per second in the
// native layered-material record. Keep the unwrapped angle: THREE's texture
// transform is periodic, and avoiding modulo here preserves exact phase data.
export function previewUvRotation(layer, elapsedMs) {
  const seconds = Math.max(0, finite(elapsedMs)) / 1000;
  const data = layer && typeof layer === 'object' ? layer : {};
  return finite(data.rotationOffset) + finite(data.rotationVelocity) * seconds;
}
