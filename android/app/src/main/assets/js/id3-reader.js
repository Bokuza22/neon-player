/**
 * Neon Audio Player - ID3 Tag & Metadata Reader
 * Pure client-side parsing of audio metadata and embedded album art
 */
export class ID3Reader {
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
