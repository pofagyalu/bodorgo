import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Versenyek } from './versenyek';

describe('Versenyek', () => {
  let component: Versenyek;
  let fixture: ComponentFixture<Versenyek>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Versenyek]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Versenyek);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
