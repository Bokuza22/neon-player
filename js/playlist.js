/**
 * Neon Audio Player - Playlist Manager
 * Handles track management, drag-and-drop file ingestion, and drag-and-drop playlist reordering (desktop + touch)
 */
import { ID3Reader } from './id3-reader.js';

export class PlaylistManager {
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
