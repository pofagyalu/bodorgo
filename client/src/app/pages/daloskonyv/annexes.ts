// What the songbook has besides its songs: the pages listed after them
// (and found by the same search) - the tuner, and the PDF's two annexes
// to look at while playing. Their addresses: <songbook>/melleklet/<id>.
export interface Annex {
  id: 'hangolo' | 'kvintkor' | 'akkordtablazat';
  title: string;
  // What it is, under its title in the list.
  about: string;
  icon: string;
  // More words the search finds it by.
  keywords: string;
}

export const ANNEXES: Annex[] = [
  {
    id: 'hangolo',
    title: 'Hangoló',
    about: 'gitárhoz és ukuleléhez, mikrofonnal',
    icon: 'graphic_eq',
    keywords: 'hangolás tuner',
  },
  {
    id: 'kvintkor',
    title: 'Kvintkör',
    about: 'a hangnemek és rokonaik',
    icon: 'donut_large',
    keywords: 'ötösök köre kvint hangnem előjegyzés',
  },
  {
    id: 'akkordtablazat',
    title: 'Akkordtáblázat',
    about: 'melyik hangnemben milyen akkordok',
    icon: 'table_chart',
    keywords: 'akkordmenet hangnem fokok dúr moll',
  },
];
