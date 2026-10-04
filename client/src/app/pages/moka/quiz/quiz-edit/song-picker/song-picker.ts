import { Component, HostListener, computed, inject, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { catchError, forkJoin, of } from 'rxjs';
import { MusicTrack, PLAYLIST_NAMES, PlaylistKey } from '../../../../../services/music-player';
import { QuizService, QuizSong } from '../../../../../services/quiz';

// A song picked for a question - and three others of the same playlist,
// to offer as the wrong answers.
export interface PickedSong {
  song: QuizSong;
  label: string;
  others: string[];
}

// How a song is written as an answer.
export const songLabel = (track: { title: string; artist: string }) =>
  `${track.artist} – ${track.title}`;

const DECOYS = 3;

// Móka → Kvíz → the editor: a song for a question, from the playlists I
// may hear - first which playlist, then the song (searched by what's
// typed). Laid over the editor; it only says what was picked.
@Component({
  selector: 'app-quiz-song-picker',
  imports: [MatIconModule],
  templateUrl: './song-picker.html',
  styleUrl: './song-picker.scss',
})
export class QuizSongPicker {
  private quiz = inject(QuizService);

  picked = output<PickedSong>();
  closed = output<void>();

  // The playlists that could be loaded (a guest has only the first) -
  // null: still loading.
  lists = signal<{ key: PlaylistKey; name: string; tracks: MusicTrack[] }[] | null>(null);
  current = signal<PlaylistKey | null>(null);
  search = signal('');

  tracks = computed(() => {
    const list = this.lists()?.find((l) => l.key === this.current());
    const q = this.search().trim().toLocaleLowerCase('hu');
    const all = list?.tracks ?? [];
    return q ? all.filter((t) => songLabel(t).toLocaleLowerCase('hu').includes(q)) : all;
  });

  constructor() {
    const keys = Object.keys(PLAYLIST_NAMES) as PlaylistKey[];
    forkJoin(
      keys.map((key) => this.quiz.getTracks(key).pipe(catchError(() => of(null)))),
    ).subscribe((answers) => {
      const lists = keys
        .map((key, i) => ({ key, name: PLAYLIST_NAMES[key], tracks: answers[i] ?? [] }))
        .filter((l) => l.tracks.length);
      this.lists.set(lists);
      this.current.set(lists[0]?.key ?? null);
    });
  }

  show(key: PlaylistKey) {
    this.current.set(key);
    this.search.set('');
  }

  label = songLabel;

  // The song, and three others of its playlist picked at random - none
  // written the same as it, or as each other.
  pick(track: MusicTrack) {
    const playlist = this.current()!;
    const label = songLabel(track);
    const pool = [
      ...new Set((this.lists()?.find((l) => l.key === playlist)?.tracks ?? []).map(songLabel)),
    ].filter((l) => l !== label);
    const others: string[] = [];
    while (others.length < DECOYS && pool.length) {
      others.push(...pool.splice(Math.floor(Math.random() * pool.length), 1));
    }
    this.picked.emit({
      song: { playlist, id: track.id, title: track.title, artist: track.artist },
      label,
      others,
    });
  }

  @HostListener('document:keydown.escape')
  close() {
    this.closed.emit();
  }
}
