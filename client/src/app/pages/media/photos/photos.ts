import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

// Média → Fotók: event photos that don't belong to a tour - not built yet.
@Component({
  selector: 'app-media-photos',
  imports: [MatIconModule],
  template: `
    <div class="content">
      <div class="kicker">Média</div>
      <h1>Fotók</h1>
      <div class="soon-card">
        <mat-icon>photo_library</mat-icon>
        <strong>Hamarosan</strong>
        <p>Ide kerülnek majd a közös programok fotói, amelyek nem egy táborhoz tartoznak.</p>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      font-family:
        Inter,
        ui-sans-serif,
        system-ui,
        -apple-system,
        'Segoe UI',
        sans-serif;
      color: #23354a;
    }
    .content {
      max-width: 1390px;
      margin: auto;
      padding: 38px clamp(22px, 4vw, 58px) 70px;
    }
    .kicker {
      color: #4c9184;
      font-size: 11px;
      letter-spacing: 0.13em;
      text-transform: uppercase;
      font-weight: 800;
    }
    h1 {
      font-size: clamp(29px, 3vw, 38px);
      line-height: 1.1;
      letter-spacing: -0.045em;
      margin: 6px 0 22px;
      color: #193346;
    }
    .soon-card {
      display: grid;
      justify-items: center;
      gap: 6px;
      text-align: center;
      padding: 48px 24px;
      background: #fff;
      border: 1px dashed #cfdcd6;
      border-radius: 17px;
      color: #4a5b63;
    }
    .soon-card mat-icon {
      font-size: 40px;
      width: 40px;
      height: 40px;
      color: #f07827;
    }
    .soon-card strong {
      font-size: 17px;
      color: #203747;
    }
    .soon-card p {
      margin: 0;
      font-size: 14px;
    }
  `,
})
export class Photos {}
