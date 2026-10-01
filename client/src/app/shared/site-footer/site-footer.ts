import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { CLIENT_VERSION } from '../../services/version';

// The club's legal details (the impresszum) and a link to the privacy
// notice - at the bottom of the landing page, the logged-in home page and
// the privacy notice itself. Logged in, it ends with the client's version.
@Component({
  selector: 'app-site-footer',
  imports: [RouterLink],
  templateUrl: './site-footer.html',
  styleUrl: './site-footer.scss',
})
export class SiteFooter {
  auth = inject(AuthService);
  readonly version = CLIENT_VERSION;
}
