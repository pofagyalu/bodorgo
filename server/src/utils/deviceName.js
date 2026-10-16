// A browser's User-Agent as people say it: "Chrome · Android",
// "Safari · iPhone", "Firefox · Windows". Rough on purpose - only to tell
// one's own devices apart in a list; null when there is nothing to go by.
// Brave (and others built on Chromium) send exactly Chrome's User-Agent;
// only their brand list (the Sec-CH-UA header, when given) says who they are.

const BROWSERS = [
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Edg(A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'Mac'],
  [/CrOS/, 'ChromeOS'],
  [/Ubuntu/, 'Ubuntu'],
  [/Linux/, 'Linux'],
];

// The Sec-CH-UA brands that name a browser of their own (not "Chromium",
// not the made-up "Not A;Brand" entry).
const BRANDS = [
  [/"Brave"/, 'Brave'],
  [/"Microsoft Edge"/, 'Edge'],
  [/"Opera"/, 'Opera'],
  [/"Vivaldi"/, 'Vivaldi'],
  [/"Google Chrome"/, 'Chrome'],
];

const first = (list, text) => list.find(([re]) => re.test(text))?.[1] ?? null;

export function deviceName(userAgent, brands) {
  const ua = String(userAgent ?? '');
  const browser = first(BRANDS, String(brands ?? '')) ?? first(BROWSERS, ua);
  const parts = [browser, first(SYSTEMS, ua)].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
