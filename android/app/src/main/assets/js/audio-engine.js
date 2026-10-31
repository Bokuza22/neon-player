/**
 * Neon Audio Player - Web Audio API Engine
 * Handles audio playback, 10-band equalizer, bass boost, preamp, and spectrum analysis
 */
export class AudioEngine {
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
