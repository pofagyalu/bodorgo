// NFC in the browser (Web NFC: Chrome on Android has it; an iPhone doesn't
// - there a touch on a card's sticker opens its link, like the camera does
// with its QR code). A card's NFC sticker says the same as its QR code:
// the card's link - and, after it, what the card is called, for whoever
// reads the sticker with something else.

interface NdefRecord {
  recordType: string;
  data?: DataView;
  lang?: string;
}
interface NdefReader {
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  write(
    message: { records: { recordType: string; data: string; lang?: string }[] },
    options?: { signal?: AbortSignal; overwrite?: boolean },
  ): Promise<void>;
  onreading: ((event: { message: { records: NdefRecord[] } }) => void) | null;
}
const NdefReaderClass = (window as unknown as { NDEFReader?: new () => NdefReader }).NDEFReader;

export const canNfc = () => !!NdefReaderClass;

// A card's link ends in its token: .../fk/<token> (the first ones:
// .../versenyek/t/<token>).
const CARD_LINK = /\/(?:fk|versenyek\/t)\/([^/?#]+)/;

// The card's token from its link (as a QR code or a sticker says it) -
// null if that isn't a card's link.
export function tokenOfLink(link: string): string | null {
  const token = CARD_LINK.exec(link)?.[1];
  return token ? decodeURIComponent(token) : null;
}

// Has this site been allowed to use NFC already? (Then it can listen
// without asking.)
export async function nfcAllowed(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: 'nfc' as PermissionName });
    return status.state === 'granted';
  } catch {
    return false;
  }
}

// Listens for cards touched to the phone, until `signal` says stop: each
// card's token is handed over. While the page listens, a touch doesn't open
// the link in a new tab. Throws if NFC is off or wasn't allowed.
export async function readCards(onCard: (token: string) => void, signal: AbortSignal) {
  const reader = new NdefReaderClass!();
  reader.onreading = ({ message }) => {
    for (const record of message.records) {
      if (!['url', 'absolute-url'].includes(record.recordType) || !record.data) continue;
      const token = tokenOfLink(new TextDecoder().decode(record.data));
      if (token) {
        onCard(token);
        return;
      }
    }
  };
  await reader.scan({ signal });
}

// Writes a card onto the sticker touched next: its link first (that's what
// a phone opens), then its name. Whatever was on the sticker goes.
export async function writeCard(url: string, name: string, signal: AbortSignal) {
  await new NdefReaderClass!().write(
    {
      records: [
        { recordType: 'url', data: url },
        { recordType: 'text', lang: 'hu', data: name },
      ],
    },
    { signal, overwrite: true },
  );
}
