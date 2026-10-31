
// Source: id3-reader.js
/**
 * Neon Audio Player - ID3 Tag & Metadata Reader
 * Pure client-side parsing of audio metadata and embedded album art
 */
class ID3Reader {
  /**
   * Parse an audio File object and return metadata + cover art URL
   * @param {File} file 
   * @returns {Promise<{title: string, artist: string, album: string, year: string, genre: string, pictureUrl: string|null}>}
   */
  static async readMetadata(file) {
    const defaultMeta = {
      title: this.cleanFileName(file.name),
      artist: 'Неизвестный исполнитель',
      album: 'Локальный трек',
      year: '',
      genre: '',
      pictureUrl: null,
      fileName: file.name,
      fileSize: file.size,
      format: file.type || file.name.split('.').pop().toUpperCase()
    };

    try {
      // Read first 256KB to locate ID3v2 tags and embedded art
      const bufferSize = Math.min(file.size, 512 * 1024);
      const slice = file.slice(0, bufferSize);
      const arrayBuffer = await slice.arrayBuffer();
      const dataView = new DataView(arrayBuffer);

      // Check for ID3v2 header: "ID3"
      if (
        dataView.getUint8(0) === 0x49 && // 'I'
        dataView.getUint8(1) === 0x44 && // 'D'
        dataView.getUint8(2) === 0x33    // '3'
      ) {
        const version = dataView.getUint8(3); // e.g. 3 for ID3v2.3, 4 for ID3v2.4
        const flags = dataView.getUint8(5);
        const tagSize = this.readSynchsafeInt(dataView, 6);

        // If tagSize exceeds initial buffer and has picture, read full tag if needed
        let fullDataView = dataView;
        if (tagSize > bufferSize && tagSize < 15 * 1024 * 1024) {
          const fullSlice = file.slice(0, tagSize + 10);
          const fullBuffer = await fullSlice.arrayBuffer();
          fullDataView = new DataView(fullBuffer);
        }

        const parsed = this.parseID3v2Frames(fullDataView, version, tagSize);
        return {
          ...defaultMeta,
          ...parsed,
          title: parsed.title || defaultMeta.title,
          artist: parsed.artist || defaultMeta.artist,
          album: parsed.album || defaultMeta.album
        };
      }
    } catch (err) {
      console.warn('ID3 parsing error, using filename fallback:', err);
    }

    return defaultMeta;
  }

  /**
   * Parse ID3v2 frames (TIT2, TPE1, TALB, TYER/TDRC, TCON, APIC)
   */
  static parseID3v2Frames(view, version, tagSize) {
    const result = {
      title: null,
      artist: null,
      album: null,
      year: null,
      genre: null,
      pictureUrl: null
    };

    let offset = 10; // Skip 10-byte header
    const limit = Math.min(view.byteLength, tagSize + 10);

    while (offset + 10 < limit) {
      // Check for null padding
      if (view.getUint8(offset) === 0) break;

      // Frame ID (4 ASCII chars)
      let frameId = '';
      for (let i = 0; i < 4; i++) {
        frameId += String.fromCharCode(view.getUint8(offset + i));
      }

      // Frame size
      let frameSize = 0;
      if (version === 4) {
        frameSize = this.readSynchsafeInt(view, offset + 4);
      } else {
        frameSize = view.getUint32(offset + 4, false);
      }

      if (frameSize <= 0 || offset + 10 + frameSize > view.byteLength) {
        break;
      }

      const frameDataOffset = offset + 10;

      // Extract specific frames
      if (frameId === 'TIT2') { // Title
        result.title = this.decodeTextFrame(view, frameDataOffset, frameSize);
      } else if (frameId === 'TPE1') { // Artist
        result.artist = this.decodeTextFrame(view, frameDataOffset, frameSize);
      } else if (frameId === 'TALB') { // Album
        result.album = this.decodeTextFrame(view, frameDataOffset, frameSize);
      } else if (frameId === 'TYER' || frameId === 'TDRC') { // Year
        result.year = this.decodeTextFrame(view, frameDataOffset, frameSize);
      } else if (frameId === 'TCON') { // Genre
        result.genre = this.decodeTextFrame(view, frameDataOffset, frameSize);
      } else if (frameId === 'APIC' && !result.pictureUrl) { // Attached Picture
        result.pictureUrl = this.decodePictureFrame(view, frameDataOffset, frameSize);
      }

      offset += 10 + frameSize;
    }

    return result;
  }

  /**
   * Decode text frames with encoding byte
   */
  static decodeTextFrame(view, offset, size) {
    if (size <= 1) return null;
    const encoding = view.getUint8(offset);
    const dataOffset = offset + 1;
    const dataLength = size - 1;

    try {
      if (encoding === 0) {
        // ISO-8859-1 (Latin1) / Windows-1251 heuristic
        const bytes = new Uint8Array(view.buffer, view.byteOffset + dataOffset, dataLength);
        const decoder = new TextDecoder('utf-8', { fatal: false });
        let text = decoder.decode(bytes);
        // Clean null characters
        return text.replace(/\0/g, '').trim();
      } else if (encoding === 1) {
        // UTF-16 with BOM
        const bytes = new Uint8Array(view.buffer, view.byteOffset + dataOffset, dataLength);
        const decoder = new TextDecoder('utf-16');
        return decoder.decode(bytes).replace(/\0/g, '').trim();
      } else if (encoding === 2) {
        // UTF-16BE
        const bytes = new Uint8Array(view.buffer, view.byteOffset + dataOffset, dataLength);
        const decoder = new TextDecoder('utf-16be');
        return decoder.decode(bytes).replace(/\0/g, '').trim();
      } else if (encoding === 3) {
        // UTF-8
        const bytes = new Uint8Array(view.buffer, view.byteOffset + dataOffset, dataLength);
        const decoder = new TextDecoder('utf-8');
        return decoder.decode(bytes).replace(/\0/g, '').trim();
      }
    } catch {
      return null;
    }

    return null;
  }

  /**
   * Decode APIC frame (album cover picture) to a Blob URL
   */
  static decodePictureFrame(view, offset, size) {
    try {
      const encoding = view.getUint8(offset);
      let pos = offset + 1;

      // Read MIME type (null-terminated ASCII)
      let mimeType = '';
      while (pos < offset + size && view.getUint8(pos) !== 0) {
        mimeType += String.fromCharCode(view.getUint8(pos));
        pos++;
      }
      pos++; // skip null delimiter

      if (!mimeType) mimeType = 'image/jpeg';

      // Skip picture type (1 byte, e.g. 0x03 for Cover Front)
      pos++;

      // Skip description (null terminated depending on encoding)
      if (encoding === 0 || encoding === 3) {
        while (pos < offset + size && view.getUint8(pos) !== 0) {
          pos++;
        }
        pos++; // skip delimiter
      } else {
        // 2-byte delimiter for UTF-16
        while (pos + 1 < offset + size && (view.getUint8(pos) !== 0 || view.getUint8(pos + 1) !== 0)) {
          pos += 2;
        }
        pos += 2;
      }

      // Remaining bytes are the image data
      if (pos < offset + size) {
        const imageBytes = new Uint8Array(view.buffer, view.byteOffset + pos, (offset + size) - pos);
        const blob = new Blob([imageBytes], { type: mimeType });
        return URL.createObjectURL(blob);
      }
    } catch (e) {
      console.warn('Failed to parse APIC frame:', e);
    }
    return null;
  }

  /**
   * Read 28-bit synchsafe integer from ID3 header/frame
   */
  static readSynchsafeInt(view, offset) {
    return (
      ((view.getUint8(offset) & 0x7f) << 21) |
      ((view.getUint8(offset + 1) & 0x7f) << 14) |
      ((view.getUint8(offset + 2) & 0x7f) << 7) |
      (view.getUint8(offset + 3) & 0x7f)
    );
  }

  /**
   * Clean filename to presentable track name
   */
  static cleanFileName(filename) {
    // Remove extension
    let name = filename.replace(/\.[^/.]+$/, '');
    // Clean track numbers like "01 - " or "01."
    name = name.replace(/^\d+[\s.-]+/, '');
    // Replace underscores with spaces
    name = name.replace(/_/g, ' ');
    return name.trim();
  }
}


