import sanitizeHtml from 'sanitize-html';

// The admin's letter to a tour's attendees is written in a small rich-text
// editor on the tour page (Quill) - only the formatting its toolbar offers
// survives here: bold/italic/underline/strike, text and highlight colors,
// lists, links. Anything else (scripts, images, other styles) is dropped
// before the letter is saved or sent.
const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/i];

export function cleanMailHtml(html) {
  const cleaned = sanitizeHtml(String(html ?? ''), {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'span', 'ul', 'ol', 'li', 'a'],
    allowedAttributes: { span: ['style'], p: ['style'], a: ['href', 'target', 'rel'] },
    allowedStyles: {
      '*': {
        color: COLOR,
        'background-color': COLOR,
        'text-align': [/^(left|right|center|justify)$/],
      },
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
    },
  });
  // Quill's HTML export turns every space into &nbsp;, which would stop
  // e-mail clients from wrapping lines - back to plain spaces.
  // (sanitize-html may hand them back as the character itself, not the
  // entity - both are replaced.)
  return cleaned.replace(/&nbsp;|\u00a0/g, ' ').trim();
}

// Nothing but empty paragraphs/whitespace left?
export function isBlankMailHtml(html) {
  return !sanitizeHtml(html ?? '', { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;|\s/g, '')
    .trim();
}

// The plain-text part of the e-mail, for clients that don't show HTML.
export function mailHtmlToText(html) {
  const withBreaks = String(html ?? '')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|ul|ol)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n');
  return sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
