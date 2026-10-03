import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { API, formEntries, httpTesting, itSendsRequests } from '../../testing/http';
import { FutokorCourse, FutokorService, racePace, raceTime, tagOfToken } from './futokor';

const futokor = `${API}/futokor`;
const NOW = Date.parse('2026-06-01T10:00:00Z');

/** Start/finish card S, then the stops A and B, 1 km round. */
function course(over: Partial<FutokorCourse> = {}): FutokorCourse {
  return {
    _id: 'c1',
    kind: 'tour',
    tour: null,
    owner: { _id: 'u1', name: 'Gazda' },
    canManage: false,
    name: 'Tábori kör',
    opensAt: '2026-06-01T00:00:00Z',
    closesAt: '2026-06-02T00:00:00Z',
    distanceM: 1000,
    checkpoints: [
      { id: 's', tagId: 'S', kind: 'startFinish', label: 'Rajt', order: 0 },
      { id: 'a', tagId: 'A', kind: 'checkpoint', label: '1', order: 1, distanceAlongM: 300 },
      { id: 'b', tagId: 'B', kind: 'checkpoint', label: '2', order: 2, distanceAlongM: 600 },
    ],
    ...over,
  };
}

/** Lets the service's async steps run on after a flushed request. */
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('FutokorService', () => {
  let service: FutokorService;
  let http: HttpTestingController;

  /** Answers the "what's on" request the way the server does for a member. */
  async function refreshWith(courses: FutokorCourse[], tourCourse: FutokorCourse | null = null) {
    const done = service.refresh();
    http.expectOne(`${futokor}/active`).flush({
      data: { course: tourCourse, courses, runs: [], allRuns: {}, runner: { name: 'Bodri' } },
    });
    await done;
  }

  /** Answers the pending scan upload, accepting every scan in it. */
  async function answerScans(runs: unknown[] = []) {
    const req = http.expectOne(`${futokor}/scans`);
    const scans = req.request.body.scans as { clientScanId: string }[];
    req.flush({ data: { results: scans.map((s) => ({ clientScanId: s.clientScanId })), runs } });
    await settle();
    return req.request.body;
  }

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    TestBed.configureTestingModule({ providers: [httpTesting()] });
    service = TestBed.inject(FutokorService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  describe('what is on', () => {
    it('keeps the courses and the runner from the server, also on the phone', async () => {
      await refreshWith([course()]);
      expect(service.courses()).toHaveLength(1);
      expect(service.course()?._id).toBe('c1');
      expect(service.runner()).toEqual({ name: 'Bodri' });
      expect(service.owner()).toEqual({ name: 'Bodri' });
      expect(JSON.parse(localStorage.getItem('futokor-course')!)).toHaveLength(1);
      expect(JSON.parse(localStorage.getItem('futokor-me')!)).toEqual({ name: 'Bodri' });
    });

    it('has no chosen course while there are several and none is picked', async () => {
      await refreshWith([course(), course({ _id: 'c2' })]);
      expect(service.course()).toBeNull();
      service.select('c2');
      expect(service.course()?._id).toBe('c2');
      expect(localStorage.getItem('futokor-selected')).toBe('"c2"');
    });

    it("prefers the camp's own course when nothing is picked", async () => {
      const camp = course({ _id: 'camp' });
      await refreshWith([course(), camp], camp);
      expect(service.course()?._id).toBe('camp');
    });

    it('forgets a picked course that is no longer offered', async () => {
      await refreshWith([course(), course({ _id: 'c2' })]);
      service.select('c2');
      await refreshWith([course(), course({ _id: 'c3' })]);
      expect(service.course()).toBeNull();
      expect(localStorage.getItem('futokor-selected')).toBeNull();
    });

    it('falls back to the public courses for someone not logged in', async () => {
      const done = service.refresh();
      http.expectOne(`${futokor}/active`).flush('', { status: 401, statusText: 'Unauthorized' });
      await settle();
      http.expectOne(`${futokor}/course`).flush({ data: { course: course(), courses: undefined } });
      await done;
      expect(service.course()?._id).toBe('c1');
      expect(service.runner()).toBeNull();
    });

    it('keeps what the phone already knows when the server is unreachable', async () => {
      await refreshWith([course()]);
      const done = service.refresh();
      http.expectOne(`${futokor}/active`).error(new ProgressEvent('error'));
      await done;
      expect(service.courses()).toHaveLength(1);
      expect(service.runner()).toEqual({ name: 'Bodri' });
    });

    it('reads the saved state back after a restart of the app', async () => {
      await refreshWith([course()]);
      service.scan('S.sig');
      await answerScans();
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [httpTesting()] });
      const again = TestBed.inject(FutokorService);
      http = TestBed.inject(HttpTestingController);
      expect(again.course()?._id).toBe('c1');
      expect(again.run()?.status).toBe('running');
    });

    it('finds the open course a card belongs to', async () => {
      const closed = course({ _id: 'old', closesAt: '2026-05-01T00:00:00Z' });
      await refreshWith([closed, course()]);
      expect(service.courseOfCard('A.sig')?._id).toBe('c1');
      expect(service.courseOfCard('X.sig')).toBeNull();
    });
  });

  describe('a run', () => {
    beforeEach(() => refreshWith([course()]));

    it('goes from the start card through every stop to the finish', async () => {
      expect(service.scan('S.sig').result).toBe('started');
      expect(service.next()?.id).toBe('a');
      expect(service.waiting()).toBe(1);
      const sent = await answerScans();
      expect(sent.scans[0]).toMatchObject({ courseId: 'c1', token: 'S.sig' });
      expect(service.waiting()).toBe(0);

      vi.setSystemTime(NOW + 2 * 60_000);
      expect(service.scan('A.sig').result).toBe('passed');
      await answerScans();
      vi.setSystemTime(NOW + 4 * 60_000);
      expect(service.scan('B.sig').result).toBe('passed');
      await answerScans();
      expect(service.next()).toBeNull();

      vi.setSystemTime(NOW + 6 * 60_000);
      const finish = service.scan('S.sig');
      expect(finish.result).toBe('finished');
      expect(finish.run?.totalMs).toBe(6 * 60_000);
      await answerScans();
    });

    it('refuses a stop out of order, and sends nothing for it', () => {
      service.scan('S.sig');
      http.expectOne(`${futokor}/scans`);
      vi.setSystemTime(NOW + 2 * 60_000);
      const answer = service.scan('B.sig');
      expect(answer.result).toBe('rejectedOrder');
      expect(answer.missing?.id).toBe('a');
      expect(service.waiting()).toBe(1);
    });

    it('can be given up', async () => {
      service.scan('S.sig');
      await answerScans();
      expect(service.giveUp().result).toBe('gaveUp');
      expect(service.run()?.status).toBe('gave_up');
      const sent = await answerScans();
      expect(sent.scans[0]).toMatchObject({ action: 'giveUp' });
    });

    it('says so when there is no run to give up', () => {
      expect(service.giveUp().result).toBe('noRun');
    });

    it('expires when it runs past the time limit', async () => {
      service.scan('S.sig');
      await answerScans();
      service.expireIfDue();
      expect(service.run()?.status).toBe('running');
      vi.setSystemTime(NOW + 61 * 60_000);
      service.expireIfDue();
      expect(service.run()?.status).toBe('expired');
    });

    it('stays on its course even when another one is picked meanwhile', async () => {
      await refreshWith([course(), course({ _id: 'c2' })]);
      service.select('c1');
      service.scan('S.sig');
      await answerScans();
      service.select('c2');
      expect(service.course()?._id).toBe('c1');
    });

    it('keeps the scans on the phone while offline and sends them later', async () => {
      service.scan('S.sig');
      http.expectOne(`${futokor}/scans`).error(new ProgressEvent('error'));
      await settle();
      expect(service.waiting()).toBe(1);
      expect(service.syncing()).toBe(false);
      expect(JSON.parse(localStorage.getItem('futokor-queue')!)).toHaveLength(1);

      window.dispatchEvent(new Event('online'));
      await answerScans();
      expect(service.waiting()).toBe(0);
      expect(localStorage.getItem('futokor-queue')).toBeNull();
    });

    it("stores the server's runs of the course after a sync", async () => {
      service.scan('S.sig');
      await answerScans([{ courseId: 'c1', runs: [{ status: 'running', startedAt: 'now' }] }]);
      expect(service.serverRuns()).toHaveLength(1);
      expect(service.myRuns()[0].course._id).toBe('c1');
    });
  });

  it('answers "noCourse" when no course is known', () => {
    expect(service.scan('S.sig')).toEqual({ result: 'noCourse', run: null });
  });

  it('answers "closed" outside the opening hours of the course', async () => {
    await refreshWith([course({ closesAt: '2026-05-01T00:00:00Z' })]);
    expect(service.scan('S.sig').result).toBe('closed');
    expect(service.waiting()).toBe(0);
  });

  it('picks the course of the scanned card when another one was chosen', async () => {
    const other = course({
      _id: 'c2',
      checkpoints: [{ id: 's2', tagId: 'S2', kind: 'startFinish', label: 'Rajt', order: 0 }],
    });
    await refreshWith([course(), other]);
    service.select('c1');
    expect(service.scan('S2.sig').result).toBe('started');
    expect(service.course()?._id).toBe('c2');
    await answerScans();
  });

  describe('running with a code (a guest on this phone)', () => {
    beforeEach(() => refreshWith([course()]));

    it('runs under the name that belongs to the code', async () => {
      const done = service.runWithCode('42');
      const req = http.expectOne(`${futokor}/runner`);
      expect(req.request.body).toEqual({ code: '42' });
      req.flush({ data: { name: 'Vendég Vera' } });
      expect(await done).toBe('Vendég Vera');
      expect(service.runner()).toEqual({ code: '42', name: 'Vendég Vera' });
      expect(service.owner()).toEqual({ name: 'Bodri' });

      service.scan('S.sig');
      const sent = await answerScans();
      expect(sent.runnerCode).toBe('42');
    });

    it('refuses a code the server does not know', async () => {
      const done = service.runWithCode('99');
      http.expectOne(`${futokor}/runner`).flush('', { status: 404, statusText: 'Not Found' });
      expect(await done).toBe('unknown');
      expect(service.runner()).toEqual({ name: 'Bodri' });
    });

    it('accepts a code unchecked while offline', async () => {
      const done = service.runWithCode('42');
      http.expectOne(`${futokor}/runner`).error(new ProgressEvent('error'));
      expect(await done).toBeNull();
      expect(service.runner()).toEqual({ code: '42', name: '42-es futókód' });
    });

    it('drops the run when the code turns out not to exist at upload', async () => {
      const done = service.runWithCode('42');
      http.expectOne(`${futokor}/runner`).error(new ProgressEvent('error'));
      await done;
      service.scan('S.sig');
      http.expectOne(`${futokor}/scans`).flush('', { status: 404, statusText: 'Not Found' });
      await settle();
      expect(service.problem()).toContain('Nincs 42 futókód');
      expect(service.waiting()).toBe(0);
      expect(service.run()).toBeNull();
      expect(service.runner()).toEqual({ name: 'Bodri' });
    });

    it('goes back to the owner of the phone', async () => {
      service.runAsMyself(); // nothing to undo yet
      const done = service.runWithCode('42');
      http.expectOne(`${futokor}/runner`).flush({ data: { name: 'Vendég Vera' } });
      await done;
      service.runAsMyself();
      expect(service.runner()).toEqual({ name: 'Bodri' });
      expect(localStorage.getItem('futokor-runner')).toBeNull();
      http.expectOne(`${futokor}/active`).flush({
        data: { course: null, courses: [course()], runs: [], runner: { name: 'Bodri' } },
      });
      await settle();
    });
  });

  describe('live position', () => {
    let watch: ReturnType<typeof vi.fn>;
    let clearWatch: ReturnType<typeof vi.fn>;
    let getCurrentPosition: ReturnType<typeof vi.fn>;
    const original = navigator.geolocation;

    beforeEach(async () => {
      watch = vi.fn().mockReturnValue(7);
      clearWatch = vi.fn();
      getCurrentPosition = vi.fn();
      (navigator as { geolocation: unknown }).geolocation = {
        watchPosition: watch,
        clearWatch,
        getCurrentPosition,
      };
      await refreshWith([course()]);
    });

    afterEach(() => {
      (navigator as { geolocation: unknown }).geolocation = original;
    });

    it('asks for the permission when switched on, and remembers the choice', () => {
      service.setLive(true);
      expect(getCurrentPosition).toHaveBeenCalled();
      expect(localStorage.getItem('futokor-live')).toBe('true');
      const denied = getCurrentPosition.mock.calls[0][1];
      denied({ code: 1, PERMISSION_DENIED: 1 });
      expect(service.liveProblem()).toBe('denied');

      service.setLive(false);
      expect(service.liveProblem()).toBe('');
      expect(localStorage.getItem('futokor-live')).toBeNull();
    });

    it('follows the runner only during a run, and tells the server', async () => {
      service.setLive(true);
      TestBed.tick();
      expect(watch).not.toHaveBeenCalled();

      service.scan('S.sig');
      await answerScans();
      TestBed.tick();
      expect(watch).toHaveBeenCalledTimes(1);

      const [onPosition, onError] = watch.mock.calls[0];
      onPosition({ coords: { latitude: 47.5, longitude: 19, accuracy: 8 } });
      expect(service.myPosition()).toEqual({ lat: 47.5, lng: 19, accuracyM: 8 });
      const put = http.expectOne(`${futokor}/courses/c1/position`);
      expect(put.request.method).toBe('PUT');
      put.flush({});
      // a second fix within ten seconds isn't sent again
      onPosition({ coords: { latitude: 47.6, longitude: 19, accuracy: 8 } });
      http.expectNone(`${futokor}/courses/c1/position`);

      onError({ code: 1, PERMISSION_DENIED: 1 });
      expect(service.liveProblem()).toBe('denied');

      service.giveUp();
      await answerScans();
      TestBed.tick();
      expect(clearWatch).toHaveBeenCalledWith(7);
      expect(service.myPosition()).toBeNull();
      const del = http.expectOne(`${futokor}/courses/c1/position`);
      expect(del.request.method).toBe('DELETE');
      del.flush({});
    });
  });

  describe('admin requests', () => {
    itSendsRequests([
      ['getResults', () => service.getResults(), 'GET', `${futokor}/results`],
      [
        'getCourseResults',
        () => service.getCourseResults('c1'),
        'GET',
        `${futokor}/courses/c1/results`,
      ],
      ['getTags', () => service.getTags(), 'GET', `${futokor}/tags`],
      [
        'createTags',
        () => service.createTags({ count: 5 }),
        'POST',
        `${futokor}/tags`,
        { count: 5 },
      ],
      [
        'retireTag',
        () => service.retireTag('A', true),
        'PATCH',
        `${futokor}/tags/A`,
        { retired: true },
      ],
      ['getCourses', () => service.getCourses(), 'GET', `${futokor}/courses`],
      [
        'createTourCourse',
        () => service.createTourCourse({ tourId: 't1', opensAt: 'a', closesAt: 'b' }),
        'POST',
        `${futokor}/courses`,
        { tourId: 't1', opensAt: 'a', closesAt: 'b' },
      ],
      [
        'createOwnTrack',
        () => service.createOwnTrack({ name: 'Kör', points: 3 }),
        'POST',
        `${futokor}/courses`,
        { name: 'Kör', points: 3 },
      ],
      [
        'updateCourse',
        () => service.updateCourse('c1', { name: 'Új' }),
        'PATCH',
        `${futokor}/courses/c1`,
        { name: 'Új' },
      ],
      ['removeTrack', () => service.removeTrack('c1'), 'DELETE', `${futokor}/courses/c1/track`],
      ['deleteCourse', () => service.deleteCourse('c1'), 'DELETE', `${futokor}/courses/c1`],
    ]);

    it('uploads a GPX track as a form', () => {
      service.uploadTrack('c1', new File(['x'], 'kor.gpx')).subscribe();
      const req = http.expectOne(`${futokor}/courses/c1/track`);
      expect(req.request.method).toBe('PUT');
      expect(formEntries(req.request.body)).toEqual({ gpx: 'kor.gpx' });
      req.flush({ data: { course: course() } });
    });

    it('builds the sheet and GPX URLs', () => {
      expect(service.tagSheetUrl).toBe(`${futokor}/tags/sheet`);
      expect(service.sheetUrl('c1')).toBe(`${futokor}/courses/c1/sheet`);
      expect(service.gpxUrl('c1')).toBe(`${futokor}/courses/c1/track.gpx`);
    });
  });
});

describe('raceTime', () => {
  it.each([
    [null, '–'],
    [undefined, '–'],
    [0, '0:00'],
    [59_400, '0:59'],
    [61_000, '1:01'],
    [3_600_000, '1:00:00'],
    [3_725_000, '1:02:05'],
  ])('%s ms is "%s"', (ms, text) => {
    expect(raceTime(ms)).toBe(text);
  });
});

describe('racePace', () => {
  it('shows minutes and seconds per kilometre', () => {
    expect(racePace(305)).toBe('5:05 /km');
    expect(racePace(360)).toBe('6:00 /km');
  });

  it('is a dash when unknown', () => {
    expect(racePace(null)).toBe('–');
    expect(racePace(0)).toBe('–');
  });
});

describe('tagOfToken', () => {
  it('cuts the signature off the card id', () => {
    expect(tagOfToken('AB12.sig')).toBe('AB12');
    expect(tagOfToken('a.b.sig')).toBe('a.b');
    expect(tagOfToken('AB12')).toBe('AB12');
  });
});
