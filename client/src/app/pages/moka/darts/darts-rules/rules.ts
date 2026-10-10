import { DartsType } from '../../../../services/darts';

// Each game's rules in short - on the Szabályok page (darts-rules), and in
// the new game's "Szabályok" box (darts-setup) for the game chosen there.
export const DARTS_RULES: Record<DartsType, { title: string; lines: string[] }> = {
  x01: {
    title: '301 (201, 101)',
    lines: [
      'Mindenki 301 pontról indul, és a dobott pontokat levonjuk – az nyer, aki először ér pontosan nullára.',
      'Egy kör három nyíl. A dupla gyűrű kétszer, a tripla háromszor annyit ér; a tábla közepe 25, a legbelső kör (Bull) 50.',
      'Besokallás: ha többet dobsz, mint amennyi hátravan, a kör nem számít, és onnan folytatod, ahol a kör elején álltál.',
      'Sima kiszállónál bármelyik mezővel nullázhatsz. Dupla kiszállónál az utolsó nyílnak duplának (vagy Bullnak) kell lennie, és 1 ponton sem állhatsz meg.',
      'A győztes után a többiek tovább játszanak a 2. és 3. helyért. Aki ugyanabban a körben száll ki, azok közül az a jobb, akinek kevesebb nyíl kellett.',
    ],
  },
  cricket: {
    title: 'Cricket',
    lines: [
      'Csak a 20, 19, 18, 17, 16, 15 és a tábla közepe (Bull) számít.',
      'Minden számot háromszor kell eltalálni, hogy „lezárd”. A dupla két találat, a tripla három; a Bull külső köre egy, a belső kettő.',
      'Ha egy számot már lezártál, a további találatok pontot érnek (a szám értékét) – de csak addig, amíg van olyan játékos, aki még nem zárta le.',
      'Az nyer, aki mindent lezárt, és neki van a legtöbb pontja (vagy ugyanannyi, mint a legjobbnak).',
      'A győztes után a többiek tovább játszanak a 2. és 3. helyért.',
    ],
  },
  highscore: {
    title: 'High Score',
    lines: [
      'A legegyszerűbb játék: mindenki nulláról indul, és a dobott pontokat összeadjuk.',
      'Egy kör három nyíl. A dupla gyűrű kétszer, a tripla háromszor annyit ér; a tábla közepe 25, a legbelső kör (Bull) 50.',
      'Nincs besokallás és nincs kiszálló – minden nyíl számít.',
      'A beállított számú kör után az nyer, akinek a legtöbb pontja van.',
      'Pontegyenlőségnél az a jobb, akinek jobb volt a legjobb köre.',
    ],
  },
};

// The games in the order they're offered.
export const DARTS_RULES_ORDER: DartsType[] = ['x01', 'cricket', 'highscore'];
