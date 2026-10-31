/**
 * Neon Audio Player - Built-in Synthwave Generator
 * Generates an energetic cyberpunk synthwave loop client-side as a WAV Blob
 * for instant testing without needing any external audio files!
 */
export class SynthDemoGenerator {
  /**
   * Generate demo track and return { src, coverUrl, title, artist, duration }
   */
  static generateSynthwaveTrack() {
    const sampleRate = 44100;
    const bpm = 124;
    const secondsPerBeat = 60 / bpm;
    const bars = 4;
    const beatsTotal = bars * 4; // 16 beats
    const duration = beatsTotal * secondsPerBeat;
    const numSamples = Math.floor(sampleRate * duration);

    // Stereo buffers
    const left = new Float32Array(numSamples);
    const right = new Float32Array(numSamples);

    // Note frequencies in D minor
    const notes = {
      D2: 73.42,
      F2: 87.31,
      G2: 98.00,
      A2: 110.00,
      Bb2: 116.54,
      C3: 130.81,
      D3: 146.83,
      F3: 174.61,
      A3: 220.00,
      D4: 293.66,
      F4: 349.23,
      A4: 440.00,
      C5: 523.25
    };

    // Bassline pattern: 16th notes
    const bassPattern = [
      notes.D2, notes.D2, notes.D3, notes.D2,
      notes.F2, notes.F2, notes.F3, notes.F2,
      notes.G2, notes.G2, notes.G3, notes.G2,
      notes.Bb2, notes.Bb2, notes.A2, notes.C3
    ];

    // Arp pattern
    const arpNotes = [notes.D4, notes.F4, notes.A4, notes.C5, notes.A4, notes.F4, notes.D4, notes.A3];

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const beat = (t / secondsPerBeat) % 16;
      const sixteenth = Math.floor(beat * 4) % 16;
      const sixteenthFrac = (beat * 4) % 1;

      let l = 0;
      let r = 0;

      // 1. Kick Drum (on beats 0, 1, 2, 3...)
      const kickBeatFrac = beat % 1;
      if (kickBeatFrac < 0.35) {
        const kt = kickBeatFrac * secondsPerBeat;
        const kickFreq = 140 * Math.exp(-kt * 22) + 38;
        const kickEnv = Math.exp(-kt * 14);
        const kickSample = Math.sin(2 * Math.PI * kickFreq * kt) * kickEnv * 0.75;
        l += kickSample;
        r += kickSample;
      }

      // 2. Snare / Cyber Clap (on beats 1, 3, 5, 7...)
      const snareBeatFrac = (beat + 1) % 2;
      if (snareBeatFrac < 0.28) {
        const st = snareBeatFrac * secondsPerBeat;
        const noise = (Math.random() * 2 - 1) * Math.exp(-st * 18) * 0.45;
        const tone = Math.sin(2 * Math.PI * 190 * st) * Math.exp(-st * 28) * 0.35;
        l += (noise + tone) * 0.85;
        r += (noise + tone) * 0.85;
      }

      // 3. Hi-Hat (16th notes)
      const hatFrac = sixteenthFrac;
      if (hatFrac < 0.08) {
        const ht = hatFrac * (secondsPerBeat / 4);
        const hat = (Math.random() * 2 - 1) * Math.exp(-ht * 80) * 0.22;
        const pan = (sixteenth % 2 === 0) ? -0.15 : 0.15;
        l += hat * (1 - pan);
        r += hat * (1 + pan);
      }

      // 4. Rolling Cyber Bass (Sawtooth + lowpass feel)
      const bassFreq = bassPattern[sixteenth] || notes.D2;
      const bassEnv = Math.exp(-sixteenthFrac * 4.2);
      // Dual detuned saw for wide stereo
      const saw1 = (2 * ((t * bassFreq) % 1) - 1);
      const saw2 = (2 * ((t * (bassFreq * 1.006)) % 1) - 1);
      const sub = Math.sin(2 * Math.PI * (bassFreq / 2) * t) * 0.5;
      l += (saw1 * 0.24 + sub * 0.28) * bassEnv;
      r += (saw2 * 0.24 + sub * 0.28) * bassEnv;

      // 5. Arp synth line
      const arpIdx = Math.floor(beat * 4) % arpNotes.length;
      const arpFreq = arpNotes[arpIdx];
      const arpEnv = Math.exp(-sixteenthFrac * 5.5);
      const arpWave = Math.sin(2 * Math.PI * arpFreq * t) + 0.35 * Math.sin(4 * Math.PI * arpFreq * t);
      const arpPan = Math.sin(t * 3.5) * 0.35;
      l += arpWave * 0.16 * arpEnv * (1 - arpPan);
      r += arpWave * 0.16 * arpEnv * (1 + arpPan);

      // Soft limiting
      left[i] = Math.tanh(l * 1.1);
      right[i] = Math.tanh(r * 1.1);
    }

