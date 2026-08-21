// Wraps raw 16-bit PCM samples in a minimal WAV (RIFF) container.
// pcmBuffer: Buffer of interleaved Int16LE samples.
function pcmToWav(pcmBuffer, sampleRate, numChannels = 1, bitsPerSample = 16) {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

// Concatenates an array of Int16Array chunks into one Buffer of Int16LE samples.
function concatInt16(chunks) {
  const totalSamples = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Int16Array(totalSamples);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return Buffer.from(merged.buffer, merged.byteOffset, merged.byteLength);
}

function computeRms(int16Samples) {
  if (!int16Samples.length) return 0;
  let sumSquares = 0;
  for (let i = 0; i < int16Samples.length; i++) {
    sumSquares += int16Samples[i] * int16Samples[i];
  }
  return Math.sqrt(sumSquares / int16Samples.length);
}

module.exports = { pcmToWav, concatInt16, computeRms };
