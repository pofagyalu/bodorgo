import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { API } from '../../../../../testing/http';
import { fail, logIn, pageTesting, respond, settle } from '../../../../../testing/component';
import { LogFiles, toEntries } from './log-files';

const files = {
  data: {
    files: [
      { name: 'app-2026-10-14.log', kind: 'app', date: '2026-10-14', gz: false, size: 10 },
      { name: 'error-2026-10-14.log', kind: 'error', date: '2026-10-14', gz: false, size: 5 },
      { name: 'error-2026-10-01.log.gz', kind: 'error', date: '2026-10-01', gz: true, size: 3 },
    ],
  },
};

const appLines = [
  '[2026-10-14 06:31:19] info: App is listening on 8235',
  '[2026-10-14 06:40:00] error: UNCAUGHT EXCEPTION! boom',
  'Error: boom',
  '    at x.js:1',
  '[2026-10-14 06:41:00] info: back',
];

describe('toEntries', () => {
  it('groups a stack trace with its entry, newest first, and marks the errors', () => {
    expect(toEntries(appLines)).toEqual([
      { text: '[2026-10-14 06:41:00] info: back', error: false },
      {
        text: '[2026-10-14 06:40:00] error: UNCAUGHT EXCEPTION! boom\nError: boom\n    at x.js:1',
        error: true,
      },
      { text: '[2026-10-14 06:31:19] info: App is listening on 8235', error: false },
    ]);
  });
});

describe('LogFiles (Klub → Napló → Naplófájlok)', () => {
  let fixture: ComponentFixture<LogFiles>;
  let page: LogFiles;
  let http: HttpTestingController;

  async function open(routes: Record<string, object> = {}) {
    fixture = TestBed.createComponent(LogFiles);
    page = fixture.componentInstance;
    fixture.detectChanges();
    await settle();
    respond({
      'GET /settings/logs': files,
      'GET /settings/logs/app-2026-10-14.log': {
        data: { name: 'app-2026-10-14.log', totalLines: 1200, lines: appLines },
      },
      ...routes,
    });
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [LogFiles], providers: [pageTesting()] });
    http = TestBed.inject(HttpTestingController);
    // The role manager, who identified themselves just now.
    logIn({ role: 'admin', canManageRoles: true });
  });

  it("opens on the newest day's whole log, newest entry first", async () => {
    await open();
    expect(page.day()).toBe('2026-10-14');
    expect(page.dayOptions().map((o) => o.value)).toEqual(['2026-10-14', '2026-10-01']);
    const items = [...fixture.nativeElement.querySelectorAll('.logs-list li')] as HTMLElement[];
    expect(items).toHaveLength(3);
    expect(items[1].classList).toContain('logs-error');
    expect(page.downloadUrl()).toBe(`${API}/settings/logs/app-2026-10-14.log/download`);
    expect(fixture.nativeElement.textContent).toContain(
      'Az utolsó 5 sor (összesen 1200), a legújabb felül.',
    );
  });

  it('asks for more of the older lines', async () => {
    await open();
    page.more();
    const req = http.expectOne((r) => r.url === `${API}/settings/logs/app-2026-10-14.log`);
    expect(req.request.params.get('lines')).toBe('505');
  });

  it('shows only the errors, and says when a day had none', async () => {
    await open();
    page.setErrorsOnly(true);
    respond({
      'GET /settings/logs/error-2026-10-14.log': {
        data: { name: 'error-2026-10-14.log', totalLines: 1, lines: [appLines[1]] },
      },
    });
    fixture.detectChanges();
    expect(page.entries()).toHaveLength(1);

    page.setErrorsOnly(false);
    page.pickDay('2026-10-01'); // only an error log is left of that day
    fixture.detectChanges();
    expect(page.file()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('nincs teljes napló');
  });

  it('says so when the list could not be loaded', async () => {
    await open({ 'GET /settings/logs': fail(500) });
    expect(page.failed()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('nem sikerült betölteni');
  });

  it('says so when a file could not be loaded', async () => {
    await open();
    page.pickDay('2026-10-14');
    http
      .expectOne((r) => r.url === `${API}/settings/logs/app-2026-10-14.log`)
      .flush({ message: 'Hiba.' }, { status: 500, statusText: 'Error' });
    fixture.detectChanges();
    expect(page.failed()).toBe(true);
  });
});