    // Convert stereo buffers to WAV Blob
    const wavBlob = this.encodeWAV(left, right, sampleRate);
    const audioUrl = URL.createObjectURL(wavBlob);
    const coverUrl = this.generateNeonCoverSvg();

    return {
      src: audioUrl,
      pictureUrl: coverUrl,
      title: 'Neon Horizon (Cyberpunk Demo)',
      artist: 'Synthwave AI',
      duration
    };
  }

  /**
   * Encode stereo Float32Array into 16-bit PCM WAV Blob
   */
  static encodeWAV(left, right, sampleRate) {
    const numChannels = 2;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = left.length * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // RIFF identifier
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    this.writeString(view, 8, 'WAVE');

    // fmt subchunk
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true);  // AudioFormat (1 = PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // data subchunk
    this.writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Interleave samples
    let offset = 44;
    for (let i = 0; i < left.length; i++) {
      // Left channel
      let sL = Math.max(-1, Math.min(1, left[i]));
      view.setInt16(offset, sL < 0 ? sL * 0x8000 : sL * 0x7FFF, true);
      offset += 2;

      // Right channel
      let sR = Math.max(-1, Math.min(1, right[i]));
      view.setInt16(offset, sR < 0 ? sR * 0x8000 : sR * 0x7FFF, true);
      offset += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  static writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  /**
   * Generate glowing neon SVG cover artwork for tracks without album art
   */
  static generateNeonCoverSvg(title = 'NEON', artist = 'SYNTH') {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
        <defs>
          <radialGradient id="bgGrad" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stop-color="#180e29"/>
            <stop offset="60%" stop-color="#0c0714"/>
            <stop offset="100%" stop-color="#050308"/>
          </radialGradient>
          <linearGradient id="neonSun" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#ff007f"/>
            <stop offset="70%" stop-color="#ff8800"/>
            <stop offset="100%" stop-color="#ffe600"/>
          </linearGradient>
          <filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        
        <!-- Background -->
        <rect width="400" height="400" rx="24" fill="url(#bgGrad)"/>
        
        <!-- Retro Sun -->
        <circle cx="200" cy="180" r="85" fill="url(#neonSun)" filter="url(#neonGlow)"/>
        <line x1="115" y1="175" x2="285" y2="175" stroke="#0c0714" stroke-width="4"/>
        <line x1="125" y1="195" x2="275" y2="195" stroke="#0c0714" stroke-width="6"/>
        <line x1="140" y1="215" x2="260" y2="215" stroke="#0c0714" stroke-width="8"/>
        <line x1="160" y1="235" x2="240" y2="235" stroke="#0c0714" stroke-width="10"/>

        <!-- Perspective Grid -->
        <path d="M 0 250 L 400 250 M 0 270 L 400 270 M 0 300 L 400 300 M 0 340 L 400 340 M 0 395 L 400 395" stroke="#00f2ff" stroke-width="1.5" opacity="0.6"/>
        <path d="M 200 250 L 0 400 M 200 250 L 80 400 M 200 250 L 140 400 M 200 250 L 200 400 M 200 250 L 260 400 M 200 250 L 320 400 M 200 250 L 400 400" stroke="#00f2ff" stroke-width="1.5" opacity="0.6"/>

        <!-- Neon Audio Ring -->
        <circle cx="200" cy="200" r="170" fill="none" stroke="#a855f7" stroke-width="3" opacity="0.5" stroke-dasharray="10 8"/>
        <circle cx="200" cy="200" r="182" fill="none" stroke="#00f2ff" stroke-width="2" opacity="0.8"/>

        <!-- Logo / Title -->
        <text x="200" y="70" font-family="'Segoe UI', Roboto, sans-serif" font-weight="900" font-size="26" fill="#00f2ff" text-anchor="middle" letter-spacing="4" filter="url(#neonGlow)">NEON PLAYER</text>
        <text x="200" y="375" font-family="'Segoe UI', Roboto, sans-serif" font-weight="600" font-size="14" fill="#ff007f" text-anchor="middle" letter-spacing="2">CYBERPUNK AUDIO ENGINE</text>
      </svg>
    `;

    const blob = new Blob([svg], { type: 'image/svg+xml' });
    return URL.createObjectURL(blob);
  }
}
