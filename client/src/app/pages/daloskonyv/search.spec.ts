import { LETTERS, fold, foundIn, hungarianLetter, letterOf, searchSongs } from './search';

const SONGS = [
  { _id: 'a', title: 'Adj helyet magad mellett', artist: 'Bikini' },
  { _id: 'e', title: 'Eső után', artist: 'Bódorgók' },
  { _id: 't', title: 'Tavaszi szél', artist: 'Népdal' },
];
const LYRICS = new Map([
  ['a', ['Adj helyet magad mellett,', 'Az ablakhoz én is odaférjek!']],
  ['e', ['Elindultunk reggel az esőben', 'Bódorgunk a dombon']],
  ['t', ['Tavaszi szél vizet áraszt, virágom, virágom', 'Minden madár társat választ']],
]);
// lyrics null: the words have not arrived yet.
const found = (search: string, lyrics: Map<string, string[]> | null = LYRICS) =>
  searchSongs(SONGS, search, lyrics ?? undefined).map((f) => [
    f.song._id,
    f.line && `${f.line.before}‹${f.line.match}›${f.line.after}`,
  ]);

describe('fold', () => {
  it('takes the accents and the capitals off, letter for letter', () => {
    expect(fold('Eső UTÁN – Őrült Üröm')).toBe('eso utan – orult urom');
    expect(fold('Árvíztűrő tükörfúrógép')).toHaveLength('Árvíztűrő tükörfúrógép'.length);
  });
});

describe('searchSongs', () => {
  it('gives every song for an empty search', () => {
    expect(found('')).toEqual([
      ['a', null],
      ['e', null],
      ['t', null],
    ]);
    expect(found('   ')).toHaveLength(3);
  });

  it('finds by title and artist, whatever the accents and capitals', () => {
    expect(found('ESO')).toEqual([['e', null]]);
    expect(found('bikini')).toEqual([['a', null]]);
    expect(found('nepdal')).toEqual([['t', null]]);
  });

  it('finds in the words too, and shows the line', () => {
    expect(found('odaferjek')).toEqual([['a', 'Az ablakhoz én is ‹odaférjek›!']]);
    expect(found('Madár')).toEqual([['t', 'Minden ‹madár› társat választ']]);
    // The first line that has it.
    expect(found('virag')).toEqual([['t', 'Tavaszi szél vizet áraszt, ‹virág›om, virágom']]);
  });

  it('puts the songs found by their name before the ones found by their words', () => {
    // "eső": Eső után by its title, nothing else by its words but...
    // "bodorg": Bódorgók is the artist of e - and in e's own words too:
    // found once, by the name.
    expect(found('bodorg')).toEqual([['e', null]]);
    // "sz": too short for the words - the titles only.
    expect(found('sz')).toEqual([['t', null]]);
    // "mellett" is in a's title; "ablak" only in its words.
    expect(found('mellett')).toEqual([['a', null]]);
    expect(found('reggel')).toEqual([['e', 'Elindultunk ‹reggel› az esőben']]);
    // By name first (e: "Eső"), then by words - none other has "eső".
    expect(found('eső')).toEqual([['e', null]]);
  });

  it('searches the names alone until the words have arrived', () => {
    expect(found('madár', null)).toEqual([]);
    expect(found('tavaszi', null)).toEqual([['t', null]]);
  });

  it('finds nothing where there is nothing', () => {
    expect(found('xyzzy')).toEqual([]);
  });
});

describe('letterOf', () => {
  it('finds a title under its first letter, accents aside', () => {
    expect(letterOf('Dal')).toBe('D');
    expect(letterOf('álom')).toBe('A');
    expect(letterOf('Ördög')).toBe('O');
    expect(letterOf('  Űr')).toBe('U');
  });

  it('puts numbers and signs under #', () => {
    expect(letterOf('67-es')).toBe('#');
    expect(letterOf('…és')).toBe('#');
    expect(letterOf('')).toBe('#');
  });

  it('has # first, then the alphabet', () => {
    expect(LETTERS[0]).toBe('#');
    expect(LETTERS.slice(1).join('')).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  });
});

describe('foundIn', () => {
  it('cuts a name around what was searched for, accents and capitals aside', () => {
    expect(foundIn('Tavaszi szél', 'szel')).toEqual({
      before: 'Tavaszi ',
      match: 'szél',
      after: '',
    });
    expect(foundIn('Zöld erdőben', ' ZOLD ')).toEqual({
      before: '',
      match: 'Zöld',
      after: ' erdőben',
    });
  });

  it('gives null where it isn’t, and for an empty search', () => {
    expect(foundIn('Tavaszi szél', 'nyár')).toBeNull();
    expect(foundIn('Tavaszi szél', '  ')).toBeNull();
  });
});

describe('hungarianLetter', () => {
  it('gives the letter a title stands under', () => {
    expect(hungarianLetter('Alma')).toBe('A');
    expect(hungarianLetter('  bor')).toBe('B');
    expect(hungarianLetter('Zene')).toBe('Z');
  });

  it('keeps the letters written with more characters apart', () => {
    expect(hungarianLetter('Csak')).toBe('Cs');
    expect(hungarianLetter('gyere')).toBe('Gy');
    expect(hungarianLetter('SZÉL')).toBe('Sz');
    expect(hungarianLetter('Zsák')).toBe('Zs');
    expect(hungarianLetter('Dzsungel')).toBe('Dzs');
    expect(hungarianLetter('Dzéta')).toBe('Dz');
    // A plain C, S or Z is still its own.
    expect(hungarianLetter('Cica')).toBe('C');
    expect(hungarianLetter('Sál')).toBe('S');
  });

  it('puts a long vowel with its short one, Ö and Ü on their own', () => {
    expect(hungarianLetter('Álom')).toBe('A');
    expect(hungarianLetter('Éj')).toBe('E');
    expect(hungarianLetter('Óra')).toBe('O');
    expect(hungarianLetter('Öröm')).toBe('Ö');
    expect(hungarianLetter('Őrzöm')).toBe('Ö');
    expect(hungarianLetter('Út')).toBe('U');
    expect(hungarianLetter('Ünnep')).toBe('Ü');
    expect(hungarianLetter('Űr')).toBe('Ü');
  });

  it('gives nothing for a number or a sign', () => {
    expect(hungarianLetter('67-es')).toBe('');
    expect(hungarianLetter('…és')).toBe('');
    expect(hungarianLetter('')).toBe('');
  });
});