// Source: synth-demo.js
/**
 * Neon Audio Player - Built-in Synthwave Generator
 * Generates an energetic cyberpunk synthwave loop client-side as a WAV Blob
 * for instant testing without needing any external audio files!
 */
class SynthDemoGenerator {
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


// Source: audio-engine.js
/**
 * Neon Audio Player - Web Audio API Engine
 * Handles audio playback, 10-band equalizer, bass boost, preamp, and spectrum analysis
 */
class AudioEngine {
  constructor() {
    this.audioCtx = null;
    this.audioElement = new Audio();
    this.audioElement.preload = 'metadata';
    this.audioElement.crossOrigin = 'anonymous';

    this.sourceNode = null;
    this.preampGain = null;
    this.eqFilters = [];
    this.bassFilter = null;
    this.analyser = null;
    this.masterGain = null;

    this.isInitialized = false;
    this.eqEnabled = true;

    // Standard 10-band ISO frequencies
    this.frequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    this.currentGains = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    this.bassBoostAmount = 0; // 0 to 15 dB
    this.preampAmount = 0; // -6 to +6 dB

    // Presets
    this.presets = {
      flat: { name: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bass: 0 },
      bassBoost: { name: 'Bass Boost', gains: [8, 7, 5, 2, 0, 0, 0, 0, 1, 2], bass: 8 },
      cyberpunk: { name: 'Cyberpunk EDM', gains: [7, 6, 3, -1, -2, 1, 3, 5, 6, 6], bass: 6 },
      synthwave: { name: 'Synthwave', gains: [6, 5, 2, 0, -1, 1, 2, 4, 5, 4], bass: 5 },
      rock: { name: 'Rock', gains: [5, 4, 2, -1, -2, 1, 3, 4, 5, 5], bass: 3 },
      pop: { name: 'Pop', gains: [-1, 1, 3, 4, 4, 2, 0, 1, 3, 3], bass: 2 },
      hiphop: { name: 'Hip-Hop', gains: [8, 7, 4, 1, -1, -1, 1, 2, 4, 3], bass: 7 },
      techno: { name: 'Techno', gains: [7, 6, 2, -2, -1, 0, 2, 5, 6, 4], bass: 6 },
      jazz: { name: 'Jazz', gains: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3], bass: 1 },
      acoustic: { name: 'Acoustic', gains: [3, 2, 1, 1, 2, 2, 3, 3, 2, 1], bass: 1 },
      vocal: { name: 'Vocal Boost', gains: [-3, -2, -1, 1, 4, 5, 4, 2, 0, -2], bass: 0 }
    };
  }

  /**
   * Initialize Web Audio context upon first user gesture
   */
  initContext() {
    if (this.isInitialized) {
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.audioCtx = new AudioContextClass();

    // Source node from audio element
    this.sourceNode = this.audioCtx.createMediaElementSource(this.audioElement);

    // Preamp node
    this.preampGain = this.audioCtx.createGain();
    this.preampGain.gain.value = 1.0;

    // 10-band Equalizer chain
    this.eqFilters = this.frequencies.map((freq, i) => {
      const filter = this.audioCtx.createBiquadFilter();
      if (i === 0) {
        filter.type = 'lowshelf';
      } else if (i === this.frequencies.length - 1) {
        filter.type = 'highshelf';
      } else {
        filter.type = 'peaking';
        filter.Q.value = 1.4;
      }
      filter.frequency.value = freq;
      filter.gain.value = 0;
      return filter;
    });

    // Bass Boost Filter (Low-shelf resonant at 70Hz)
    this.bassFilter = this.audioCtx.createBiquadFilter();
    this.bassFilter.type = 'lowshelf';
    this.bassFilter.frequency.value = 75;
    this.bassFilter.gain.value = 0;

    // Analyser node for Canvas Visualizer
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 512; // 256 frequency bins
    this.analyser.smoothingTimeConstant = 0.82;
    this.analyser.minDecibels = -90;
    this.analyser.maxDecibels = -10;

    // Master Gain node
    this.masterGain = this.audioCtx.createGain();
    this.masterGain.gain.value = 1.0;

    // Connect node chain:
    // source -> preamp -> eq[0] -> ... -> eq[9] -> bassFilter -> analyser -> masterGain -> destination
    let currentNode = this.sourceNode;
    currentNode.connect(this.preampGain);
    currentNode = this.preampGain;

    this.eqFilters.forEach(filter => {
      currentNode.connect(filter);
      currentNode = filter;
    });

    currentNode.connect(this.bassFilter);
    currentNode = this.bassFilter;

    currentNode.connect(this.analyser);
    this.analyser.connect(this.masterGain);
    this.masterGain.connect(this.audioCtx.destination);

    this.isInitialized = true;
  }

  /**
   * Resume context if suspended (needed on mobile browsers)
   */
  async ensureRunning() {
    if (!this.isInitialized) {
      this.initContext();
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
  }

  /**
   * Load track audio URL
   */
  loadSource(src) {
    this.audioElement.src = src;
    this.audioElement.load();
  }

  async play() {
    await this.ensureRunning();
    return this.audioElement.play();
  }

  pause() {
    this.audioElement.pause();
  }

  togglePlay() {
    if (this.audioElement.paused) {
      return this.play();
    } else {
      this.pause();
      return Promise.resolve();
    }
  }

  seek(seconds) {
    if (!isNaN(seconds) && isFinite(seconds)) {
      this.audioElement.currentTime = Math.max(0, Math.min(seconds, this.audioElement.duration || 0));
    }
  }

  setVolume(fraction) {
    const val = Math.max(0, Math.min(1, fraction));
    if (this.masterGain && this.isInitialized) {
      this.masterGain.gain.setTargetAtTime(val, this.audioCtx.currentTime, 0.02);
    }
    this.audioElement.volume = val;
  }

  /**
   * Set gain for specific frequency band (index 0 to 9, value -12dB to +12dB)
   */
  setBandGain(index, gainDb) {
    if (index >= 0 && index < this.eqFilters.length) {
      this.currentGains[index] = gainDb;
      if (this.isInitialized && this.eqEnabled) {
        this.eqFilters[index].gain.setTargetAtTime(gainDb, this.audioCtx.currentTime, 0.03);
      }
    }
  }

  /**
   * Set Bass Boost in dB (0 to +15 dB)
   */
  setBassBoost(boostDb) {
    this.bassBoostAmount = Math.max(0, Math.min(15, boostDb));
    if (this.bassFilter && this.isInitialized && this.eqEnabled) {
      this.bassFilter.gain.setTargetAtTime(this.bassBoostAmount, this.audioCtx.currentTime, 0.03);
    }
  }

  /**
   * Set Preamp gain in dB (-6 to +6 dB)
   */
  setPreamp(gainDb) {
    this.preampAmount = Math.max(-6, Math.min(6, gainDb));
    if (this.preampGain && this.isInitialized) {
      const linearGain = Math.pow(10, this.preampAmount / 20);
      this.preampGain.gain.setTargetAtTime(linearGain, this.audioCtx.currentTime, 0.03);
    }
  }

  /**
   * Apply a preset by name
   */
  applyPreset(presetKey) {
    const preset = this.presets[presetKey];
    if (!preset) return null;

    preset.gains.forEach((gain, i) => {
      this.setBandGain(i, gain);
    });
    this.setBassBoost(preset.bass || 0);
    return preset;
  }

  /**
   * Toggle EQ bypass
   */
  toggleBypass() {
    this.eqEnabled = !this.eqEnabled;
    if (this.isInitialized) {
      this.eqFilters.forEach((filter, i) => {
        const targetGain = this.eqEnabled ? this.currentGains[i] : 0;
        filter.gain.setTargetAtTime(targetGain, this.audioCtx.currentTime, 0.03);
      });
      const targetBass = this.eqEnabled ? this.bassBoostAmount : 0;
      this.bassFilter.gain.setTargetAtTime(targetBass, this.audioCtx.currentTime, 0.03);
    }
    return this.eqEnabled;
  }

  /**
   * Reset all EQ sliders to 0 dB
   */
  resetEQ() {
    this.currentGains = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    this.bassBoostAmount = 0;
    this.preampAmount = 0;
    this.setPreamp(0);
    this.setBassBoost(0);
    this.currentGains.forEach((_, i) => this.setBandGain(i, 0));
  }

  /**
   * Visualizer: Get frequency data (Uint8Array)
   */
  getFrequencyData() {
    if (!this.analyser) return new Uint8Array(256);
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    return data;
  }

  /**
   * Visualizer: Get time domain waveform data (Uint8Array)
   */
  getTimeDomainData() {
    if (!this.analyser) return new Uint8Array(256);
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    return data;
  }

  /**
   * Calculate average bass energy (0.0 to 1.0) for reactive pulsing animations
   */
  getBassEnergy() {
    if (!this.analyser || this.audioElement.paused) return 0;
    const freq = this.getFrequencyData();
    // Sub-bass & Bass: first ~10 bins (up to ~180Hz)
    let sum = 0;
    const count = 12;
    for (let i = 0; i < count; i++) {
      sum += freq[i];
    }
    return (sum / count) / 255;
  }

  get duration() {
    return this.audioElement.duration || 0;
  }

  get currentTime() {
    return this.audioElement.currentTime || 0;
  }

  get isPaused() {
    return this.audioElement.paused;
  }
}


// Source: visualizer.js
/**
 * Neon Audio Player - Reactive Canvas Spectrum Visualizer
 * Multi-mode 60fps neon visualizer: Bars with Peak Caps, Radial Pulse, Laser Waveform, and Starburst
 */
class SpectrumVisualizer {
  constructor(canvas, audioEngine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.audioEngine = audioEngine;

    this.mode = 'bars'; // 'bars' | 'radial' | 'wave' | 'starburst'
    this.isRunning = false;
    this.animationId = null;

    // Visualizer settings
    this.sensitivity = 1.0;
    this.barCount = 64;
    this.peaks = new Array(this.barCount).fill(0);
    this.peakHold = new Array(this.barCount).fill(0);

    // Particle system for starburst mode
    this.particles = [];
    this.maxParticles = 80;

    // Neon color palette
    this.colors = {
      primary: '#00f2ff',   // Electric Cyan
      secondary: '#ff007f', // Neon Pink
      accent: '#a855f7',    // Neon Purple
      glow: 'rgba(0, 242, 255, 0.4)',
      bg: '#08090f'
    };

    this.rotationAngle = 0;
    this.setupResizeListener();
    this.resize();
    this.initParticles();
  }

  setThemeColors(primary, secondary, accent) {
    this.colors.primary = primary;
    this.colors.secondary = secondary;
    this.colors.accent = accent;
    this.colors.glow = primary + '66';
  }

  setMode(mode) {
    this.mode = mode;
  }

  setSensitivity(val) {
    this.sensitivity = Math.max(0.4, Math.min(2.5, val));
  }

  setupResizeListener() {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 100));
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.width = rect.width || 360;
    this.height = rect.height || 240;

    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);

