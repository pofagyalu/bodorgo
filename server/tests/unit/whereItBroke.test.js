import { describe, expect, it } from 'vitest';
import { whereItBroke } from '../../src/controllers/errorController.js';

describe('whereItBroke', () => {
  it('names our own code’s first three places, without Node’s and the libraries’', () => {
    const err = new RangeError('Invalid time value');
    err.stack = [
      'RangeError: Invalid time value',
      '    at DateTimeFormat.formatToParts (<anonymous>)',
      '    at zoneOffset (file:///volume2/server/bodorgo/src/futokor/tourWindow.js:24:8)',
      '    at tourCourseWindow (file:///volume2/server/bodorgo/src/futokor/tourWindow.js:54:31)',
      '    at model.save (/volume2/server/bodorgo/node_modules/mongoose/lib/model.js:1:1)',
      '    at updateTour (file:///volume2/server/bodorgo/src/controllers/tourController.js:530:5)',
      '    at alsoOurs (/volume2/server/bodorgo/src/app.js:1:1)',
      '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)',
    ].join('\n');
    expect(whereItBroke(err)).toBe(
      'zoneOffset (futokor/tourWindow.js:24) ← tourCourseWindow (futokor/tourWindow.js:54) ← updateTour (controllers/tourController.js:530)',
    );
  });

  it('says nothing without a stack', () => {
    expect(whereItBroke({})).toBe('');
    expect(whereItBroke(undefined)).toBe('');
  });
});
