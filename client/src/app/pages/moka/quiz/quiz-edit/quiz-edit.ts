import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { NotificationsService } from '../../../../notifications/notifications.service';
import { ConfirmService } from '../../../../shared/confirm-dialog/confirm.service';
import { errorMessage } from '../../../../shared/errors';
import { shrinkImage } from '../../../../shared/image-resize';
import { PLAYLIST_NAMES } from '../../../../services/music-player';
import {
  ANSWER_SHAPES,
  DEFAULT_BOUNDS,
  DEFAULT_TIME_LIMIT,
  MAX_ANSWERS,
  MAX_QUESTIONS,
  MIN_ANSWERS,
  QuizBounds,
  QuizDraft,
  QuizPlace,
  QuizQuestion,
  QuizQuestionType,
  QuizService,
  QuizSong,
  TIME_LIMITS,
  hasPicture,
} from '../../../../services/quiz';
import { Tour, TourService } from '../../../../services/tour';
import { QuizMap } from '../quiz-map/quiz-map';
import { QuizShape } from '../quiz-shape/quiz-shape';
import { PickedTourPhoto, QuizPhotoPicker } from './photo-picker/photo-picker';
import { QuizPreview } from './quiz-preview/quiz-preview';
import { PickedSong, QuizSongPicker } from './song-picker/song-picker';

// A question in the editor always has all four answer slots: one left
// empty simply isn't an answer (see toDraft).
const blankQuestion = (): QuizQuestion => ({
  type: 'choice',
  text: '',
  image: null,
  answers: Array<string>(MAX_ANSWERS).fill(''),
  correct: 0,
  timeLimitSec: DEFAULT_TIME_LIMIT,
});

const filled = (answers: string[]) => answers.filter((a) => a.trim()).length;
const onMap = (p: QuizPlace, b: QuizBounds) =>
  p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;

// The kinds of question to choose from - each with what it means, and what
// to put where the question goes.
const TYPES: { value: QuizQuestionType; label: string; icon: string; hint: string; ask: string }[] =
  [
    {
      value: 'choice',
      label: 'Sima kérdés',
      icon: 'quiz',
      hint: 'Egy kérdés, 2–4 válasz – egy a helyes.',
      ask: 'A kérdés',
    },
    {
      value: 'truefalse',
      label: 'Igaz?',
      icon: 'rule',
      hint: 'Egy állítás – igaz vagy hamis?',
      ask: 'Az állítás – pl. A Kékes Magyarország legmagasabb pontja.',
    },
    {
      value: 'picture',
      label: 'Mozaik',
      icon: 'image_search',
      hint: 'Egy kép játék közben csempénként tárul fel – aki hamarabb rájön, több pontot kap.',
      ask: 'A kérdés – pl. Hol készült ez a kép?',
    },
    {
      value: 'zoom',
      label: 'Nagyító',
      icon: 'zoom_out_map',
      hint: 'Egy kép apró részletéről indulunk, és lassan távolodunk – aki hamarabb rájön, több pontot kap.',
      ask: 'A kérdés – pl. Ki van a képen?',
    },
    {
      value: 'song',
      label: 'Dal',
      icon: 'music_note',
      hint: 'Egy dal szól a te készülékeden – a játékosok a válaszok közül választanak.',
      ask: 'A kérdés – pl. Melyik dal ez?',
    },
    {
      value: 'map',
      label: 'Térkép',
      icon: 'location_on',
      hint: 'Mindenki a térképre koppint, és a jelölőt az idő végéig áthelyezheti – aki a legközelebb van, a legtöbb pontot kapja.',
      ask: 'A kérdés – pl. Hol volt a 2019-es tábor?',
    },
  ];

// What a question still lacks to be whole, in words - null: nothing.
function missingOf(q: QuizQuestion): string | null {
  if (hasPicture(q.type) && !q.image) return 'válassz hozzá képet.';
  if (q.type === 'song' && !q.song) return 'válassz hozzá dalt.';
  if (!q.text.trim()) return 'írd be a kérdést.';
  if (q.type === 'map') {
    if (!q.place) return 'koppints a térképen a helyes helyre.';
    if (!onMap(q.place, q.bounds ?? DEFAULT_BOUNDS)) return 'a hely nincs a térkép látható részén.';
  } else if (hasAnswers(q.type)) {
    if (filled(q.answers) < MIN_ANSWERS) return 'legalább két válasz kell.';
    if (!q.answers[q.correct].trim()) return 'a helyesnek jelölt válasz üres.';
  }
  return null;
}