    this.ctx.resetTransform?.();
    this.ctx.scale(dpr, dpr);
  }

  initParticles() {
    this.particles = [];
    for (let i = 0; i < this.maxParticles; i++) {
      this.particles.push({
        x: (Math.random() - 0.5) * 100,
        y: (Math.random() - 0.5) * 100,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        size: Math.random() * 3 + 1,
        color: Math.random() > 0.5 ? this.colors.primary : this.colors.secondary,
        alpha: Math.random() * 0.8 + 0.2
      });
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    const loop = () => {
      if (this.isRunning) {
        this.render();
        this.animationId = requestAnimationFrame(loop);
      }
    };
    this.animationId = requestAnimationFrame(loop);
  }

  stop() {
    this.isRunning = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  render() {
    const { ctx, width, height } = this;
    if (!ctx || width === 0 || height === 0) return;

    // Clear background with soft fade trail for neon bloom effect
    ctx.fillStyle = 'rgba(8, 9, 15, 0.45)';
    ctx.fillRect(0, 0, width, height);

    const freqData = this.audioEngine.getFrequencyData();
    const timeData = this.audioEngine.getTimeDomainData();
    const bassEnergy = this.audioEngine.getBassEnergy();
    const isPaused = this.audioEngine.isPaused;

    switch (this.mode) {
      case 'bars':
        this.renderCyberBars(freqData, isPaused, bassEnergy);
        break;
      case 'radial':
        this.renderRadialPulse(freqData, isPaused, bassEnergy);
        break;
      case 'wave':
        this.renderLaserWave(timeData, isPaused, bassEnergy);
        break;
      case 'starburst':
        this.renderStarburst(freqData, isPaused, bassEnergy);
        break;
      default:
        this.renderCyberBars(freqData, isPaused, bassEnergy);
    }
  }

  /**
   * Mode 1: Cyber Neon Bars with gravity peak caps and baseline reflection
   */
  renderCyberBars(freqData, isPaused, bassEnergy) {
    const { ctx, width, height } = this;
    const count = this.barCount;
    const barWidth = (width / count) * 0.72;
    const spacing = (width / count) * 0.28;
    const baseline = height * 0.78;

    // Dynamic gradient
    const grad = ctx.createLinearGradient(0, baseline, 0, height * 0.1);
    grad.addColorStop(0, this.colors.primary);
    grad.addColorStop(0.5, this.colors.secondary);
    grad.addColorStop(1, '#ffffff');

    // Reflection gradient
    const reflGrad = ctx.createLinearGradient(0, baseline, 0, height);
    reflGrad.addColorStop(0, this.colors.glow);
    reflGrad.addColorStop(1, 'transparent');

    for (let i = 0; i < count; i++) {
      // Sample frequency with non-linear perceptual distribution
      const index = Math.floor(Math.pow(i / count, 1.35) * (freqData.length * 0.75));
      let val = isPaused ? 0 : (freqData[index] || 0) * this.sensitivity;

      // Add gentle idle ambient animation if paused
      if (isPaused) {
        val = (Math.sin(Date.now() * 0.003 + i * 0.2) * 0.5 + 0.5) * 8;
      }

      const barHeight = Math.min((val / 255) * (baseline - 15), baseline - 5);
      const x = i * (barWidth + spacing) + spacing / 2;
      const y = baseline - barHeight;

      // Peak drop physics
      if (barHeight > this.peaks[i]) {
        this.peaks[i] = barHeight;
        this.peakHold[i] = 12; // Hold frames before dropping
      } else {
        if (this.peakHold[i] > 0) {
          this.peakHold[i]--;
        } else {
          this.peaks[i] = Math.max(0, this.peaks[i] - 2.8);
        }
      }

      // Draw Main Neon Bar
      ctx.fillStyle = grad;
      ctx.shadowBlur = 10 + bassEnergy * 8;
      ctx.shadowColor = this.colors.primary;
      this.drawRoundedRect(ctx, x, y, barWidth, barHeight, 3);
      ctx.fill();

      // Draw Floating Peak Cap
      const peakY = baseline - this.peaks[i] - 3;
      ctx.fillStyle = '#ffffff';
      ctx.shadowBlur = 12;
      ctx.shadowColor = this.colors.secondary;
      ctx.fillRect(x, Math.max(5, peakY), barWidth, 2.5);

      // Draw Mirror Reflection
      const reflHeight = barHeight * 0.32;
      if (reflHeight > 1) {
        ctx.fillStyle = reflGrad;
        ctx.shadowBlur = 0;
        this.drawRoundedRect(ctx, x, baseline + 3, barWidth, reflHeight, 2);
        ctx.fill();
      }
    }

    // Baseline glowing laser line
    ctx.beginPath();
    ctx.moveTo(0, baseline);
    ctx.lineTo(width, baseline);
    ctx.strokeStyle = this.colors.primary;
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 8;
    ctx.shadowColor = this.colors.primary;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  /**
   * Mode 2: Radial Cyber Pulse surrounding pulsing center
   */
  renderRadialPulse(freqData, isPaused, bassEnergy) {
    const { ctx, width, height } = this;
    const cx = width / 2;
    const cy = height / 2;
    const baseRadius = Math.min(width, height) * 0.22 + (bassEnergy * 24);
    const bars = 72;

    this.rotationAngle += 0.005 + (bassEnergy * 0.015);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.rotationAngle);

    // Center pulsating ring
    ctx.beginPath();
    ctx.arc(0, 0, baseRadius * 0.9, 0, Math.PI * 2);
    ctx.strokeStyle = this.colors.secondary;
    ctx.lineWidth = 2 + bassEnergy * 4;
    ctx.shadowBlur = 18 + bassEnergy * 15;
    ctx.shadowColor = this.colors.secondary;
    ctx.stroke();

    // Center core glow
    const coreGrad = ctx.createRadialGradient(0, 0, 5, 0, 0, baseRadius * 0.85);
    coreGrad.addColorStop(0, 'rgba(255, 0, 127, ' + (0.15 + bassEnergy * 0.3) + ')');
    coreGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = coreGrad;
    ctx.fill();

    // Radial frequency bars
    for (let i = 0; i < bars; i++) {
      const angle = (i / bars) * Math.PI * 2;
      const index = Math.floor(Math.pow(i / bars, 1.2) * (freqData.length * 0.6));
      let val = isPaused ? 6 : (freqData[index] || 0) * this.sensitivity;

      const barLen = (val / 255) * (Math.min(width, height) * 0.32);

      const x1 = Math.cos(angle) * baseRadius;
      const y1 = Math.sin(angle) * baseRadius;
      const x2 = Math.cos(angle) * (baseRadius + barLen);
      const y2 = Math.sin(angle) * (baseRadius + barLen);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = i % 2 === 0 ? this.colors.primary : this.colors.accent;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.shadowBlur = 10;
      ctx.shadowColor = this.colors.primary;
      ctx.stroke();
    }

    ctx.restore();
    ctx.shadowBlur = 0;
  }

  /**
   * Mode 3: Electric Laser Waveform (Oscilloscope)
   */
  renderLaserWave(timeData, isPaused, bassEnergy) {
    const { ctx, width, height } = this;
    const sliceWidth = width / (timeData.length - 1);
    const midY = height / 2;

    // Draw multi-layered laser beam
    const drawWave = (color, blur, lineWidth, amp) => {
      ctx.beginPath();
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = color;
      ctx.shadowBlur = blur;
      ctx.shadowColor = color;

      for (let i = 0; i < timeData.length; i++) {
        let v = (timeData[i] - 128) / 128.0;
        if (isPaused) {
          v = Math.sin(Date.now() * 0.005 + i * 0.08) * 0.12;
        }
        const y = midY + v * (height * 0.38) * amp * this.sensitivity;
        const x = i * sliceWidth;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    };

    // Layer 1: Wide neon outer bloom
    drawWave(this.colors.secondary, 25 + bassEnergy * 20, 6, 1.0);
    // Layer 2: Sharp electric cyan wave
    drawWave(this.colors.primary, 12, 3, 1.0);
    // Layer 3: Hot white laser core
    drawWave('#ffffff', 6, 1.5, 1.0);

    ctx.shadowBlur = 0;
  }

  /**
   * Mode 4: Starburst & Cyber Particle Reactor
   */
  renderStarburst(freqData, isPaused, bassEnergy) {
    const { ctx, width, height } = this;
    const cx = width / 2;
    const cy = height / 2;

    // Shockwave pulse
    if (bassEnergy > 0.45) {
      ctx.beginPath();
      ctx.arc(cx, cy, bassEnergy * (Math.min(width, height) * 0.45), 0, Math.PI * 2);
      ctx.strokeStyle = this.colors.secondary;
      ctx.lineWidth = 3;
      ctx.shadowBlur = 20;
      ctx.shadowColor = this.colors.secondary;
      ctx.stroke();
    }

    // Particle update & render
    ctx.shadowBlur = 10;
    this.particles.forEach(p => {
      const speedMult = 1.0 + (bassEnergy * 3.5);
      p.x += p.vx * speedMult;
      p.y += p.vy * speedMult;

      // Wrap around bounds
      if (Math.abs(p.x) > width / 2) p.x = (Math.random() - 0.5) * 40;
      if (Math.abs(p.y) > height / 2) p.y = (Math.random() - 0.5) * 40;

      ctx.beginPath();
      ctx.arc(cx + p.x, cy + p.y, p.size * (1 + bassEnergy * 1.5), 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.fill();
    });

    // Connecting neon constellation lines when close
    ctx.lineWidth = 0.8;
    for (let i = 0; i < this.particles.length; i += 2) {
      for (let j = i + 1; j < this.particles.length; j += 4) {
        const dx = this.particles[i].x - this.particles[j].x;
        const dy = this.particles[i].y - this.particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 60) {
          ctx.beginPath();
          ctx.moveTo(cx + this.particles[i].x, cy + this.particles[i].y);
          ctx.lineTo(cx + this.particles[j].x, cy + this.particles[j].y);
          ctx.strokeStyle = `rgba(0, 242, 255, ${0.4 - dist / 150})`;
          ctx.stroke();
        }
      }
    }

    ctx.shadowBlur = 0;
  }

  drawRoundedRect(ctx, x, y, width, height, radius) {
    if (height <= 0) return;
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height);
    ctx.lineTo(x, y + height);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}


// Source: media-session.js
/**
 * Neon Audio Player - MediaSession API Integration
 * Connects player with phone lockscreen, notification controls, and Bluetooth headsets
 */
class MediaSessionController {
  constructor(audioEngine, playlistManager) {
    this.audioEngine = audioEngine;
    this.playlistManager = playlistManager;
    this.isSupported = 'mediaSession' in navigator;

    if (this.isSupported) {
      this.initHandlers();
    }
  }

  initHandlers() {
    const ms = navigator.mediaSession;

    try {
      ms.setActionHandler('play', async () => {
        await this.audioEngine.play();
        this.updatePlaybackState('playing');
      });

      ms.setActionHandler('pause', () => {
        this.audioEngine.pause();
        this.updatePlaybackState('paused');
      });

      ms.setActionHandler('previoustrack', () => {
        this.playlistManager.prev();
      });

      ms.setActionHandler('nexttrack', () => {
        this.playlistManager.next();
      });

      ms.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined && details.seekTime !== null) {
          this.audioEngine.seek(details.seekTime);
          this.updatePositionState();
        }
      });

      ms.setActionHandler('seekforward', (details) => {
        const skip = details.seekOffset || 10;
        this.audioEngine.seek(this.audioEngine.currentTime + skip);
        this.updatePositionState();
      });

      ms.setActionHandler('seekbackward', (details) => {
        const skip = details.seekOffset || 10;
        this.audioEngine.seek(this.audioEngine.currentTime - skip);
        this.updatePositionState();
      });
    } catch (e) {
      console.warn('Some MediaSession action handlers are not supported:', e);
    }
  }

  updateMetadata(track) {
    if (!this.isSupported || !track) return;

    const artwork = [];
    if (track.pictureUrl) {
      artwork.push({
        src: track.pictureUrl,
        sizes: '512x512',
        type: 'image/jpeg'
      });
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || 'Неизвестный трек',
      artist: track.artist || 'Неизвестный исполнитель',
      album: track.album || 'Neon Player',
      artwork
    });

    this.updatePositionState();
  }

  updatePlaybackState(state) {
    if (!this.isSupported) return;
    navigator.mediaSession.playbackState = state; // 'playing', 'paused', 'none'
  }

  updatePositionState() {
    if (!this.isSupported || !navigator.mediaSession.setPositionState) return;

    try {
      const duration = this.audioEngine.duration;
      const position = this.audioEngine.currentTime;
      if (duration && isFinite(duration) && duration > 0) {
        navigator.mediaSession.setPositionState({
          duration: Math.max(0, duration),
          playbackRate: 1.0,
          position: Math.max(0, Math.min(position, duration))
        });
      }
    } catch {
      // Ignored if audio is in transition
    }
  }
}


