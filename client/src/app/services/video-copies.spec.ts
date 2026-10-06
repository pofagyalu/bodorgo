import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { API, httpTesting } from '../../testing/http';
import { NotificationsService } from '../notifications/notifications.service';
import { VideoCopiesService } from './video-copies';

const list = `${API}/media/videos/small-copies`;

describe('VideoCopiesService', () => {
  let service: VideoCopiesService;
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [httpTesting()] });
    service = TestBed.inject(VideoCopiesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  it("knows a Média video's and a tour video's job and address", () => {
    expect(service.media('farsang', 'v1')).toEqual({
      ref: 'media:farsang:v1',
      url: `${API}/media/videos/farsang/v1/small`,
    });
    expect(service.tour('t1', 'v1')).toEqual({
      ref: 'tour:t1:v1',
      url: `${API}/tours/t1/videos/v1/small`,
    });
  });

  it('shows what the list said until it knows better', () => {
    expect(service.stateOf('media:farsang:v1', 'ready').state).toBe('ready');
    expect(service.stateOf('media:farsang:v1', undefined).state).toBe('none');
  });

  it('follows a conversion to its end, then stops asking', () => {
    const target = service.media('farsang', 'v1');
    service.convert(target);
    http.expectOne(target.url).flush({ data: { job: { ref: target.ref, state: 'queued' } } });
    expect(service.stateOf(target.ref, 'none').state).toBe('queued');

    vi.advanceTimersByTime(3000);
    http
      .expectOne(list)
      .flush({ data: { jobs: [{ ref: target.ref, state: 'converting', percent: 40 }] } });
    expect(service.stateOf(target.ref, 'none')).toMatchObject({ state: 'converting', percent: 40 });

    // A failed status request doesn't end it.
    vi.advanceTimersByTime(3000);
    http.expectOne(list).flush('', { status: 502, statusText: 'Bad Gateway' });

    vi.advanceTimersByTime(3000);
    http.expectOne(list).flush({ data: { jobs: [{ ref: target.ref, state: 'ready' }] } });
    expect(service.stateOf(target.ref, 'none').state).toBe('ready');

    vi.advanceTimersByTime(10000);
    http.expectNone(list);
  });

  it('picks up conversions already going when a page opens', () => {
    service.refresh();
    http.expectOne(list).flush({ data: { jobs: [{ ref: 'tour:t1:v1', state: 'converting' }] } });
    expect(service.stateOf('tour:t1:v1', 'none').state).toBe('converting');
    vi.advanceTimersByTime(3000);
    http.expectOne(list).flush({ data: { jobs: [{ ref: 'tour:t1:v1', state: 'failed' }] } });
    expect(service.stateOf('tour:t1:v1', 'none').state).toBe('failed');
  });

  it('a removed copy is gone at once, whatever the list said - and stays gone', () => {
    const target = service.tour('t1', 'v1');
    service.remove(target);
    http.expectOne({ method: 'DELETE', url: target.url }).flush(null);
    expect(service.stateOf(target.ref, 'ready').state).toBe('none');

    service.refresh();
    http.expectOne(list).flush({ data: { jobs: [] } });
    expect(service.stateOf(target.ref, 'ready').state).toBe('none');
  });

  it("says so when it can't start or remove one", () => {
    const error = vi.spyOn(TestBed.inject(NotificationsService), 'addError');
    const target = service.media('farsang', 'v1');
    service.convert(target);
    http
      .expectOne(target.url)
      .flush({ message: 'Nincs ilyen videó.' }, { status: 404, statusText: 'Not Found' });
    expect(error).toHaveBeenCalledWith('Nincs ilyen videó.');

    service.remove(target);
    http.expectOne(target.url).flush('', { status: 500, statusText: 'Error' });
    expect(error).toHaveBeenCalledWith('Nem sikerült törölni a kis méretű változatot.');
    expect(service.stateOf(target.ref, 'ready').state).toBe('ready');
  });
});