// Which kinds are answered by picking one of up to four written answers.
const hasAnswers = (type: QuizQuestionType) => type !== 'truefalse' && type !== 'map';

// Móka → Kvíz → Alkotóműhely → a new quiz, or one of my own: its title and its
// questions - each of a kind chosen first, and how long there is to
// think. What a question needs depends on its kind: up to four answers
// with the right one ticked; true or false; a picture (one of my own, or a
// tour's photo) - for the zoom, with the detail it starts on; a song of a
// playlist; a place on the map and the part of the map to show.
// One question is open at a time (`selected`), with a preview of it to be
// tried on the spot (quiz-preview) - beside the form on a wide screen,
// over it on a phone.
@Component({
  selector: 'app-quiz-edit',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    MatIconModule,
    QuizPhotoPicker,
    QuizSongPicker,
    QuizMap,
    QuizPreview,
    QuizShape,
  ],
  templateUrl: './quiz-edit.html',
  styleUrl: './quiz-edit.scss',
})
export class QuizEdit {
  private quiz = inject(QuizService);
  private tourService = inject(TourService);
  private router = inject(Router);
  private notifications = inject(NotificationsService);
  private confirm = inject(ConfirmService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  // None: a new quiz.
  readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id');
  readonly shapes = ANSWER_SHAPES;
  readonly timeLimits = TIME_LIMITS;
  readonly types = TYPES;
  readonly defaultBounds = DEFAULT_BOUNDS;
  readonly hasPicture = hasPicture;
  readonly hasAnswers = hasAnswers;
  typeOf = (q: QuizQuestion) => TYPES.find((t) => t.value === q.type) ?? TYPES[0];

  title = signal('');
  questions = signal<QuizQuestion[]>([blankQuestion()]);
  loaded = signal(!this.id);
  // The question that is open in the form.
  selected = signal(0);
  // On a phone: the preview is over the form.
  previewOpen = signal(false);
  saving = signal(false);
  // The question a tour's photo / a song is being picked for (its picker
  // is open).
  pickingFor = signal<number | null>(null);
  pickingSongFor = signal<number | null>(null);
  // The question whose picture is on its way to the server.
  uploadingFor = signal<number | null>(null);
  // The map question whose list of tours (to take a place from) is open.
  toursFor = signal<number | null>(null);
  // The tours, the newest first - loaded when first needed.
  tours = signal<Tour[] | null>(null);

  isFull = computed(() => this.questions().length >= MAX_QUESTIONS);

  // What still keeps it from being saved - the first thing, in words.
  problem = computed<string | null>(() => {
    if (!this.title().trim()) return 'Adj címet a kvíznek.';
    for (const [i, q] of this.questions().entries()) {
      const missing = missingOf(q);
      if (missing) return `${i + 1}. kérdés: ${missing}`;
    }
    return null;
  });

  // What the open question still lacks - until then there's nothing worth
  // trying in its preview.
  previewWaitsFor = computed(() => missingOf(this.questions()[this.selected()]));

  constructor() {
    if (!this.id) return;
    this.quiz.getQuiz(this.id).subscribe({
      next: (quiz) => {
        this.title.set(quiz.title);
        this.questions.set(
          (quiz.questions ?? []).map((q) => ({
            ...q,
            // A true-or-false or a map question has its own answers - the
            // four slots are there (empty) if its kind is changed.
            answers: [
              ...(hasAnswers(q.type) ? q.answers : []),
              ...Array<string>(MAX_ANSWERS).fill(''),
            ].slice(0, MAX_ANSWERS),
          })),
        );
        this.loaded.set(true);
      },
      error: (err) => {
        this.notifications.addError(errorMessage(err, 'Nem sikerült betölteni a kvízt.'));
        this.router.navigate(['/moka/kviz/szerkeszto']);
      },
    });
  }

  private patch(idx: number, change: Partial<QuizQuestion>) {
    this.questions.update((list) => list.map((q, i) => (i === idx ? { ...q, ...change } : q)));
  }

  // What belongs to another kind (a picture, a song, a place) stays with
  // the question while it's being edited, in case the kind is switched
  // back - toDraft leaves it out.
  setType(idx: number, type: QuizQuestionType) {
    const q = this.questions()[idx];
    this.patch(idx, {
      type,
      // True or false has only two to choose from.
      ...(type === 'truefalse' && { correct: Math.min(q.correct, 1) }),
      ...(type === 'map' && !q.bounds && { bounds: DEFAULT_BOUNDS }),
    });
  }

  setText(idx: number, text: string) {
    this.patch(idx, { text });
  }

  setAnswer(idx: number, answerIdx: number, value: string) {
    const answers = this.questions()[idx].answers.map((a, i) => (i === answerIdx ? value : a));
    this.patch(idx, { answers });
  }

  setCorrect(idx: number, correct: number) {
    this.patch(idx, { correct });
  }

  setTime(idx: number, timeLimitSec: number) {
    this.patch(idx, { timeLimitSec });
  }

  // --- A picture (picture, zoom) ---

  imageUrl = (name: string) => this.quiz.imageUrl(name);

  // One of my own: shrunk here first, so it's quick to send.
  async pickFile(idx: number, event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.uploadingFor() !== null) return;
    this.uploadingFor.set(idx);
    try {
      const blob = await shrinkImage(file);
      this.quiz.uploadImage(blob).subscribe(this.pictureFor(idx));
    } catch {
      this.uploadingFor.set(null);
      this.notifications.addError('Ezt a képet nem sikerült beolvasni.');
    }
  }