// Source: playlist.js
/**
 * Neon Audio Player - Playlist Manager
 * Handles track management, drag-and-drop file ingestion, and drag-and-drop playlist reordering (desktop + touch)
 */
class PlaylistManager {
  constructor(onTrackSelect, onPlaylistUpdate) {
    this.tracks = [];
    this.currentIndex = -1;
    this.onTrackSelect = onTrackSelect;
    this.onPlaylistUpdate = onPlaylistUpdate;

    this.repeatMode = 'all'; // 'all' | 'one' | 'none'
    this.shuffleMode = false;
    this.shuffledIndices = [];

    // Drag-and-drop state
    this.draggedIndex = null;
    this.touchDragElement = null;
    this.touchStartIndex = null;
  }

  /**
   * Add File objects to playlist
   */
  async addFiles(fileList) {
    const files = Array.from(fileList).filter(f => f.type.startsWith('audio/') || /\.(mp3|flac|wav|ogg|m4a|aac|webm)$/i.test(f.name));
    if (files.length === 0) return [];

    const newTracks = [];

    for (const file of files) {
      const metadata = await ID3Reader.readMetadata(file);
      const src = URL.createObjectURL(file);
      const track = {
        id: 'trk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        file,
        src,
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
        year: metadata.year,
        genre: metadata.genre,
        pictureUrl: metadata.pictureUrl,
        duration: 0
      };

      // Probe duration
      this.probeDuration(track);
      newTracks.push(track);
    }

    this.tracks.push(...newTracks);
    this.updateShuffleIndices();
    this.notifyUpdate();

    // If first track added and player idle, select it
    if (this.currentIndex === -1 && this.tracks.length > 0) {
      this.selectTrack(0, false);
    }

    return newTracks;
  }

