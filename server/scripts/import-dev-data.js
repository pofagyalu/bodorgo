import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import Tour from '../src/models/tourModel.js';
import config from '../src/config.js';

// CWD-relative (run this from server/, same as every other script here) -
// the underlying data file stays in dev-data/data/ even though this script
// itself moved to scripts/.
const rootDir = path.resolve();

const DB = config.db.uri;

mongoose.connect(DB).then(() => console.log('Adatbázis kapcsolat sikeres!'));

const tours = JSON.parse(
  fs.readFileSync(path.join(rootDir, '/dev-data/data/tours-simple.json'), 'utf-8'),
);

const importData = async () => {
  try {
    await Tour.create(tours);
    console.log('Adatok sikeresn betöltve!');
  } catch (err) {
    console.log(err);
  }
  process.exit();
};

//  DELETE ALL DATA FROM COLLECTION
const deleteData = async () => {
  try {
    await Tour.deleteMany();
    console.log('Adatok sikeresen törölve!');
  } catch (err) {
    console.log(err);
  }
  process.exit();
};

if (process.argv[2] === '--import') {
  importData();
}

if (process.argv[2] === '--delete') {
  deleteData();
}
