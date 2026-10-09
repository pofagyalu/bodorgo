import AuditLog from '../models/auditLogModel.js';
import { getClubSettings } from '../utils/clubSettings.js';

const PAGE = 50;

// The changes of the club's settings have a list of their own (the club
// settings' history: fees, payment methods, the Barion wallets, the OIDC
// provider...) - shown here among the rest, as entries of the same shape.
function settingsEntries(history, before) {
  return history
    .filter((h) => h.at && (!before || h.at < before))
    .map((h, i) => ({
      _id: `settings-${h.at.getTime()}-${i}`,
      at: h.at,
      action: h.change?.startsWith('Barion (') ? 'barion-settings' : 'settings',
      actorName: h.byName,
      summary: h.change,
    }));
}

// GET /settings/audit-log (admin) - the Napló: who did what and when, of
// everything that moves money, rights or the club's settings. Newest first,
// fifty at a time: ?before=<the last one's at> asks for the ones before it.
export const getAuditLog = async (req, res) => {
  const asked = new Date(String(req.query.before ?? ''));
  const before = Number.isNaN(asked.getTime()) ? null : asked;

  const [operations, settings] = await Promise.all([
    AuditLog.find(before ? { at: { $lt: before } } : {})
      .sort({ at: -1, _id: -1 })
      .limit(PAGE + 1)
      .select('at action actorName targetName summary')
      .lean(),
    getClubSettings(),
  ]);
  // The newest fifty of both lists together are among the newest fifty-one
  // operations and the settings' changes.
  const entries = [...operations, ...settingsEntries(settings.history ?? [], before)].sort(
    (a, b) => b.at - a.at,
  );

  res.status(200).json({
    status: 'success',
    data: { entries: entries.slice(0, PAGE), hasMore: entries.length > PAGE },
  });
};