  // A photo of a tour's album: the server makes the quiz a copy of it.
  fromTour(photo: PickedTourPhoto) {
    const idx = this.pickingFor();
    this.pickingFor.set(null);
    if (idx === null || this.uploadingFor() !== null) return;
    this.uploadingFor.set(idx);
    this.quiz.imageFromTour(photo.tourId, photo.filename).subscribe(this.pictureFor(idx));
  }

  private pictureFor(idx: number) {
    return {
      next: (image: string) => {
        this.uploadingFor.set(null);
        // A new picture: the zoom starts from its middle until told otherwise.
        this.patch(idx, { image, focus: null });
      },
      error: (err: unknown) => {
        this.uploadingFor.set(null);
        this.notifications.addError(errorMessage(err, 'Nem sikerült a képet elmenteni.'));
      },
    };
  }

  removeImage(idx: number) {
    this.patch(idx, { image: null, focus: null });
  }

  // Zoom: a tap on the picture says which detail the game starts on.
  setFocus(idx: number, event: MouseEvent) {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (!box.width || !box.height) return;
    const within = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
    this.patch(idx, {
      focus: {
        x: within((event.clientX - box.left) / box.width),
        y: within((event.clientY - box.top) / box.height),
      },
    });
  }

  // --- A song ---

  playlistName = (song: QuizSong) => PLAYLIST_NAMES[song.playlist] ?? song.playlist;
  trackUrl = (song: QuizSong) => this.quiz.trackUrl(song);

  // The song picked: the answers are filled in with it - at a place of its
  // own each time - and three others of its playlist. All of them can be
  // rewritten afterwards.
  songPicked(picked: PickedSong) {
    const idx = this.pickingSongFor();
    this.pickingSongFor.set(null);
    if (idx === null) return;
    const correct = Math.floor(Math.random() * (picked.others.length + 1));
    const answers = [...picked.others];
    answers.splice(correct, 0, picked.label);
    this.patch(idx, {
      song: picked.song,
      answers: [...answers, ...Array<string>(MAX_ANSWERS).fill('')].slice(0, MAX_ANSWERS),
      correct,
    });
  }

  // --- A place on the map ---

  setPlace(idx: number, place: QuizPlace) {
    this.patch(idx, { place });
  }

  // The author moved or zoomed the map: that part is what the players see.
  setBounds(idx: number, bounds: QuizBounds) {
    this.patch(idx, { bounds });
  }

