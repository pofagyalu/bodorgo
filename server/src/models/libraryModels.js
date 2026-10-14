import mongoose from 'mongoose';

const { Schema } = mongoose;

// Média → Könyvtár: the owner's PDF books. The files are in the library
// folder, one subfolder per shelf (utils/libraryIndex.js); what is stored
// here is what was read out of each, so it can be searched.

// One book: a PDF on a shelf.
const libraryBookSchema = new Schema(
  {
    // The shelf's folder and the file in it - together they find the PDF.
    shelf: { type: String, required: true },
    filename: { type: String, required: true },
    // From the file's name until the owner gives it another.
    title: { type: String, required: true, trim: true, maxlength: 200 },
    // Written by the owner - a PDF's own name seldom says either.
    subtitle: { type: String, trim: true, maxlength: 200, default: '' },
    author: { type: String, trim: true, maxlength: 200, default: '' },
    pages: { type: Number, default: 0 },
    // The number printed on a page minus the PDF's own page number - a
    // book's first pages (cover, contents) usually have none.
    pageOffset: { type: Number, default: 0 },
    // False for a scan without OCR: nothing in it can be searched.
    hasText: { type: Boolean, default: false },
    // The table of contents: the PDF's bookmarks when it has them, else
    // what the owner wrote. page: the PDF's page number.
    toc: {
      type: [
        {
          _id: false,
          title: { type: String, required: true, trim: true, maxlength: 200 },
          page: { type: Number, required: true, min: 1 },
          level: { type: Number, default: 0, min: 0, max: 3 },
        },
      ],
      default: [],
    },
    // Which of the book's play-along tracks (utils/libraryAudio.js) belong
    // to which page - a track may be on several pages, a page may have
    // several. file: its name in the book's audio folder; page: the PDF's.
    audioLinks: {
      type: [
        {
          _id: false,
          file: { type: String, required: true, maxlength: 300 },
          page: { type: Number, required: true, min: 1 },
        },
      ],
      default: [],
    },
    // Set once the owner changed the contents - a new scan keeps it then.
    tocEdited: { type: Boolean, default: false },
    // The file as it was when read - a changed one is read again.
    size: { type: Number, default: 0 },
    modifiedAt: { type: Number, default: 0 },
  },
  { timestamps: true },
);

libraryBookSchema.index({ shelf: 1, filename: 1 }, { unique: true });

// One page's text. text: as read, white space collapsed; folded: the same
// without accents, in lower case - what the search looks in.
const libraryPageSchema = new Schema({
  book: { type: Schema.Types.ObjectId, ref: 'LibraryBook', required: true },
  page: { type: Number, required: true },
  text: { type: String, default: '' },
  folded: { type: String, default: '' },
});

libraryPageSchema.index({ book: 1, page: 1 }, { unique: true });

export const LibraryBook = mongoose.model('LibraryBook', libraryBookSchema);
export const LibraryPage = mongoose.model('LibraryPage', libraryPageSchema);
