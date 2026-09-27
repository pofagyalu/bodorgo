import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

// The club's legal details (the impresszum) and a link to the privacy
// notice - at the bottom of the landing page, the logged-in home page and
// the privacy notice itself.
@Component({
  selector: 'app-site-footer',
  imports: [RouterLink],
  templateUrl: './site-footer.html',
  styleUrl: './site-footer.scss',
})
export class SiteFooter {}
