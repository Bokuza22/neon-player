/**
 * Neon Audio Player - Main Application Orchestrator
 */
import { AudioEngine } from './audio-engine.js';
import { SpectrumVisualizer } from './visualizer.js';
import { PlaylistManager } from './playlist.js';
import { SynthDemoGenerator } from './synth-demo.js';
import { MediaSessionController } from './media-session.js';

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
