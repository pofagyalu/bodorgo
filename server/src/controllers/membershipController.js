import User from '../models/userModel.js';

// GET /membership/users - requireAuth, restrictTo('admin', 'member'). Feeds
// the Klub "Felhasználók" page's Klubtagok/Egyéb felhasználók split (done
// client-side by role) - deliberately its own small, low-privilege field
// set (name/role/lastLoginAt/createdAt only) rather than reusing
// userController.js's getAllUsers, which withholds role/lastLoginAt/
// createdAt from non-admins for its own (unrelated) callers and returns
// email/birthday/gender that this page has no business showing every
// member.
export const getMembers = async (req, res) => {
  const users = await User.find()
    .select('name role lastLoginAt createdAt memberSince')
    .sort('name')
    .lean();

  res.status(200).json({ status: 'success', data: { users } });
};
