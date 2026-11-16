// Minimal Xbox IMA ADPCM decoder used only for in-editor sound previews.
// The game's WAVE/WAVS RIFF resources contain format tag 0x0069 blocks in
// the level's paired .PCA, not standalone browser-playable WAV files.
const STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31,
  34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544,
  598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707,
  1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871,
  5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
  15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
const INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

function decodeNibble(state, nibble) {
  const step = STEP_TABLE[state.index];
  const magnitude = nibble & 7;
  const delta = ((magnitude * 2 + 1) * step) >> 3;
  state.predictor += (nibble & 8) ? -delta : delta;
  state.predictor = Math.max(-32768, Math.min(32767, state.predictor));
  state.index = Math.max(0, Math.min(88, state.index + INDEX_TABLE[nibble]));
  return state.predictor;
}

/**
 * Decode Xbox IMA ADPCM blocks (36 bytes/channel, 64 output frames/block).
 * The Xbox variant stores one predictor/index header per channel and groups
 * four compressed bytes per channel at a time. The predictor is output as the
 * first frame; the last expanded nibble in each block is padding and omitted.
 */
export function decodeXboxAdpcm(data, channels, sampleCount, outputChannels = null) {
  if (!(data instanceof Uint8Array)) data = new Uint8Array(data);
  if (channels !== 1 && channels !== 2) throw new Error('Xbox ADPCM preview supports mono or stereo audio');
  if (!Number.isInteger(sampleCount) || sampleCount < 1) throw new Error('Invalid audio sample count');
  const blockAlign = 36 * channels;
  if (!data.length || data.length % blockAlign !== 0) throw new Error('ADPCM stream length is not a whole number of Xbox blocks');
  const blocks = data.length / blockAlign;
  if (sampleCount > blocks * 64) throw new Error('Audio sample count exceeds the ADPCM stream');

  const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const output = outputChannels == null
    ? Array.from({ length: channels }, () => new Float32Array(sampleCount))
    : outputChannels;
  if (!Array.isArray(output) || output.length !== channels || output.some(channel => !(channel instanceof Float32Array) || channel.length < sampleCount)) {
    throw new Error('Decoder output must contain one Float32Array per channel with enough samples');
  }
  const states = Array.from({ length: channels }, () => ({ predictor: 0, index: 0 }));

  for (let block = 0; block < blocks; block++) {
    const start = block * blockAlign;
    for (let ch = 0; ch < channels; ch++) {
      const header = start + ch * 4;
      const predictor = d.getInt16(header, true);
      const index = d.getInt16(header + 2, true);
      if (index < 0 || index > 88) throw new Error('Invalid Xbox ADPCM step index ' + index);
      states[ch].predictor = predictor;
      states[ch].index = index;
      const frame = block * 64;
      if (frame < sampleCount) output[ch][frame] = predictor / 32768;
    }

    let p = start + channels * 4;
    for (let group = 0; group < 8; group++) {
      for (let ch = 0; ch < channels; ch++) {
        const state = states[ch];
        for (let byteIndex = 0; byteIndex < 4; byteIndex++) {
          const packed = data[p++];
          const first = decodeNibble(state, packed & 0x0f);
          const second = decodeNibble(state, packed >>> 4);
          const frame = block * 64 + 1 + group * 8 + byteIndex * 2;
          if (frame < sampleCount) output[ch][frame] = first / 32768;
          if (frame + 1 < sampleCount && frame + 1 < (block + 1) * 64) output[ch][frame + 1] = second / 32768;
        }
      }
    }
  }
  return output;
}

/**
 * Encode mono/stereo float PCM to the same Xbox IMA ADPCM block format used
 * by the preview decoder above (36 bytes/channel, 64 frames/block).
 * Each block chooses an initial step index from its upper-range adjacent
 * sample deltas to avoid poor transient quality while the quantizer adapts.
 * One final zero nibble fills the unused slot after the 63 encoded samples.
 */
