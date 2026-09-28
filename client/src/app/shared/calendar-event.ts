// "Mentés a naptárba" - a multi-day event (e.g. a tour) as a Google Calendar
// link or a downloadable .ics file (Apple Calendar, Outlook, and the iPhone
// opens it straight in Calendar). All-day across its days, the usual way a
// trip shows in a calendar; the exact start time goes into the description.

export interface CalendarEvent {
  title: string;
  start: Date; // the first day (its time is mentioned in the description)
  days: number; // how many calendar days it spans
  description: string;
  location?: string;
  url?: string;
}

// "YYYYMMDD" of a date as a day in Budapest.
function budapestDay(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Budapest' })
    .format(date)
    .replace(/-/g, '');
}

// The day after the last one - calendars take an all-day event's end as
// exclusive (a 3-day tour starting the 10th ends "on the 13th").
function endDay(event: CalendarEvent): string {
  const day = budapestDay(event.start);
  const [y, m, d] = [day.slice(0, 4), day.slice(4, 6), day.slice(6, 8)].map(Number);
  const end = new Date(Date.UTC(y, m - 1, d + event.days));
  return end.toISOString().slice(0, 10).replace(/-/g, '');
}

export function googleCalendarUrl(event: CalendarEvent): string {
  const details = event.url ? `${event.description}\n\n${event.url}` : event.description;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${budapestDay(event.start)}/${endDay(event)}`,
    details,
    ctz: 'Europe/Budapest',
  });
  if (event.location) params.set('location', event.location);
  return `https://calendar.google.com/calendar/render?${params}`;
}

// iCalendar text: commas, semicolons, backslashes and line breaks escaped.
const icsText = (s: string) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/([,;])/g, '\\$1')
    .replace(/\r?\n/g, '\\n');

// Lines longer than 75 characters folded, as the format asks.
const fold = (line: string) => line.match(/.{1,74}/g)?.join('\r\n ') ?? line;

export function icsContent(event: CalendarEvent): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const description = event.url ? `${event.description}\n\n${event.url}` : event.description;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bodorgo//HU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${budapestDay(event.start)}-${encodeURIComponent(event.title)}@bodorgo.hu`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${budapestDay(event.start)}`,
    `DTEND;VALUE=DATE:${endDay(event)}`,
    `SUMMARY:${icsText(event.title)}`,
    `DESCRIPTION:${icsText(description)}`,
    ...(event.location ? [`LOCATION:${icsText(event.location)}`] : []),
    ...(event.url ? [`URL:${event.url}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function downloadIcs(event: CalendarEvent, filename: string) {
  const blob = new Blob([icsContent(event)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