  // The list of tours, to take a tour's place from.
  showTours(idx: number) {
    this.toursFor.set(this.toursFor() === idx ? null : idx);
    if (this.tours()) return;
    this.tourService.getTours().subscribe({
      next: (res) =>
        this.tours.set(
          [...res.data.tours].sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate)),
        ),
      error: () => this.tours.set([]),
    });
  }

  tourYear = (tour: Tour) => new Date(tour.startDate).getFullYear();

  // The tour's place is the answer - the map is moved over it if it
  // doesn't show it (the same size of area as before).
  placeFromTour(idx: number, tour: Tour) {
    this.toursFor.set(null);
    const [lng, lat] = tour.location?.coordinates ?? [];
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      this.notifications.addError('Ennek a tábornak nincs megadva a helye.');
      return;
    }
    const place = { lat, lng };
    const b = this.questions()[idx].bounds ?? DEFAULT_BOUNDS;
    const [h, w] = [(b.north - b.south) / 2, (b.east - b.west) / 2];
    const bounds = onMap(place, b)
      ? b
      : { south: lat - h, north: lat + h, west: lng - w, east: lng + w };
    this.patch(idx, { place, bounds });
  }

  // --- The questions ---

  select(idx: number) {
    this.selected.set(idx);
    this.toursFor.set(null);
  }

  addQuestion() {
    if (this.isFull()) return;
    this.questions.update((list) => [...list, blankQuestion()]);
    this.select(this.questions().length - 1);
    // Once it's on the page: ready to type.
    setTimeout(() =>
      this.host.nativeElement.querySelector<HTMLElement>('.question textarea')?.focus(),
    );
  }

  async removeQuestion(idx: number) {
    const q = this.questions()[idx];
    if (q.text.trim() || filled(q.answers)) {
      const ok = await this.confirm.ask({ message: `Törlöd a(z) ${idx + 1}. kérdést?` });
      if (!ok) return;
    }
    this.questions.update((list) => list.filter((_, i) => i !== idx));
    this.select(Math.min(this.selected(), this.questions().length - 1));
  }

  // One place up (-1) or down (+1).
  move(idx: number, by: number) {
    const to = idx + by;
    if (to < 0 || to >= this.questions().length) return;
    this.questions.update((list) => {
      const next = [...list];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });
    // The open question stays the open one, at its new place.
    if (this.selected() === idx) this.select(to);
  }

  // What's sent: of each question only what its kind has. The empty answer
  // slots are left out (the right answer's place counted among the ones
  // that stay).
  private toDraft(): QuizDraft {
    return {
      title: this.title().trim(),
      questions: this.questions().map((q) => {
        const base = { type: q.type, text: q.text.trim(), timeLimitSec: q.timeLimitSec };
        if (q.type === 'map') {
          return { ...base, answers: [], correct: 0, place: q.place, bounds: q.bounds };
        }
        if (q.type === 'truefalse') return { ...base, answers: [], correct: q.correct };
        const kept = q.answers.map((a, i) => ({ a: a.trim(), i })).filter((x) => x.a);
        return {
          ...base,
          answers: kept.map((x) => x.a),
          correct: kept.findIndex((x) => x.i === q.correct),
          image: hasPicture(q.type) ? (q.image ?? null) : null,
          ...(q.type === 'zoom' && { focus: q.focus ?? { x: 0.5, y: 0.5 } }),
          ...(q.type === 'song' && { song: q.song }),
        };
      }),
    };
  }

  save() {
    if (this.problem() || this.saving() || this.uploadingFor() !== null) return;
    this.saving.set(true);
    const draft = this.toDraft();
    const request = this.id ? this.quiz.updateQuiz(this.id, draft) : this.quiz.createQuiz(draft);
    request.subscribe({
      next: () => {
        this.notifications.addSuccess('A kvíz elmentve.');
        this.router.navigate(['/moka/kviz/szerkeszto']);
      },
      error: (err) => {
        this.saving.set(false);
        this.notifications.addError(errorMessage(err, 'Nem sikerült menteni a kvízt.'));
      },
    });
  }
}
