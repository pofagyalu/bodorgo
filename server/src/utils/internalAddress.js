// An address that names no device of its own: the machine itself
// (localhost - a developer's login) or the Docker network, which is what
// Authentik saw for everyone before its trusted-proxy setting was fixed
// (2026-10-04). Profilom → Bejelentkezések neither lists nor counts these;
// logging out the other devices still ends them. A home network (192.168.x)
// or the VPN (10.x) is a real device and counts.
export function isInternalAddress(ip) {
  const a = String(ip ?? '').replace(/^::ffff:/, '');
  if (a === '::1' || /^127\./.test(a)) return true;
  const m = /^172\.(\d+)\./.exec(a);
  return !!m && Number(m[1]) >= 16 && Number(m[1]) <= 31;
}
