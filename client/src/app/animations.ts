import {
  trigger,
  style,
  animate,
  transition,
  query,
  animateChild,
  group,
} from '@angular/animations';

// A movie-style cross-dissolve: the leaving page fades out while the
// entering page fades in on top of it, both overlapping in place (no
// left/right movement at all) - replaces the old slide-in/out transition,
// which the user found overly busy and inconsistent-looking.
export const routeFadeAnimation = trigger('routeAnimations', [
  transition('* <=> *', [
    style({ position: 'relative' }),
    query(
      ':enter, :leave',
      [
        style({
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
        }),
      ],
      { optional: true },
    ),
    query(':enter', [style({ opacity: 0 })], { optional: true }),
    query(':leave', animateChild(), { optional: true }),
    group([
      query(':leave', [animate('0.25s ease-out', style({ opacity: 0 }))], { optional: true }),
      query(':enter', [animate('0.35s ease-in', style({ opacity: 1 }))], { optional: true }),
      query('@*', animateChild(), { optional: true }),
    ]),
  ]),
]);
