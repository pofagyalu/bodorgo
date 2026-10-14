import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { API } from '../../../../../testing/http';
import { fail, logIn, pageTesting, respond, settle } from '../../../../../testing/component';
import { StripePayoutCard } from './stripe-payout';

const state = (over: object = {}) => ({
  data: {
    configured: true,
    minPayout: 360,
    available: 5000,
    pending: 1102,
    bank: { bankName: 'TESZT BANK', last4: '0000' },
    schedule: 'manual',
    payouts: [
      {
        id: 'po_1',
        amount: 3000,
        status: 'paid',
        createdAt: '2026-10-01T08:00:00.000Z',
        arrivalDate: '2026-10-03T00:00:00.000Z',
      },
    ],
    ...over,
  },
});

describe('StripePayoutCard', () => {
  let fixture: ComponentFixture<StripePayoutCard>;
  let card: StripePayoutCard;
  let http: HttpTestingController;

  function open(wallet: 'membership' | 'tour', reply: object = state()) {
    fixture = TestBed.createComponent(StripePayoutCard);
    fixture.componentRef.setInput('wallet', wallet);
    card = fixture.componentInstance;
    fixture.detectChanges();
    respond({ [`GET /payments/stripe/payouts/${wallet}`]: reply });
    fixture.detectChanges();
  }

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [StripePayoutCard], providers: [pageTesting()] });
    http = TestBed.inject(HttpTestingController);
    // An admin who identified themselves just now (see fresh-login.service.ts).
    logIn({ role: 'admin' });
  });

  it('shows the balance, the bank account and the latest payouts', () => {
    open('membership');
    expect(card.title()).toBe('Tagdíjak');
    expect(fixture.nativeElement.hidden).toBe(false);
    expect(text()).toContain('Tagdíjak');
    expect(text()).toContain('5000 Ft');
    expect(text()).toContain('TESZT BANK');
    expect(text()).toContain('••••0000');
    expect(text()).toContain('megérkezett');
    expect(text()).not.toContain('automatikus kiutalás');
    expect(text()).not.toContain('TESZT MÓD');
  });

  it('marks a test account: its balance is pretend money', () => {
    open('membership', state({ livemode: false }));
    expect(text()).toContain('TESZT MÓD');
  });

  it('stays hidden while the account has no key on the server', () => {
    open('tour', { data: { configured: false } });
    expect(card.title()).toBe('Előlegek');
    expect(fixture.nativeElement.hidden).toBe(true);
  });

  it('says so when Stripe could not be asked', () => {
    open('membership', fail());
    expect(fixture.nativeElement.hidden).toBe(false);
    expect(text()).toContain('nem sikerült lekérdezni');
  });

  it('warns when Stripe also pays out by itself, and names an unknown bank account', () => {
    open('membership', state({ schedule: 'daily', bank: null }));
    expect(text()).toContain('automatikus kiutalás');
    expect(text()).toContain('a Stripe-nál beállított bankszámla');
  });

  it('only lets a whole amount between the least and the balance through', () => {
    open('membership');
    expect(card.canPay()).toBe(false);
    card.amount.set(100);
    expect(card.amountProblem()).toContain('Legalább');
    card.amount.set(6000);
    expect(card.amountProblem()).toContain('Legfeljebb');
    card.amount.set(1000.5);
    expect(card.amountProblem()).toContain('Egész');
    card.amount.set(5000);
    expect(card.amountProblem()).toBeNull();
    expect(card.canPay()).toBe(true);
  });

  it('cannot pay out a balance under the least payout', () => {
    open('membership', state({ available: 200 }));
    expect(text()).toContain('most nincs ennyi kiutalható');
    card.amount.set(200);
    expect(card.canPay()).toBe(false);
  });

  it('pays out once, then shows the fresh balance', async () => {
    open('membership');
    await card.payOut(); // no amount yet
    http.expectNone(`${API}/payments/stripe/payouts`);

    card.amount.set(4000);
    void card.payOut();
    void card.payOut();
    await settle();
    const req = http.expectOne(`${API}/payments/stripe/payouts`);
    expect(req.request.body).toEqual({ wallet: 'membership', amount: 4000 });
    req.flush({ data: { payout: { id: 'po_2', amount: 4000, status: 'pending' } } });
    expect(card.notice()?.kind).toBe('success');
    expect(card.notice()?.text).toContain('4000 Ft');
    expect(card.amount()).toBeNull();
    respond({ 'GET /payments/stripe/payouts/membership': state({ available: 1000 }) });
    expect(card.available()).toBe(1000);
  });

  it('reports a failed payout', async () => {
    open('membership');
    card.amount.set(1000);
    await card.payOut();
    respond({ 'POST /payments/stripe/payouts': fail(400, 'Most legfeljebb 500 Ft utalható ki.') });
    expect(card.notice()).toEqual({ kind: 'error', text: 'Most legfeljebb 500 Ft utalható ki.' });
    expect(card.paying()).toBe(false);
  });
});
