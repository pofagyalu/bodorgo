// Usernames: any letters (accented too), numbers, ".", "_", "-", 3-40 of
// them - same rule as the server (server/src/utils/usernames.js).

// How two usernames are compared - no upper/lower case, no accents:
// "Béla", "bela" and "BÉLA" are the same name ("@bela" mentions Béla).
export function usernameKey(username: string): string {
  return username.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
