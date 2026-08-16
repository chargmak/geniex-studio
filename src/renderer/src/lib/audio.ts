/**
 * Microphone capture → 16 kHz mono PCM WAV (what Whisper expects). Uses AudioContext + ScriptProcessor for broad
 * compatibility (AudioWorklet needs a separate module file). Also decodes arbitrary audio blobs to WAV.
 */

export interface Recorder {
  stop(): Promise<Blob>
  cancel(): void
  readonly startedAt: number
}

const TARGET_RATE = 16_000

function downsample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (inRate === outRate) return input
  const ratio = inRate / outRate
  const outLen = Math.round(input.length / ratio)
  const out = new Float32Array(outLen)
  let o = 0
  let i = 0
  while (o < outLen) {
    const next = Math.round((o + 1) * ratio)
    let sum = 0
    let n = 0
    for (; i < next && i < input.length; i++) {
      sum += input[i]
      n++
    }
    out[o++] = n ? sum / n : 0
  }
  return out
}

export function encodeWav(samples: Float32Array, sampleRate = TARGET_RATE): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let off = 44
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

export async function startRecording(onLevel?: (rms: number) => void): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  const ctx = new AudioContext()
  const source = ctx.createMediaStreamSource(stream)
  const proc = ctx.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  const inRate = ctx.sampleRate
  proc.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0)
    chunks.push(new Float32Array(data))
    if (onLevel) {
      let sum = 0
      for (let i = 0; i < data.length; i += 8) sum += data[i] * data[i]
      onLevel(Math.sqrt(sum / (data.length / 8)))
    }
  }
  source.connect(proc)
  proc.connect(ctx.destination)
  const startedAt = Date.now()
  const teardown = async (): Promise<void> => {
    proc.disconnect()
    source.disconnect()
    stream.getTracks().forEach((t) => t.stop())
    await ctx.close().catch(() => {})
  }
  return {
    startedAt,
    async stop() {
      await teardown()
      const total = chunks.reduce((n, c) => n + c.length, 0)
      const all = new Float32Array(total)
      let off = 0
      for (const c of chunks) {
        all.set(c, off)
        off += c.length
      }
      return encodeWav(downsample(all, inRate, TARGET_RATE))
    },
    cancel() {
      void teardown()
    },
  }
}

/** Decode any browser-playable audio blob (webm/mp3/…) to 16 kHz mono WAV. */
export async function blobToWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext()
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    const ch = buf.numberOfChannels
    const mono = new Float32Array(buf.length)
    for (let c = 0; c < ch; c++) {
      const d = buf.getChannelData(c)
      for (let i = 0; i < d.length; i++) mono[i] += d[i] / ch
    }
    return encodeWav(downsample(mono, buf.sampleRate, TARGET_RATE))
  } finally {
    await ctx.close().catch(() => {})
  }
}
