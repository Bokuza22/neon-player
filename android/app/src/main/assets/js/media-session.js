/**
 * Neon Audio Player - MediaSession API Integration
 * Connects player with phone lockscreen, notification controls, and Bluetooth headsets
 */
export class MediaSessionController {
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
