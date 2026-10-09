import mongoose from 'mongoose';

// Napló: who did what and when, of the operations that move money or
// rights (utils/auditLog.js writes it). Names are kept as text next to the
// ids, so an entry still reads right after a rename or an archived user.
// Entries are only ever added - nothing in the app edits or deletes one.
// The changes of the club's settings (the Barion wallets among them) are
// not here: they have their own list on the club settings (history), and
// the Napló shows the two together (controllers/auditLogController.js).
export const AUDIT_ACTIONS = [
  'role-change',
  'cash-advance',
  'cash-membership',
  'cash-undo',
  'withdrawal',
];

const auditLogSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now, index: true },
  action: { type: String, enum: AUDIT_ACTIONS, required: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  actorName: String,
  // Whom it was done to, where it is one person (a role, a member's dues).
  target: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  targetName: String,
  // One line, as the admins read it.
  summary: { type: String, required: true },
  // The values behind it (old and new, amounts, ids).
  details: mongoose.Schema.Types.Mixed,
});

export default mongoose.model('AuditLog', auditLogSchema);
