import { Injectable } from '@angular/core';
import type { Song, SongPlaylist } from './song';

// A song as it is kept on the device: whole, with its words line by line
// for the search.
export interface KeptSong extends Song {
  lines: string[];
}

// The songbook as it is kept on the device, for when there is no
// connection: every song, and the playlists of the one it was kept for.
export interface KeptBook {
  // Whose copy it is (the user's id): another user's is never shown.
  userId: string;
  // The state of the songs it holds, as the server names it - sent back,
  // the server leaves the songs out while they are still the same.
  version: string;
  savedAt: string;
  songs: KeptSong[];
  lists: SongPlaylist[];
  canEdit: boolean;
  lastChanged: string | null;
}

// A song added while the server couldn't be reached: kept on the device
// until it can be sent (services/song.ts).
export interface WaitingSong {
  // Its id and address until the server gives it its own ("local-…").
  localId: string;
  // Who added it: sent only while they are the one logged in.
  userId: string;
  // What the editor would have sent (SongInput).
  input: {
    title: string;
    subtitle?: string;
    artist: string;
    chordpro: string;
    originalKey?: string;
    key?: string;
    tempo?: number | null;
  };
  savedAt: string;
  // Why the server refused it, once it has - it waits to be corrected.
  error?: string;
}

const DB = 'bodorgo-offline';
const STORE = 'kept';
const BOOK = 'songbook';
const WAITING = 'waiting-songs';

// Where the songbook is kept on the device: the browser's IndexedDB - one
// record, the whole book (a few hundred kB of text). Every call is safe to
// make where there is no IndexedDB, or it refuses (private mode): nothing
// is kept then, and nothing is read.
@Injectable({ providedIn: 'root' })
export class SongStore {
  readonly available = typeof indexedDB !== 'undefined';

  async read(): Promise<KeptBook | null> {
    try {
      return ((await this.run('readonly', (store) => store.get(BOOK))) as KeptBook) ?? null;
    } catch {
      return null;
    }
  }

  async write(book: KeptBook): Promise<boolean> {
    try {
      await this.run('readwrite', (store) => store.put(book, BOOK));
      return true;
    } catch {
      return false;
    }
  }

  async clear(): Promise<void> {
    try {
      await this.run('readwrite', (store) => store.delete(BOOK));
    } catch {
      // Nothing was kept, or it can't be reached: nothing to do.
    }
  }

  // The songs waiting to be sent - everyone's who added one on this device.
  // They stay through a logout: nobody's work is lost with it.
  async readWaiting(): Promise<WaitingSong[]> {
    try {
      return ((await this.run('readonly', (store) => store.get(WAITING))) as WaitingSong[]) ?? [];
    } catch {
      return [];
    }
  }

  async writeWaiting(songs: WaitingSong[]): Promise<boolean> {
    try {
      await this.run('readwrite', (store) => store.put(songs, WAITING));
      return true;
    } catch {
      return false;
    }
  }

  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('blocked'));
    });
    // A failed opening is tried again the next time.
    this.db.catch(() => (this.db = null));
    return this.db;
  }

  private async run(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest,
  ): Promise<unknown> {
    if (!this.available) throw new Error('no IndexedDB');
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
}
