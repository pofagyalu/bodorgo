import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { QUIZ_IMAGES_DIR } from '../../utils/dataDirs.js';
import { loadSharp } from '../../photos/imageFiles.js';
import { Quiz, QuizGame } from '../../models/quizModels.js';

// The picture of a quiz question (the one slowly uncovered). Whether it
// was uploaded or picked from a tour's album, the quiz gets a copy of its
// own: a WebP of at most 1600 px (EXIF - the GPS location included -
// dropped: sharp writes none unless asked), named by an id of its own. So
// a game played later still has its picture, whatever happens to the album.

const MAX_SIDE = 1600;
const NAME = /^[0-9a-f]{24}$/;

export const isQuizImageName = (name) => typeof name === 'string' && NAME.test(name);
export const quizImagePath = (name) => path.join(QUIZ_IMAGES_DIR, `${name}.webp`);
export const quizImageExists = (name) =>
  isQuizImageName(name) && fs.existsSync(quizImagePath(name));

// The picture from its bytes, or from a file on disk - throws if it isn't
// a real image. Returns the name the question keeps.
export async function saveQuizImage(source) {
  const sharp = await loadSharp();
  const data = await sharp(source)
    .rotate() // upright by its EXIF orientation, before that's dropped
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  const name = String(new mongoose.Types.ObjectId());
  fs.mkdirSync(QUIZ_IMAGES_DIR, { recursive: true });
  fs.writeFileSync(quizImagePath(name), data);
  return name;
}

// Pictures a quiz no longer has: the files go, unless another quiz or a
// game (played, or still on) shows them.
export async function deleteUnusedQuizImages(names) {
  for (const name of new Set(names.filter(isQuizImageName))) {
    const used =
      (await Quiz.exists({ 'questions.image': name })) ||
      (await QuizGame.exists({ 'questions.image': name }));
    if (!used) fs.rmSync(quizImagePath(name), { force: true });
  }
}
