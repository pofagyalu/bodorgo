import TourReport from '../models/tourReportModel.js';
import AppError from '../utils/appError.js';
import { tourDay } from '../utils/huDate.js';
import { trackSummary } from '../utils/documentTracks.js';
import { weatherOutlookRules } from '../utils/weatherOutlook.js';
import { COUNTRIES, countryOf } from '../utils/countries.js';
import {
  CONDITION_WORDS,
  ensureRecordedRain,
  rainText,
  recordedDay,
} from '../utils/reportWeather.js';
import { ensureAliases, hideNames, showNames } from '../utils/reportAliases.js';
import {
  MAX_DAYS,
  deltaLines,
  effectiveFacts,
  findTour,
  reportTourData,
} from './tourReportController.js';

// A tour's beszámoló as data for an AI model: what happened, with whom,
// when and where. Two kinds of things in it, for two ways of asking:
// - `chunks`: the text, one per top-level bullet (with its sub-bullets)
//   and one per walked hike, each with a `header` saying which tour and
//   day it is from - header and body together are what gets embedded and
//   searched ("mikor esett le valaki a bicikliről?");
// - the rest (dates, place, headcount, weather, hikes): plain numbers, not
//   for embedding - code answers those exactly ("melyik volt a leghosszabb
//   túra?").
// Nobody's name or user id is in it: a word linked to an attendee reads as
// their alias ("P7", utils/reportAliases.js). A name typed but not linked
// stays as typed. Only what happened - weather only once it's the recorded
// one, hikes only the walked ones.
// `promptNotes`: what the model has to be told to read all this right -
// lines for its system prompt.

const MAX_SWAP_CHARS = 20000;

// The country a tour was in, by its name: the tour's own field - or, for a
// beszámoló frozen before tours had one, read off the end of its address
// ("…, Szlovákia", "…, SK").
const tourCountry = (tour) => COUNTRIES[countryOf(tour.location)];

// What a model has to be told about this data before it reads it. The
// Jóléti-index's bands and shares come from the formula itself
// (weatherOutlookRules), so they can't say something else than the app.
function promptNotes() {
  const { tiers, settings } = weatherOutlookRules();
  const bands = tiers
    .map((t, i) => `${t.from}–${i < tiers.length - 1 ? t.to - 1 : t.to} ${t.word}`)
    .join(', ');
  const share = (n) => Math.round(n * 100);
  return [
    'Csak az szerepel az adatokban, ami megtörtént - terv és előrejelzés nem.',
    'A személyek álnéven szerepelnek (pl. P7): ugyanaz a szám minden túrán ugyanazt az embert jelenti. A válaszban hagyd meg az álnevet, ne találj ki hozzá nevet.',
    'Az időjárás (a chunkok fejlécében és a days mezőben) a nap utólag rögzített, tényleges időjárása az Open-Meteo archívumából, nem előrejelzés. Az időjárás fajtája (napos, részben felhős…) az egész napot jellemzi: egy sokat napsütéses nap kisebb záporokkal is lehet „részben felhős” - a lehullott csapadék (mm, és hány órán át) ezért külön szerepel.',
    `A Jóléti-index a klub tréfás, 0-100-as mutatója arról, mennyire volt kellemes az idő: a nap rögzített időjárásából számolt érték (${share(settings.weights.condition)}% az időjárás fajtája, ${share(settings.weights.temperature)}% a nappali hőmérséklet az évszakhoz képest) - nem mérés és nem előrejelzés. Sávjai: ${bands}.`,
    'Ha a leírás (a chunk body-ja) ellentmond az időjárási adatnak, a leírás az irányadó: azt azok írták, akik ott voltak.',
    'Egy esemény (kind: event) hikeRef-je annak a túrának a chunkjára (kind: hike) mutat, amelyiken történt - a táv, az idő és a szintemelkedés ott található.',
  ];
}

// A line's text, its linked words as aliases - who they are, and which
// hikes pieces of it are linked to.
function lineText(line, aliases, people, hikes) {
  return line.runs
    .map((run) => {
      if (run.hike) hikes.add(String(run.hike));
      const alias = run.person && aliases.get(String(run.person));
      if (!alias) return run.text;
      people.add(alias);
      return alias;
    })
    .join('')
    .trim();
}

// A day's text as entries: a top-level bullet (or a plain paragraph) and
// the indented bullets under it - { body, people, hikes (their ids) }.
function dayEntries(delta, aliases) {
  const entries = [];
  for (const line of deltaLines(delta)) {
    const people = new Set();
    const hikes = new Set();
    const text = lineText(line, aliases, people, hikes);
    if (!text) continue;
    const sub = line.list && line.indent > 0 && entries.length;
    if (sub) {
      const entry = entries.at(-1);
      entry.parts.push(text);
      people.forEach((p) => entry.people.add(p));
      hikes.forEach((h) => entry.hikes.add(h));
    } else {
      entries.push({ parts: [text], people, hikes });
    }
  }
  return entries.map((e) => ({
    body: e.parts.join(' – '),
    people: [...e.people],
    hikes: [...e.hikes],
  }));
}

const linkedIds = (days) =>
  days.flatMap((delta) =>
    (delta?.ops ?? []).map((op) => op.attributes?.person).filter((id) => typeof id === 'string'),
  );

