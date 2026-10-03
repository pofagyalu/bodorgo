import { fold, searchSongs } from './search';

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
