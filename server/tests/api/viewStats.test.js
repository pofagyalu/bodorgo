import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createGuest, createMember, createTour } from '../helpers/factories.js';
import ActiveDay from '../../src/models/activeDayModel.js';
import Song from '../../src/models/songModel.js';
import View from '../../src/models/viewModel.js';
import { clearActivityMemory, deviceOf } from '../../src/utils/activity.js';
import { budapestYmd } from '../../src/utils/huDate.js';

// Who used the app on which day (utils/activity.js), the Daloskönyv songs
// and the songbook searches among the views (utils/views.js), and Klub →
// Statisztika's totals (GET /views/stats).

const PHONE =
  'Mozilla/5.0 (Linux; Android 14; SM-S916B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const TABLET =
  'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const daysAgo = (n) => budapestYmd(new Date(Date.now() - n * 24 * 3600 * 1000));

beforeEach(() => clearActivityMemory());

// noteActive isn't waited for: the record comes a moment after the answer.
async function activeDays(user, count = 1) {
  for (let i = 0; i < 50; i++) {
    const days = await ActiveDay.find({ user: user._id }).lean();
    if (days.length >= count && days.every((d) => d.devices.length)) return days;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return ActiveDay.find({ user: user._id }).lean();
}

const get = (user, url, userAgent = DESKTOP) =>
  request(app).get(url).set(asUser(user)).set('User-Agent', userAgent);

describe('who used the app on which day', () => {
  it('tells a phone, a tablet and a computer apart', () => {
    expect(deviceOf(PHONE)).toBe('phone');
    expect(deviceOf(TABLET)).toBe('tablet');
    expect(deviceOf(DESKTOP)).toBe('desktop');
    expect(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile')).toBe('phone');
    expect(deviceOf(undefined)).toBe('desktop');
  });

  it('notes a person once a day - with every device they came on', async () => {
    const me = await createMember();
    await get(me, '/views/popular', PHONE);
    await get(me, '/views/popular', PHONE);
    let [day] = await activeDays(me);
    expect(day).toMatchObject({ day: budapestYmd(), devices: ['phone'], app: false });
    await get(me, '/views/popular', DESKTOP);
    for (let i = 0; i < 50 && day.devices.length < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      [day] = await activeDays(me);
    }
    expect(day.devices.sort()).toEqual(['desktop', 'phone']);
    expect(await ActiveDay.countDocuments({ user: me._id })).toBe(1);
  });

  it('the installed app says it is the one in use', async () => {
    const me = await createGuest();
    const res = await request(app).post('/views/app').set(asUser(me));
    expect(res.status).toBe(204);
    const days = await activeDays(me);
    expect(days[0]).toMatchObject({ day: budapestYmd(), app: true });
  });
});

describe('Daloskönyv songs and searches among the views', () => {
  const send = (user, views) => request(app).post('/views').set(asUser(user)).send({ views });

  it('counts a song that is in the book', async () => {
    const song = await Song.create({ title: 'Eső után', artist: 'Zenekar' });
    const res = await send(await createGuest(), [
      { type: 'song', key: String(song._id) },
      { type: 'song', key: '64b000000000000000000000' },
      { type: 'song', key: 'nem-id' },
    ]);
    expect(res.body.data.recorded).toBe(1);
  });

  it('keeps a search tidied - not one too short or too long', async () => {
    const me = await createMember();
    const res = await send(me, [
      { type: 'search', key: '  Szép   Kék  ÉG ' },
      { type: 'search', key: 'ab' },
      { type: 'search', key: 'x'.repeat(61) },
    ]);
    expect(res.body.data.recorded).toBe(1);
    expect(await View.findOne({ type: 'search' }).lean()).toMatchObject({ key: 'szep kek eg' });
    // The same words again, written another way: the same search.
    expect((await send(me, [{ type: 'search', key: 'szep kek eg' }])).body.data.recorded).toBe(0);
  });
});

describe('Klub → Statisztika', () => {
  it('is for the admins, for the periods it knows', async () => {
    expect((await get(await createMember(), '/views/stats')).status).toBe(403);
    const admin = await createAdmin();
    expect((await get(admin, '/views/stats?days=12')).status).toBe(400);
    expect((await get(admin, '/views/stats?days=abc')).status).toBe(400);
    expect((await get(admin, '/views/stats?days=0')).status).toBe(200);
  });

  it('gives the active people, their devices and who came back', async () => {
    const [a, b, c] = await Promise.all([createMember(), createMember(), createGuest()]);
    await ActiveDay.create([
      { user: a._id, day: daysAgo(0), devices: ['phone'], app: true },
      { user: a._id, day: daysAgo(2), devices: ['phone', 'desktop'] },
      { user: b._id, day: daysAgo(2), devices: ['desktop'] },
      { user: c._id, day: daysAgo(20), devices: ['tablet'] },
      { user: c._id, day: daysAgo(100), devices: ['phone'] },
    ]);
    const admin = await createAdmin();
    clearActivityMemory();
    const { data } = (await get(admin, '/views/stats?days=7')).body;
    // The admin asking is here today too - by the time of the count, or not.
    const todayExtra = data.people.today - 1;
    expect(data.activity.unit).toBe('day');
    expect(data.activity.points).toHaveLength(7);
    expect(data.activity.points[4]).toEqual({ label: daysAgo(2), people: 2 });
    expect(data.people).toMatchObject({ week: 2 + todayExtra, returning: 1 });
    expect(data.devices.phone).toBe(2);
    expect(data.app).toEqual({ days: 1, people: 1 });

    const month = (await get(admin, '/views/stats?days=30')).body.data;
    expect(month.devices.tablet).toBe(1);
    const all = (await get(admin, '/views/stats?days=0')).body.data;
    expect(all.since).toBeNull();
    expect(all.activity.unit).toBe('month');
    expect(all.activity.points[0]).toEqual({ label: daysAgo(100).slice(0, 7), people: 1 });
  });

  it('gives the most viewed of each kind and the searches that found nothing', async () => {
    const tour = await createTour();
    const song = await Song.create({ title: 'Eső után', artist: 'Zenekar' });
    const people = await Promise.all([createMember(), createMember(), createMember()]);
    for (const [i, user] of people.entries()) {
      await View.create({ type: 'tour', key: String(tour._id), user: user._id, day: daysAgo(i) });
      await View.create({ type: 'song', key: String(song._id), user: user._id, day: daysAgo(0) });
    }
    await View.create({
      type: 'song',
      key: '64b000000000000000000000',
      user: people[0]._id,
      day: daysAgo(0),
    });
    await View.create({ type: 'search', key: 'szep kek eg', user: people[0]._id, day: daysAgo(0) });
    await View.create({ type: 'search', key: 'szep kek eg', user: people[0]._id, day: daysAgo(1) });
    await View.create({ type: 'search', key: 'regi dal', user: people[1]._id, day: daysAgo(40) });

    const { data } = (await get(await createAdmin(), '/views/stats?days=30')).body;
    expect(data.top.tour).toEqual([
      expect.objectContaining({ id: String(tour._id), views: 3, viewers: 3 }),
    ]);
    // A song no longer in the book is left out.
    expect(data.top.song).toEqual([
      {
        key: String(song._id),
        title: 'Eső után',
        artist: 'Zenekar',
        link: `/media/zene/daloskonyv/${song.slug}`,
        views: 3,
        viewers: 3,
      },
    ]);
    expect(data.top.photo).toEqual([]);
    expect(data.searches).toEqual([{ words: 'szep kek eg', times: 2, people: 1 }]);
  });
});