// GET /tours/:id/report/json (admin) - the finished beszámoló as data.
// ?draft=1: the working copy as it is now.
export const getReportJson = async (req, res) => {
  const live = await findTour(req.params.id);
  const report = await TourReport.findOne({ tour: live._id });
  const draft = req.query.draft === '1';
  if (!draft && !report?.published?.at) {
    throw new AppError('Ehhez a táborhoz még nincs kész beszámoló.', 404);
  }
  const source = draft ? report : report.published;
  // The finished one says the tour as it was at Kész; the working copy as
  // it is now.
  if (draft) await ensureRecordedRain(live);
  const {
    tour,
    auto,
    attendees,
    hikes: walked,
  } = await reportTourData(live, draft ? null : report.published.frozen);
  const dayCount = Math.min(MAX_DAYS, Math.max(tour.duration ?? 1, source?.days?.length ?? 0));
  const texts = Array.from({ length: dayCount }, (_, i) => source?.days?.[i] ?? null);

  const aliases = await ensureAliases([...attendees.map((a) => a.id), ...linkedIds(texts)]);
  const facts = effectiveFacts(source?.facts, auto);
  const [lng, lat] = tour.location?.coordinates ?? [];
  const tourId = String(tour._id);
  const country = tourCountry(tour);
  const title = `${tour.title} (${[tour.order && `${tour.order}. túra`, country].filter(Boolean).join(', ')})`;

  // The walked hikes, each on its day (null: the file doesn't say when, or
  // it was outside the tour's days) and with its chunk's id - which a note
  // linked to the hike points at (hikeRef).
  const perDay = new Map();
  const tracks = walked.map((hike) => {
    const day = hike.day !== null && hike.day >= 0 && hike.day < dayCount ? hike.day + 1 : null;
    const n = (perDay.get(day) ?? 0) + 1;
    perDay.set(day, n);
    return {
      ...hike,
      day,
      date: day ? tourDay(tour.startDate, day - 1).ymd : null,
      chunkId: day ? `${tourId}:${day}:hike:${n}` : `${tourId}:hike:${n}`,
    };
  });
  const hikeChunk = new Map(tracks.map((hike) => [hike.id, hike.chunkId]));
  const hikeChunkOf = (hike) => ({
    id: hike.chunkId,
    header: hike.day ? `${title}, ${hike.day}. nap, ${hike.date}:` : `${title}:`,
    body: `túra – ${hike.name}, ${trackSummary(hike.track)}`,
    metadata: { kind: 'hike', tourId, day: hike.day, date: hike.date, people: [], hikeRef: null },
  });

  const days = [];
  const chunks = [];
  texts.forEach((delta, i) => {
    const { ymd, weekday } = tourDay(tour.startDate, i);
    // The recorded weather only - a forecast is not what happened.
    const { weather, wellbeing } = recordedDay(tour, i);
    days.push({ day: i + 1, date: ymd, weekday, weather, wellbeing });

    const header = [
      title,
      `${i + 1}. nap`,
      `${ymd} ${weekday}`,
      CONDITION_WORDS[weather?.condition],
      weather?.tempDayC != null ? `${Math.round(weather.tempDayC)}°C` : null,
      rainText(weather),
      wellbeing && `Jóléti-index ${wellbeing.index} (${wellbeing.word})`,
    ]
      .filter(Boolean)
      .join(', ');
    dayEntries(delta, aliases).forEach((entry, n) => {
      chunks.push({
        id: `${tourId}:${i + 1}:${n + 1}`,
        header: `${header}:`,
        body: entry.body,
        metadata: {
          kind: 'event',
          tourId,
          day: i + 1,
          date: ymd,
          people: entry.people,
          // The hike it happened on, if a piece of it is linked to one.
          hikeRef: entry.hikes.map((id) => hikeChunk.get(id)).find(Boolean) ?? null,
        },
      });
    });
    // The day's hikes, each a chunk of its own - so a search for the
    // waterfall finds its numbers too, not just the note about it.
    tracks.filter((hike) => hike.day === i + 1).forEach((hike) => chunks.push(hikeChunkOf(hike)));
  });
  // The hikes no day has, after the days.
  tracks.filter((hike) => hike.day === null).forEach((hike) => chunks.push(hikeChunkOf(hike)));

  const hikes = tracks.map(({ name, day, date, track }) => ({
    name,
    day,
    date,
    startedAt: track.startedAt ?? null,
    durationSec: track.durationSec ?? null,
    distanceM: track.distanceM,
    elevationGainM: track.elevationGainM ?? null,
    elevationLossM: track.elevationLossM ?? null,
  }));

  res.status(200).json({
    status: 'success',
    data: {
      schema: 'bodorgo.tour-report/1',
      status: draft ? 'draft' : 'final',
      recordedAt: draft ? null : report.published.at,
      promptNotes: promptNotes(),
      tour: { id: tourId, order: tour.order ?? null, title: tour.title },
      when: {
        startDate: days[0].date,
        endDate: tourDay(tour.startDate, Math.max(1, tour.duration ?? 1) - 1).ymd,
        days: tour.duration ?? 1,
      },
      where: {
        text: facts.place,
        country,
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
      },
      headcount: attendees.length,
      attendees: attendees.map((a) => aliases.get(a.id)).filter(Boolean),
      days,
      hikes,
      chunks,
    },
  });
};

function swapText(req) {
  const text = req.body?.text;
  if (typeof text !== 'string' || !text.trim()) throw new AppError('Nincs szöveg.', 400);
  if (text.length > MAX_SWAP_CHARS) throw new AppError('Túl hosszú szöveg.', 400);
  return text;
}

// POST /tours/report-names/hide (admin) - { text }: a question on its way
// to the model, every full name in it as its alias.
export const hideReportNames = async (req, res) => {
  res.status(200).json({ status: 'success', data: await hideNames(swapText(req)) });
};

// POST /tours/report-names/show (admin) - { text }: the model's answer,
// its aliases as names again.
export const showReportNames = async (req, res) => {
  res.status(200).json({ status: 'success', data: await showNames(swapText(req)) });
};
