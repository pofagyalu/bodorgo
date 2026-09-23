import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Klub } from './klub';

describe('Klub', () => {
  let component: Klub;
  let fixture: ComponentFixture<Klub>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Klub],
    }).compileComponents();

    fixture = TestBed.createComponent(Klub);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
