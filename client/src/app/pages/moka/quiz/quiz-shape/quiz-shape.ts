import { Component, input } from '@angular/core';
import { AnswerShape } from '../../../../services/quiz';

// Móka → Kvíz: an answer's own shape (with its colour: the pages' .a0 -
// .a3) - drawn here, not a character of some font, so the four are as big
// as each other to the eye wherever they're shown. Its size is its
// font-size (the square is 0.86 of that; the others are a little bigger in
// measure to look the same), its colour the text's.
@Component({
  selector: 'app-quiz-shape',
  template: `<i [class]="shape()"></i>`,
  styles: `
    :host {
      display: inline-grid;
      place-items: center;
      flex: none;
      width: 1.1em;
      height: 1.1em;
      line-height: 1;
    }

    i {
      display: block;
      background: currentColor;
    }

    .square {
      width: 0.86em;
      height: 0.86em;
      border-radius: 0.06em;
    }

    .circle {
      width: 0.96em;
      height: 0.96em;
      border-radius: 50%;
    }

    .triangle {
      width: 1.06em;
      height: 0.92em;
      clip-path: polygon(50% 0, 100% 100%, 0 100%);
    }

    .diamond {
      width: 1.1em;
      height: 1.1em;
      clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
    }
  `,
})
export class QuizShape {
  shape = input.required<AnswerShape>();
}
