import {
  trigger,
  state,
  style,
  animate,
  transition,
  query,
  animateChild,
  group,
} from '@angular/animations';

export const slideAnimation = trigger('routeAnimations', [
  transition(':increment', slideTo('right')),
  transition(':decrement', slideTo('left')),
]);

function slideTo(direction: string) {
  const optional = { optional: true };
  return [
    style({ position: 'relative' }),
    query(
      ':enter, :leave',
      [
        style({
          position: 'absolute',
          top: 0,
          [direction]: 0,
          width: '100%',
        }),
      ],
      optional
    ),
    query(':enter', [style({ [direction]: '-100%' })]),
    group([
      query(
        ':leave',
        [animate('600ms ease-out', style({ [direction]: '100%', opacity: 0 }))],
        optional
      ),
      query(
        ':enter',
        [animate('600ms ease-out', style({ [direction]: '0%' }))],
        optional
      ),
      query('@*', animateChild(), optional),
    ]),

    // Required only if you have child animations on the page
    // query(':leave', animateChild(), optional),
    // query(':enter', animateChild()),
  ];
}
