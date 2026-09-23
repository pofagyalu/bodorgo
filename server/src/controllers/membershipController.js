import User from '../models/userModel.js';

// GET /membership/users - requireAuth, restrictTo('admin', 'member'). Feeds
// the Klub "Felhasználók" page's Klubtagok/Egyéb felhasználók split (done
// client-side by role) - deliberately its own small, low-privilege field
// set rather than reusing userController.js's getAllUsers, which
// withholds role/lastLoginAt/createdAt from non-admins for its own
// (unrelated) callers and returns email/birthday/gender that this page
// has no business showing every member. familyId is included so the
// page can offer "pay for my family too" on the membership-dues payment
// (see paymentController.js's resolvePayableMembers) - it's an opaque
// grouping id, not personal data, and this page already shows every real
// member's name/role/status open-book.
export const getMembers = async (req, res) => {
  const users = await User.find()
    .select('name role lastLoginAt createdAt memberSince familyId')
    .sort('name')
    .lean();

  res.status(200).json({ status: 'success', data: { users } });
};
