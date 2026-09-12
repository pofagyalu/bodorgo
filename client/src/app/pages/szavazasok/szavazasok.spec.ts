import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Szavazasok } from './szavazasok';

describe('Szavazasok', () => {
  let component: Szavazasok;
  let fixture: ComponentFixture<Szavazasok>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Szavazasok]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Szavazasok);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
