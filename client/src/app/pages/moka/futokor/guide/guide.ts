import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Masonry } from '../../../../shared/masonry/masonry.directive';

// Móka → Futókörök → Útmutató: how to run a lap, in plain words - with the
// app on one's own phone, or with a futókód on any phone; what the colors
// of the answers mean; the rules that matter.
@Component({
  selector: 'app-futokor-guide',
  imports: [RouterLink, MatIconModule, Masonry],
  templateUrl: './guide.html',
  styleUrl: './guide.scss',
})
export class FutokorGuide {}
