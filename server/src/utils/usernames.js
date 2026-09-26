// Usernames: what the chat shows and what "@username" mentions refer to.
// Any letters (accented too: "Béla", "Zoltán"), numbers, ".", "_", "-",
// 3-40 of them - no spaces, since a space ends a mention.
export const USERNAME_RULE = /^[\p{L}\p{N}._-]{3,40}$/u;
export const USERNAME_RULE_MESSAGE =
  'A felhasználónév 3-40 karakter lehet: betű (ékezetes is), szám, pont, aláhúzás vagy kötőjel - szóköz nélkül.';

// The form two usernames are compared in: no upper/lower case, no accents
// - "Béla", "bela" and "BÉLA" are one and the same name, both for being
// unique and for "@bela" mentioning Béla.
export function usernameKey(username) {
  return String(username ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}
