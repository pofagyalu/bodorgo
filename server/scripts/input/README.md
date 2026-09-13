# scripts/input/

Drop the JSON files you hand-write for `addTour.js` / `addSchedule.js` here
(e.g. `tour-32.json`, `events-32.json`) so the paths you type stay short
and always in the same place:

```
node scripts/addTour.js scripts/input/tour-32.json
node scripts/addSchedule.js <tourId> scripts/input/events-32.json
```

`example-tour.json` and `example-events.json` are committed templates -
copy one to a new file (e.g. `tour-32.json`) and edit it rather than
starting from a blank file each time.

Everything else in this folder is gitignored - these are one-off working
files, not permanent seed data (that lives in `dev-data/data/`). Keep them
around locally for your own reference if you want, or delete them once
they're uploaded; either way they never need to be committed.