  /**
   * Probe track duration using temporary audio element
   */
  probeDuration(track) {
    const tempAudio = new Audio();
    tempAudio.preload = 'metadata';
    tempAudio.src = track.src;
    tempAudio.onloadedmetadata = () => {
      track.duration = tempAudio.duration;
      this.notifyUpdate();
      tempAudio.src = '';
    };
  }

  /**
   * Add a custom synthesized track (e.g. demo track)
   */
  addCustomTrack(title, artist, src, pictureUrl = null, duration = 60) {
    const track = {
      id: 'demo_' + Date.now(),
      file: null,
      src,
      title,
      artist,
      album: 'Neon Synthwave',
      year: '2026',
      genre: 'Cyberpunk',
      pictureUrl,
      duration
    };
    this.tracks.push(track);
    this.updateShuffleIndices();
    this.notifyUpdate();
    if (this.currentIndex === -1) {
      this.selectTrack(this.tracks.length - 1, false);
    }
  }

  /**
   * Select track by index
   */
  selectTrack(index, autoPlay = true) {
    if (index >= 0 && index < this.tracks.length) {
      this.currentIndex = index;
      const track = this.tracks[index];
      if (this.onTrackSelect) {
        this.onTrackSelect(track, autoPlay);
      }
      this.notifyUpdate();
    }
  }

  getCurrentTrack() {
    if (this.currentIndex >= 0 && this.currentIndex < this.tracks.length) {
      return this.tracks[this.currentIndex];
    }
    return null;
  }

  /**
   * Next track based on repeat and shuffle modes
   */
  next() {
    if (this.tracks.length === 0) return null;

    if (this.repeatMode === 'one' && this.currentIndex !== -1) {
      this.selectTrack(this.currentIndex, true);
      return this.getCurrentTrack();
    }

    let nextIndex;
    if (this.shuffleMode) {
      const currentPos = this.shuffledIndices.indexOf(this.currentIndex);
      if (currentPos >= 0 && currentPos + 1 < this.shuffledIndices.length) {
        nextIndex = this.shuffledIndices[currentPos + 1];
      } else {
        if (this.repeatMode === 'all') {
          this.updateShuffleIndices();
          nextIndex = this.shuffledIndices[0];
        } else {
          return null; // end of playlist
        }
      }
    } else {
      if (this.currentIndex + 1 < this.tracks.length) {
        nextIndex = this.currentIndex + 1;
      } else {
        if (this.repeatMode === 'all') {
          nextIndex = 0;
        } else {
          return null;
        }
      }
    }

    this.selectTrack(nextIndex, true);
    return this.getCurrentTrack();
  }

  /**
   * Previous track
   */
  prev() {
    if (this.tracks.length === 0) return null;

    let prevIndex;
    if (this.shuffleMode) {
      const currentPos = this.shuffledIndices.indexOf(this.currentIndex);
      if (currentPos > 0) {
        prevIndex = this.shuffledIndices[currentPos - 1];
      } else {
        prevIndex = this.shuffledIndices[this.shuffledIndices.length - 1];
      }
    } else {
      if (this.currentIndex - 1 >= 0) {
        prevIndex = this.currentIndex - 1;
      } else {
        prevIndex = this.tracks.length - 1;
      }
    }

    this.selectTrack(prevIndex, true);
    return this.getCurrentTrack();
  }

  toggleShuffle() {
    this.shuffleMode = !this.shuffleMode;
    if (this.shuffleMode) {
      this.updateShuffleIndices();
    }
    return this.shuffleMode;
  }

  toggleRepeat() {
    if (this.repeatMode === 'all') {
      this.repeatMode = 'one';
    } else if (this.repeatMode === 'one') {
      this.repeatMode = 'none';
    } else {
      this.repeatMode = 'all';
    }
    return this.repeatMode;
  }

  updateShuffleIndices() {
    this.shuffledIndices = this.tracks.map((_, i) => i);
    for (let i = this.shuffledIndices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.shuffledIndices[i], this.shuffledIndices[j]] = [this.shuffledIndices[j], this.shuffledIndices[i]];
    }
  }

  /**
   * Reorder tracks via Drag-and-Drop
   */
  moveTrack(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= this.tracks.length || toIndex >= this.tracks.length) {
      return;
    }

    const currentTrack = this.getCurrentTrack();
    const [moved] = this.tracks.splice(fromIndex, 1);
    this.tracks.splice(toIndex, 0, moved);

    // Update currentIndex to keep track of current song
    if (currentTrack) {
      this.currentIndex = this.tracks.findIndex(t => t.id === currentTrack.id);
    }

    this.updateShuffleIndices();
    this.notifyUpdate();
  }

  removeTrack(index) {
    if (index < 0 || index >= this.tracks.length) return;

    const [removed] = this.tracks.splice(index, 1);
    if (removed && removed.src && removed.src.startsWith('blob:')) {
      URL.revokeObjectURL(removed.src);
    }
    if (removed && removed.pictureUrl && removed.pictureUrl.startsWith('blob:')) {
      URL.revokeObjectURL(removed.pictureUrl);
    }

    if (this.currentIndex === index) {
      if (this.tracks.length > 0) {
        this.selectTrack(Math.min(index, this.tracks.length - 1), false);
      } else {
        this.currentIndex = -1;
      }
    } else if (this.currentIndex > index) {
      this.currentIndex--;
    }

    this.updateShuffleIndices();
    this.notifyUpdate();
  }

  clear() {
    this.tracks.forEach(t => {
      if (t.src && t.src.startsWith('blob:')) URL.revokeObjectURL(t.src);
      if (t.pictureUrl && t.pictureUrl.startsWith('blob:')) URL.revokeObjectURL(t.pictureUrl);
    });
    this.tracks = [];
    this.currentIndex = -1;
    this.notifyUpdate();
  }

  notifyUpdate() {
    if (this.onPlaylistUpdate) {
      this.onPlaylistUpdate(this.tracks, this.currentIndex);
    }
  }
}


// Source: app.js
/**
 * Neon Audio Player - Main Application Orchestrator
 */





class NeonApp {
  constructor() {
    this.audio = new AudioEngine();
    this.playlist = new PlaylistManager(
      (track, autoPlay) => this.onTrackLoaded(track, autoPlay),
      (tracks, currentIdx) => this.renderPlaylist(tracks, currentIdx)
    );
    this.mediaSession = new MediaSessionController(this.audio, this.playlist);

    this.miniVisualizer = null;
    this.fullscreenVisualizer = null;

    this.sleepTimerId = null;
    this.deferredPrompt = null;
    this.searchQuery = '';

    this.initDOM();
    this.initVisualizers();
    this.initEqualizerUI();
    this.initEventListeners();
    this.initDragAndDrop();
    this.initPWA();

    // Set initial fallback artwork
    this.setFallbackArtwork();

    // Auto-synthesize initial demo track so the player is ready to test immediately!
    this.addDemoSynthTrack(false);
  }

