// A text cut into plain pieces and the http(s) links in it, for showing a
// link as a short "katt ide" that opens in a new tab instead of its long
// address - rendered piece by piece in the template (no innerHTML, so the
// text can never inject anything). What ends a sentence after a link (a
// full stop, a bracket...) stays text, not part of the link.
export interface LinkPart {
  text: string;
  // Set on a link: where it goes.
  href?: string;
}

const LINK = /(https?:\/\/[^\s<>"]+)/;
const TRAILING = /[.,;:!?)\]}'"]+$/;

export function linkParts(text: string): LinkPart[] {
  const parts: LinkPart[] = [];
  for (const piece of text.split(LINK)) {
    if (!piece) continue;
    if (!LINK.test(piece)) {
      parts.push({ text: piece });
      continue;
    }
    const tail = piece.match(TRAILING)?.[0] ?? '';
    const href = piece.slice(0, piece.length - tail.length);
    parts.push({ text: href, href });
    if (tail) parts.push({ text: tail });
  }
  return parts;
}
