import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../auth/auth.service';
import { SongService } from '../../services/song';

// Outer shell for every klub/* subpage - a persistent dark sidebar (desktop)
// / horizontal bar (mobile) for switching between them, with the actual
// content rendered by the matching child route below.
//
// Unlike the guard on this route, which used to sit on the whole /klub
// parent, only Áttekintés/Pénzügyek/Felhasználók/Dokumentumok actually
// require a real member - Profilom is open to every logged-in user
// (guest included), so it's the only nav item a guest ever sees here.
@Component({
  selector: 'app-klub',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, MatIconModule],
  templateUrl: './klub.html',
  styleUrl: './klub.scss',
})
export class Klub {
  private auth = inject(AuthService);

  isMember = computed(() => {
    const role = this.auth.user()?.role;
    return role === 'admin' || role === 'member';
  });

  // Where the Daloskönyv item leads.
  songbook = inject(SongService).base;

  // Beállítások is admin-only.
  isAdmin = computed(() => this.auth.user()?.role === 'admin');
}