  initDOM() {
    // Views & Nav
    this.tabViews = document.querySelectorAll('.tab-view');
    this.navBtns = document.querySelectorAll('.nav-tab-btn');

    // Player Elements
    this.albumArt = document.getElementById('album-art');
    this.artworkCard = document.getElementById('artwork-card');
    this.trackTitle = document.getElementById('track-title');
    this.trackArtist = document.getElementById('track-artist');
    this.trackFormat = document.getElementById('track-format');
    this.progressBar = document.getElementById('progress-bar');
    this.timeCurrent = document.getElementById('time-current');
    this.timeDuration = document.getElementById('time-duration');
    this.btnPlayPause = document.getElementById('btn-play-pause');
    this.btnPrev = document.getElementById('btn-prev');
    this.btnNext = document.getElementById('btn-next');
    this.btnShuffle = document.getElementById('btn-shuffle');
    this.btnRepeat = document.getElementById('btn-repeat');
    this.volumeSlider = document.getElementById('volume-slider');
    this.btnMute = document.getElementById('btn-mute');

    // Playlist Elements
    this.trackListContainer = document.getElementById('track-list-container');
    this.playlistDropzone = document.getElementById('playlist-dropzone');
    this.playlistSearch = document.getElementById('playlist-search');
    this.inputFiles = document.getElementById('input-files');
    this.inputFolder = document.getElementById('input-folder');
    this.emptyPlaylistMsg = document.getElementById('empty-playlist-msg');

    // Equalizer Elements
    this.eqBypassToggle = document.getElementById('eq-bypass-toggle');
    this.eqPresetsSelect = document.getElementById('eq-presets-select');
    this.btnResetEq = document.getElementById('btn-reset-eq');
    this.sliderPreamp = document.getElementById('slider-preamp');
    this.valPreamp = document.getElementById('val-preamp');
    this.sliderBassBoost = document.getElementById('slider-bass-boost');
    this.valBassBoost = document.getElementById('val-bass-boost');
    this.eqFadersGrid = document.getElementById('eq-faders-grid');
    this.genrePresetBtns = document.querySelectorAll('.preset-chip');

    // Visualizer Elements
    this.miniVisCanvas = document.getElementById('mini-visualizer');
    this.fsVisCanvas = document.getElementById('fullscreen-visualizer');
    this.visModeBtns = document.querySelectorAll('.mode-btn');
    this.visSensitivity = document.getElementById('vis-sensitivity');

    // Modal & Toast
    this.timerModal = document.getElementById('timer-modal');
    this.toastContainer = document.getElementById('toast-container');
  }

  initVisualizers() {
    this.miniVisualizer = new SpectrumVisualizer(this.miniVisCanvas, this.audio);
    this.miniVisualizer.barCount = 36;
    this.miniVisualizer.start();

    this.fullscreenVisualizer = new SpectrumVisualizer(this.fsVisCanvas, this.audio);
    this.fullscreenVisualizer.start();

    // Reactive album cover glow pulsing to bass kicks
    const pulseLoop = () => {
      const bass = this.audio.getBassEnergy();
      if (this.artworkCard) {
        const glow = 15 + bass * 35;
        const scale = 1.0 + bass * 0.04;
        this.artworkCard.style.boxShadow = `0 10px 30px rgba(0, 0, 0, 0.7), 0 0 ${glow}px var(--neon-primary)`;
        this.artworkCard.style.transform = `scale(${scale})`;
      }
      requestAnimationFrame(pulseLoop);
    };
    pulseLoop();
  }

  initEqualizerUI() {
    // Generate 10 vertical band faders dynamically
    this.eqFadersGrid.innerHTML = '';
    const labels = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];

    this.audio.frequencies.forEach((freq, idx) => {
      const col = document.createElement('div');
      col.className = 'eq-band-col';

      const dbLabel = document.createElement('div');
      dbLabel.className = 'band-db-val';
      dbLabel.id = `band-db-${idx}`;
      dbLabel.textContent = '0dB';

      const sliderWrap = document.createElement('div');
      sliderWrap.className = 'vertical-slider-wrap';

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'vertical-range';
      slider.id = `band-slider-${idx}`;
      slider.min = '-12';
      slider.max = '12';
      slider.step = '0.5';
      slider.value = '0';

      slider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.audio.setBandGain(idx, val);
        dbLabel.textContent = (val > 0 ? '+' : '') + val.toFixed(1) + 'dB';
        this.clearActivePresetChip();
      });

      const freqLabel = document.createElement('div');
      freqLabel.className = 'band-freq-label';
      freqLabel.textContent = labels[idx];

