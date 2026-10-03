import { Component, ElementRef, OnDestroy, OnInit, output, signal, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { tokenOfLink } from '../nfc/nfc';

// The browser's own QR reader (Chrome on Android has it; an iPhone doesn't
// - there the phone's camera app opens the card's link instead).
interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type DetectorClass = new (options: { formats: string[] }) => Detector;
const BarcodeDetectorClass = (window as unknown as { BarcodeDetector?: DetectorClass })
  .BarcodeDetector;

export const canScanInApp = () => !!BarcodeDetectorClass && !!navigator.mediaDevices?.getUserMedia;

const LOOK_EVERY_MS = 200;
// The same card isn't read again while it's still in front of the camera.
const SAME_CARD_MS = 3000;

// The camera, kept on, reading the cards' QR codes right in the app: no
// new tab for every card, and nothing to load - so it also works where
// there's no signal. Each card read is handed over (`card`: its token).
@Component({
  selector: 'app-qr-scanner',
  imports: [MatIconModule],
  templateUrl: './qr-scanner.html',
  styleUrl: './qr-scanner.scss',
})
export class QrScanner implements OnInit, OnDestroy {
  card = output<string>();
  closed = output<void>();

  error = signal('');
  private video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private stream?: MediaStream;
  private timer?: ReturnType<typeof setInterval>;
  private last = { token: '', at: 0 };

  async ngOnInit() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
    } catch {
      this.error.set('A kamerát nem sikerült elindítani – engedélyezd a böngészőben.');
      return;
    }
    const video = this.video().nativeElement;
    video.srcObject = this.stream;
    await video.play().catch(() => {});

    const detector = new BarcodeDetectorClass!({ formats: ['qr_code'] });
    let busy = false;
    this.timer = setInterval(async () => {
      if (busy || video.readyState < 2) return;
      busy = true;
      try {
        for (const code of await detector.detect(video)) this.found(code.rawValue);
      } catch {
        // A frame it couldn't read: the next one comes in a moment.
      }
      busy = false;
    }, LOOK_EVERY_MS);
  }

  private found(text: string) {
    const token = tokenOfLink(text);
    if (!token) return;
    const now = Date.now();
    if (token === this.last.token && now - this.last.at < SAME_CARD_MS) {
      this.last.at = now; // still in front of the camera
      return;
    }
    this.last = { token, at: now };
    this.card.emit(token);
  }

  ngOnDestroy() {
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((track) => track.stop());
  }
}
