import { TestBed } from '@angular/core/testing';

import { Command, NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let shown: Command[];

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    service = TestBed.inject(NotificationsService);
    shown = [];
    service.messagesOutput.subscribe((messages) => (shown = messages));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('shows success and error messages in the order they came', () => {
    service.addSuccess('Mentve');
    service.addError('Nem sikerült');
    expect(shown.map((m) => [m.type, m.text])).toEqual([
      ['success', 'Mentve'],
      ['error', 'Nem sikerült'],
    ]);
  });

  it('takes a message off after five seconds', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.1).mockReturnValueOnce(0.2);
    service.addSuccess('Első');
    vi.advanceTimersByTime(3000);
    service.addError('Második');
    vi.advanceTimersByTime(2000);
    expect(shown.map((m) => m.text)).toEqual(['Második']);
    vi.advanceTimersByTime(3000);
    expect(shown).toEqual([]);
  });

  it('takes a message off at once when it is closed', () => {
    service.addSuccess('Mentve');
    service.clearMessage(shown[0].id);
    expect(shown).toEqual([]);
  });
});
