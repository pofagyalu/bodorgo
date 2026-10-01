// What every darts game has in common, whatever its rules: a dart is
// thrown, the last one is taken back, an earlier turn is corrected. Each
// works on the stored turns and then replays the game by its own rules
// (`replay` - x01.js's or cricket.js's).
export const turnActions = (replay) => ({
  // One more dart, by whoever is next: onto the open turn, or as a new turn
  // (`meta` goes on a new turn - e.g. who entered it). Returns the game
  // replayed, or null if it's over.
  addThrow(playerCount, options, storedTurns, t, meta = {}) {
    const state = replay(playerCount, options, storedTurns);
    if (state.over) return null;
    const turns = [...state.turns];
    if (state.open) {
      const last = turns.pop();
      turns.push({ ...last, throws: [...last.throws, t] });
    } else {
      turns.push({ ...meta, playerIdx: state.next.playerIdx, throws: [t] });
    }
    return replay(playerCount, options, turns);
  },

  // Takes the last dart back - a bust or a finish too, across turns.
  undoThrow(playerCount, options, storedTurns) {
    const turns = [...replay(playerCount, options, storedTurns).turns];
    const last = turns.pop();
    if (last && last.throws.length > 1) turns.push({ ...last, throws: last.throws.slice(0, -1) });
    return replay(playerCount, options, turns);
  },

  // An earlier turn corrected: its darts replaced, everything after it
  // replayed (`meta` goes on the corrected turn - e.g. who corrected it).
  editTurn(playerCount, options, storedTurns, turnIdx, throws, meta = {}) {
    const turns = storedTurns.map((turn, i) =>
      i === turnIdx ? { ...turn, ...meta, throws } : turn,
    );
    return replay(playerCount, options, turns);
  },
});
