import { Component, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { SongService } from '../../../services/song';

// The playlists' selector of the songbook: a round button (filled, with the
// number of its songs, while a list is chosen) that opens a panel with
// every list of mine, a new list's name, and what is rarely done with the
// chosen one. The songbook's list has it in three places - its first row,
// the search's row on a phone, and among the annexes' icons beside an open
// song - and tells each whether the panel is open; what a tap means is the
// songbook's to say (daloskonyv.ts).
@Component({
  selector: 'app-playlist-picker',
  imports: [MatIconModule],
  templateUrl: './playlist-picker.html',
  styleUrl: './playlist-picker.scss',
  host: { '[class]': '"playlist-picker--" + place()' },
})
export class PlaylistPicker {
  private songService = inject(SongService);

  // Where it stands: 'row' (the first row), 'phone' (the search's row on a
  // phone: the panel is the dark one from the row's one end to the other)
  // or 'annex' (as big as the annexes' icons).
  place = input<'row' | 'phone' | 'annex'>('row');
  open = input(false);

  toggled = output<void>();
  // A list's id - '' for the whole book.
  chosen = output<string>();
  // A new list's name.
  created = output<string>();
  renameAsked = output<void>();
  deleteAsked = output<void>();

  lists = this.songService.lists;
  // The list the songbook is on - null for the whole book.
  playlist = this.songService.list;
  newListName = signal('');

  create() {
    const name = this.newListName().trim();
    if (!name) return;
    this.created.emit(name);
    this.newListName.set('');
  }
}
