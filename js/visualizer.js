/**
 * Neon Audio Player - Reactive Canvas Spectrum Visualizer
 * Multi-mode 60fps neon visualizer: Bars with Peak Caps, Radial Pulse, Laser Waveform, and Starburst
 */
export class SpectrumVisualizer {
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