export function encodeXboxAdpcm(channels) {
  if (!Array.isArray(channels) || (channels.length !== 1 && channels.length !== 2)) {
    throw new Error('Xbox ADPCM encoder supports mono or stereo PCM');
  }
  const sampleCount = channels[0]?.length;
  if (!Number.isInteger(sampleCount) || sampleCount < 1 || channels.some(c => !c || c.length !== sampleCount)) {
    throw new Error('PCM channels must have the same non-zero sample count');
  }
  const blocks = Math.ceil(sampleCount / 64);
  const blockAlign = 36 * channels.length;
  const output = new Uint8Array(blocks * blockAlign);
  const view = new DataView(output.buffer);

  const toInt16 = sample => {
    const x = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
    return x < 0 ? Math.round(x * 32768) : Math.round(x * 32767);
  };

  for (let block = 0; block < blocks; block++) {
    const start = block * blockAlign;
    const predictors = new Int16Array(channels.length);
    const indices = new Int16Array(channels.length);
    const payloads = channels.map((channel, ch) => {
      const frame0 = block * 64;
      const predictor = toInt16(channel[Math.min(frame0, sampleCount - 1)]);
      predictors[ch] = predictor;
      // Estimate a useful starting step from the block's upper-range sample
      // deltas. Starting every block at index 0 makes the first transients
      // badly quantized while the adaptive step size catches up.
      const frameEnd = Math.min(64, sampleCount - frame0);
      const deltas = [];
      let previous = predictor;
      for (let frame = 1; frame < frameEnd; frame++) {
        const current = toInt16(channel[frame0 + frame]);
        deltas.push(Math.abs(current - previous));
        previous = current;
      }
      deltas.sort((a, b) => a - b);
      const upperDelta = deltas.length ? deltas[Math.floor((deltas.length - 1) * 0.9)] : 0;
      const desiredStep = upperDelta * 0.7;
      let initialIndex = 0;
      while (initialIndex < 88 && STEP_TABLE[initialIndex] < desiredStep) initialIndex++;
      if (initialIndex > 0 && Math.abs(STEP_TABLE[initialIndex - 1] - desiredStep) < Math.abs(STEP_TABLE[initialIndex] - desiredStep)) initialIndex--;
      indices[ch] = initialIndex;
      const state = { predictor, index: initialIndex };
      const packedNibbles = new Uint8Array(32);
      let pending = -1;

      for (let frame = 1; frame < 64; frame++) {
        const sampleIndex = frame0 + frame;
        const target = toInt16(channel[Math.min(sampleIndex, sampleCount - 1)]);
        const step = STEP_TABLE[state.index];
        let diff = target - state.predictor;
        let nibble = 0;
        if (diff < 0) { nibble = 8; diff = -diff; }
        let delta = step >> 3;
        if (diff >= step) { nibble |= 4; diff -= step; delta += step; }
        if (diff >= (step >> 1)) { nibble |= 2; diff -= step >> 1; delta += step >> 1; }
        if (diff >= (step >> 2)) { nibble |= 1; delta += step >> 2; }

        state.predictor += (nibble & 8) ? -delta : delta;
        state.predictor = Math.max(-32768, Math.min(32767, state.predictor));
        state.index = Math.max(0, Math.min(88, state.index + INDEX_TABLE[nibble]));

        if (pending < 0) pending = nibble;
        else {
          packedNibbles[(frame - 1) >> 1] = pending | (nibble << 4);
          pending = -1;
        }
      }
      // Exactly 63 samples are coded per block. The final high nibble is padding.
      if (pending >= 0) packedNibbles[31] = pending;
      return packedNibbles;
    });

    for (let ch = 0; ch < channels.length; ch++) {
      const header = start + ch * 4;
      view.setInt16(header, predictors[ch], true);
      view.setInt16(header + 2, indices[ch], true);
    }
    if (channels.length === 1) {
      output.set(payloads[0], start + 4);
    } else {
      let p = start + channels.length * 4;
      for (let group = 0; group < 8; group++) {
        for (let ch = 0; ch < channels.length; ch++) {
          output.set(payloads[ch].subarray(group * 4, group * 4 + 4), p);
          p += 4;
        }
      }
    }
  }
  return output;
}