      sliderWrap.appendChild(slider);
      col.appendChild(dbLabel);
      col.appendChild(sliderWrap);
      col.appendChild(freqLabel);
      this.eqFadersGrid.appendChild(col);
    });
  }

  initEventListeners() {
    // Navigation Tabs
    this.navBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        this.switchTab(targetTab);
      });
    });

    // Playback Controls
    this.btnPlayPause.addEventListener('click', async () => {
      await this.audio.togglePlay();
      this.updatePlayPauseIcon();
    });

    this.btnPrev.addEventListener('click', () => {
      this.playlist.prev();
    });

    this.btnNext.addEventListener('click', () => {
      this.playlist.next();
    });

    this.btnShuffle.addEventListener('click', () => {
      const active = this.playlist.toggleShuffle();
      this.btnShuffle.classList.toggle('active-toggle', active);
      this.showToast(active ? 'Случайный порядок: ВКЛ' : 'Случайный порядок: ВЫКЛ');
    });

    this.btnRepeat.addEventListener('click', () => {
      const mode = this.playlist.toggleRepeat();
      if (mode === 'all') {
        this.btnRepeat.textContent = '🔁';
        this.btnRepeat.classList.add('active-toggle');
        this.showToast('Повтор: Все треки');
      } else if (mode === 'one') {
        this.btnRepeat.textContent = '🔂';
        this.btnRepeat.classList.add('active-toggle');
        this.showToast('Повтор: Один трек');
      } else {
        this.btnRepeat.textContent = '🔁';
        this.btnRepeat.classList.remove('active-toggle');
        this.showToast('Повтор: Отключен');
      }
    });

    // Progress Bar Seeking
    this.progressBar.addEventListener('input', (e) => {
      const fraction = parseFloat(e.target.value) / 100;
      const targetTime = fraction * this.audio.duration;
      this.audio.seek(targetTime);
      this.mediaSession.updatePositionState();
    });

    // Volume Slider
    this.volumeSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.audio.setVolume(val);
      this.btnMute.textContent = val === 0 ? '🔇' : (val < 0.5 ? '🔉' : '🔊');
    });

    this.btnMute.addEventListener('click', () => {
      if (this.audio.audioElement.volume > 0) {
        this.previousVolume = this.audio.audioElement.volume;
        this.volumeSlider.value = 0;
        this.audio.setVolume(0);
        this.btnMute.textContent = '🔇';
      } else {
        const restore = this.previousVolume || 0.85;
        this.volumeSlider.value = restore;
        this.audio.setVolume(restore);
        this.btnMute.textContent = restore < 0.5 ? '🔉' : '🔊';
      }
    });

    // Audio Element Events
    this.audio.audioElement.addEventListener('play', () => {
      this.updatePlayPauseIcon();
      this.mediaSession.updatePlaybackState('playing');
    });

    this.audio.audioElement.addEventListener('pause', () => {
      this.updatePlayPauseIcon();
      this.mediaSession.updatePlaybackState('paused');
    });

    this.audio.audioElement.addEventListener('ended', () => {
      this.playlist.next();
    });

    this.audio.audioElement.addEventListener('timeupdate', () => {
      this.updateTimeDisplay();
    });

    // Quick Chips & Playlist Toolbar
    document.getElementById('chip-demo-track')?.addEventListener('click', () => {
      this.addDemoSynthTrack(true);
    });

    document.getElementById('chip-add-files')?.addEventListener('click', () => {
      this.inputFiles.click();
    });

    document.getElementById('btn-pick-files')?.addEventListener('click', () => {
      this.inputFiles.click();
    });

    document.getElementById('btn-pick-folder')?.addEventListener('click', () => {
      this.inputFolder.click();
    });

    document.getElementById('btn-add-synth')?.addEventListener('click', () => {
      this.addDemoSynthTrack(true);
    });

    document.getElementById('btn-clear-playlist')?.addEventListener('click', () => {
      if (confirm('Очистить весь плейлист?')) {
        this.playlist.clear();
        this.showToast('Плейлист очищен');
      }
    });

    // File Input Handlers
    this.inputFiles.addEventListener('change', async (e) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        const added = await this.playlist.addFiles(files);
        this.showToast(`Добавлено треков: ${added.length}`);
      }
      this.inputFiles.value = '';
    });

    this.inputFolder.addEventListener('change', async (e) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        const added = await this.playlist.addFiles(files);
        this.showToast(`Добавлено треков из папки: ${added.length}`);
      }
      this.inputFolder.value = '';
    });

    // Search Filter
    this.playlistSearch.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      this.renderPlaylist(this.playlist.tracks, this.playlist.currentIndex);
    });

    // Equalizer UI Events
    this.eqBypassToggle.addEventListener('change', (e) => {
      const isEnabled = this.audio.toggleBypass();
      this.showToast(isEnabled ? 'Эквалайзер включен' : 'Эквалайзер в обходе (Bypass)');
    });

    this.eqPresetsSelect.addEventListener('change', (e) => {
      this.applyPreset(e.target.value);
    });

    this.btnResetEq.addEventListener('click', () => {
      this.audio.resetEQ();
      this.syncEqSliders();
      this.showToast('Эквалайзер сброшен в Flat (0 dB)');
    });

    this.sliderPreamp.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.audio.setPreamp(val);
      this.valPreamp.textContent = (val > 0 ? '+' : '') + val.toFixed(1) + ' dB';
    });

    this.sliderBassBoost.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.audio.setBassBoost(val);
      this.valBassBoost.textContent = '+' + val.toFixed(1) + ' dB';
    });

    this.genrePresetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const presetKey = btn.getAttribute('data-preset');
        this.applyPreset(presetKey);
      });
    });

    // Visualizer Controls
    this.visModeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.visModeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.getAttribute('data-mode');
        this.miniVisualizer.setMode(mode);
        this.fullscreenVisualizer.setMode(mode);
      });
    });

    this.visSensitivity.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.miniVisualizer.setSensitivity(val);
      this.fullscreenVisualizer.setSensitivity(val);
    });

    // Sleep Timer
    document.getElementById('btn-timer-modal').addEventListener('click', () => {
      this.timerModal.classList.add('open');
    });

    document.getElementById('btn-close-timer-modal').addEventListener('click', () => {
      this.timerModal.classList.remove('open');
    });

    document.querySelectorAll('[data-timer-mins]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mins = parseInt(btn.getAttribute('data-timer-mins'), 10);
        this.setSleepTimer(mins);
      });
    });

    document.getElementById('btn-cancel-timer').addEventListener('click', () => {
      if (this.sleepTimerId) {
        clearTimeout(this.sleepTimerId);
        this.sleepTimerId = null;
        this.showToast('Таймер сна отключен');
      }
      this.timerModal.classList.remove('open');
    });

    // Theme Switchers
    document.querySelectorAll('[data-theme-name]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-theme-name]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const theme = btn.getAttribute('data-theme-name');
        this.setTheme(theme);
      });
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.audio.togglePlay();
      } else if (e.code === 'ArrowRight') {
        this.audio.seek(this.audio.currentTime + 5);
      } else if (e.code === 'ArrowLeft') {
        this.audio.seek(this.audio.currentTime - 5);
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        this.audio.setVolume(Math.min(1, this.audio.audioElement.volume + 0.05));
        this.volumeSlider.value = this.audio.audioElement.volume;
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        this.audio.setVolume(Math.max(0, this.audio.audioElement.volume - 0.05));
        this.volumeSlider.value = this.audio.audioElement.volume;
      }
    });
  }

  /**
   * Drag & Drop System for File Ingestion & Track Reordering
   */
  initDragAndDrop() {
    // 1. Window Drag & Drop for Audio Files
    const dropzone = this.playlistDropzone;

    ['dragenter', 'dragover'].forEach(name => {
      window.addEventListener(name, (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(name => {
      window.addEventListener(name, (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
      });
    });

    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = [];

      // Check for Directory / DataTransferItemList
      if (e.dataTransfer.items) {
        for (let i = 0; i < e.dataTransfer.items.length; i++) {
          const item = e.dataTransfer.items[i];
          if (item.kind === 'file') {
            const entry = item.webkitGetAsEntry?.();
            if (entry) {
              await this.traverseFileTree(entry, files);
            } else {
              const file = item.getAsFile();
              if (file) files.push(file);
            }
          }
        }
      } else if (e.dataTransfer.files) {
        files.push(...Array.from(e.dataTransfer.files));
      }

      if (files.length > 0) {
        const added = await this.playlist.addFiles(files);
        this.showToast(`Добавлено треков: ${added.length}`);
        this.switchTab('view-playlist');
      }
    });

    dropzone.addEventListener('click', () => {
      this.inputFiles.click();
    });
  }

  async traverseFileTree(item, fileList) {
    if (item.isFile) {
      return new Promise((resolve) => {
        item.file((file) => {
          fileList.push(file);
          resolve();
        });
      });
    } else if (item.isDirectory) {
      const dirReader = item.createReader();
      return new Promise((resolve) => {
        dirReader.readEntries(async (entries) => {
          for (const entry of entries) {
            await this.traverseFileTree(entry, fileList);
          }
          resolve();
        });
      });
    }
  }

  /**
   * Switch Active Tab View
   */
  switchTab(tabId) {
    this.tabViews.forEach(view => {
      view.classList.toggle('active', view.id === tabId);
    });

    this.navBtns.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });

    // Resize visualizer if switched to Visualizer tab
    if (tabId === 'view-visualizer') {
      setTimeout(() => this.fullscreenVisualizer.resize(), 50);
    }
  }

  /**
   * Add synthesized demo track
   */
  addDemoSynthTrack(autoPlay = false) {
    const demo = SynthDemoGenerator.generateSynthwaveTrack();
    this.playlist.addCustomTrack(demo.title, demo.artist, demo.src, demo.pictureUrl, demo.duration);
    this.showToast('Демо-трек синтезирован!');
    if (autoPlay) {
      this.playlist.selectTrack(this.playlist.tracks.length - 1, true);
    }
  }

  /**
   * When a track is selected to play
   */
  onTrackLoaded(track, autoPlay = true) {
    this.trackTitle.textContent = track.title || 'Без названия';
    this.trackArtist.textContent = track.artist || 'Неизвестный артист';
    this.trackFormat.textContent = track.genre || 'CYBER AUDIO';

    // Update Album Artwork
    if (track.pictureUrl) {
      this.albumArt.src = track.pictureUrl;
    } else {
      this.setFallbackArtwork(track.title, track.artist);
    }

    this.audio.loadSource(track.src);
    this.mediaSession.updateMetadata(track);

    if (autoPlay) {
      this.audio.play().then(() => {
        this.updatePlayPauseIcon();
      }).catch(err => {
        console.log('Autoplay policy caught, user interaction needed:', err);
      });
    }
  }

  setFallbackArtwork(title = 'NEON', artist = 'AUDIO') {
    this.albumArt.src = SynthDemoGenerator.generateNeonCoverSvg(title, artist);
  }

  updatePlayPauseIcon() {
    this.btnPlayPause.textContent = this.audio.isPaused ? '▶' : '⏸';
  }

  updateTimeDisplay() {
    const cur = this.audio.currentTime;
    const dur = this.audio.duration;

    this.timeCurrent.textContent = this.formatTime(cur);
    this.timeDuration.textContent = this.formatTime(dur);

    if (dur > 0 && !isNaN(dur)) {
      this.progressBar.value = (cur / dur) * 100;
    } else {
      this.progressBar.value = 0;
    }
  }

  formatTime(secs) {
    if (isNaN(secs) || !isFinite(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  /**
   * Render Playlist with Drag-and-Drop (HTML5 + Mobile Touch)
   */
  renderPlaylist(tracks, currentIdx) {
    this.trackListContainer.innerHTML = '';

    const filtered = tracks.filter(t => {
      if (!this.searchQuery) return true;
      return (t.title?.toLowerCase().includes(this.searchQuery) ||
              t.artist?.toLowerCase().includes(this.searchQuery));
    });

    if (filtered.length === 0) {
      this.emptyPlaylistMsg.style.display = 'block';
      this.trackListContainer.appendChild(this.emptyPlaylistMsg);
      return;
    } else {
      this.emptyPlaylistMsg.style.display = 'none';
    }

    filtered.forEach((track) => {
      const originalIndex = this.playlist.tracks.indexOf(track);
      const isCurrent = originalIndex === currentIdx;

      const item = document.createElement('div');
      item.className = `track-item ${isCurrent ? 'active' : ''}`;
      item.draggable = true;
      item.dataset.index = originalIndex;

      // Drag Handle
      const dragHandle = document.createElement('div');
      dragHandle.className = 'drag-handle';
      dragHandle.textContent = '⋮⋮';
      dragHandle.title = 'Перетащите для изменения порядка';

      // Thumbnail Art
      const art = document.createElement('img');
      art.className = 'track-item-art';
      art.src = track.pictureUrl || SynthDemoGenerator.generateNeonCoverSvg(track.title);

      // Details
      const details = document.createElement('div');
      details.className = 'track-item-details';
      details.innerHTML = `
        <div class="track-item-title">${this.escapeHtml(track.title)}</div>
        <div class="track-item-artist">${this.escapeHtml(track.artist)} • ${this.formatTime(track.duration)}</div>
      `;

      // Quick Actions
      const actions = document.createElement('div');
      actions.className = 'track-item-actions';

      // Move Up
      const btnUp = document.createElement('button');
      btnUp.className = 'track-btn-sub';
      btnUp.innerHTML = '▲';
      btnUp.title = 'Вверх';
      btnUp.addEventListener('click', (e) => {
        e.stopPropagation();
        this.playlist.moveTrack(originalIndex, originalIndex - 1);
      });

      // Move Down
      const btnDown = document.createElement('button');
      btnDown.className = 'track-btn-sub';
      btnDown.innerHTML = '▼';
      btnDown.title = 'Вниз';
      btnDown.addEventListener('click', (e) => {
        e.stopPropagation();
        this.playlist.moveTrack(originalIndex, originalIndex + 1);
      });

      // Remove
      const btnDel = document.createElement('button');
      btnDel.className = 'track-btn-sub';
      btnDel.innerHTML = '✕';
      btnDel.title = 'Удалить';
      btnDel.addEventListener('click', (e) => {
        e.stopPropagation();
        this.playlist.removeTrack(originalIndex);
      });

      actions.appendChild(btnUp);
      actions.appendChild(btnDown);
      actions.appendChild(btnDel);

      item.appendChild(dragHandle);
      item.appendChild(art);
      item.appendChild(details);
      item.appendChild(actions);

      // Track item click -> play
      item.addEventListener('click', () => {
        this.playlist.selectTrack(originalIndex, true);
      });

      // ==========================================
      // DESKTOP DRAG-AND-DROP REORDERING
      // ==========================================
      item.addEventListener('dragstart', (e) => {
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', originalIndex);
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        document.querySelectorAll('.track-item').forEach(el => {
          el.classList.remove('drag-over-top', 'drag-over-bottom');
        });
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          item.classList.add('drag-over-top');
          item.classList.remove('drag-over-bottom');
        } else {
          item.classList.add('drag-over-bottom');
          item.classList.remove('drag-over-top');
        }
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drag-over-top', 'drag-over-bottom');
        const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
        let toIdx = originalIndex;

        const rect = item.getBoundingClientRect();
        if (e.clientY > rect.top + rect.height / 2 && fromIdx < toIdx) {
          // Dropped in bottom half
        }
        if (!isNaN(fromIdx) && fromIdx !== toIdx) {
          this.playlist.moveTrack(fromIdx, toIdx);
        }
      });

      // ==========================================
      // MOBILE TOUCH DRAG-AND-DROP REORDERING
      // ==========================================
      this.setupTouchDrag(dragHandle, item, originalIndex);

      this.trackListContainer.appendChild(item);
    });
  }

  setupTouchDrag(handle, item, itemIndex) {
    let startY = 0;
    let targetIndex = itemIndex;

    handle.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
      item.classList.add('dragging');
      if (navigator.vibrate) navigator.vibrate(15);
    }, { passive: true });

    handle.addEventListener('touchmove', (e) => {
      const currentY = e.touches[0].clientY;
      const elements = document.elementsFromPoint(e.touches[0].clientX, currentY);
      const overTrack = elements.find(el => el.classList?.contains('track-item') && el !== item);

      document.querySelectorAll('.track-item').forEach(el => {
        el.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      if (overTrack) {
        const overIndex = parseInt(overTrack.dataset.index, 10);
        targetIndex = overIndex;
        const rect = overTrack.getBoundingClientRect();
        if (currentY < rect.top + rect.height / 2) {
          overTrack.classList.add('drag-over-top');
        } else {
          overTrack.classList.add('drag-over-bottom');
        }
      }
    }, { passive: true });

    handle.addEventListener('touchend', () => {
      item.classList.remove('dragging');
      document.querySelectorAll('.track-item').forEach(el => {
        el.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      if (targetIndex !== itemIndex) {
        this.playlist.moveTrack(itemIndex, targetIndex);
        if (navigator.vibrate) navigator.vibrate(25);
      }
    });
  }

  /**
   * Apply preset to Equalizer
   */
  applyPreset(presetKey) {
    const preset = this.audio.applyPreset(presetKey);
    if (!preset) return;

    this.eqPresetsSelect.value = presetKey;
    this.syncEqSliders();

    // Update chip active states
    this.genrePresetBtns.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-preset') === presetKey);
    });

    this.showToast(`Пресет эквалайзера: ${preset.name}`);
  }

  clearActivePresetChip() {
    this.genrePresetBtns.forEach(b => b.classList.remove('active'));
    this.eqPresetsSelect.value = 'flat';
  }

  syncEqSliders() {
    this.audio.currentGains.forEach((gain, idx) => {
      const slider = document.getElementById(`band-slider-${idx}`);
      const dbLabel = document.getElementById(`band-db-${idx}`);
      if (slider) slider.value = gain;
      if (dbLabel) dbLabel.textContent = (gain > 0 ? '+' : '') + gain.toFixed(1) + 'dB';
    });

    this.sliderBassBoost.value = this.audio.bassBoostAmount;
    this.valBassBoost.textContent = '+' + this.audio.bassBoostAmount.toFixed(1) + ' dB';
  }

  /**
   * Sleep Timer
   */
  setSleepTimer(mins) {
    if (this.sleepTimerId) clearTimeout(this.sleepTimerId);
    this.sleepTimerId = setTimeout(() => {
      this.audio.pause();
      this.showToast('⏳ Таймер сна сработал: Воспроизведение остановлено');
    }, mins * 60 * 1000);

    this.timerModal.classList.remove('open');
    this.showToast(`Таймер сна установлен на ${mins} минут`);
  }

  /**
   * Accent Theme Switcher
   */
  setTheme(themeName) {
    document.documentElement.setAttribute('data-theme', themeName);

    let p = '#00f2ff', s = '#ff007f', a = '#a855f7';
    if (themeName === 'synthwave') {
      p = '#ff7700'; s = '#d946ef'; a = '#8b5cf6';
    } else if (themeName === 'matrix') {
      p = '#00ff66'; s = '#10b981'; a = '#06b6d4';
    } else if (themeName === 'laser-blue') {
      p = '#00a2ff'; s = '#7000ff'; a = '#00f2ff';
    }

    this.miniVisualizer.setThemeColors(p, s, a);
    this.fullscreenVisualizer.setThemeColors(p, s, a);
    this.showToast(`Тема изменена: ${themeName}`);
  }

  /**
   * PWA Service Worker & Install prompt
   */
  initPWA() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => {
          // SW registration failed (normal on file:// protocol)
          console.log('SW registration note:', err.message);
        });
      });
    }

    const btnInstall = document.getElementById('btn-install-pwa');
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      btnInstall.style.display = 'flex';
    });

    btnInstall?.addEventListener('click', async () => {
      if (this.deferredPrompt) {
        this.deferredPrompt.prompt();
        const { outcome } = await this.deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          btnInstall.style.display = 'none';
        }
        this.deferredPrompt = null;
      }
    });
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    this.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 2600);
  }

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

// Instantiate on DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  new NeonApp();
});


