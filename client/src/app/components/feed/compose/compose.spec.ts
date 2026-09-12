import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Compose } from './compose';

describe('Compose', () => {
  let component: Compose;
  let fixture: ComponentFixture<Compose>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Compose]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Compose);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
