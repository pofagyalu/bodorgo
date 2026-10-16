import { ComponentFixture, TestBed } from '@angular/core/testing';

import { VideoCard } from './video-card';

describe('VideoCard', () => {
  let fixture: ComponentFixture<VideoCard>;
  const corner = () => (fixture.nativeElement as HTMLElement).querySelector('.corner-badge--right');
  const aiBadge = () => (fixture.nativeElement as HTMLElement).querySelector('.ai-badge');

  function open(inputs: Record<string, unknown>) {
    fixture = TestBed.createComponent(VideoCard);
    fixture.componentRef.setInput('title', 'Farsang');
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
  }

  it('shows the length in the bottom right corner', () => {
    open({ badgeRight: '12:34' });
    expect(corner()!.textContent!.trim()).toBe('12:34');
    expect(aiBadge()).toBeNull();
    open({});
    expect(corner()).toBeNull();
  });

  it('marks a video made with AI on its own, the length staying as it was', () => {
    open({ badgeRight: '12:34', aiGenerated: true });
    expect(aiBadge()!.textContent!.replace('auto_awesome', '').trim()).toBe('AI');
    expect(corner()!.textContent!.trim()).toBe('12:34');
  });
});
