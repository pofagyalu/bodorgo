import User from '../models/userModel.js';
import { toursAttendedByUser } from '../utils/toursAttended.js';
import { computeAge } from './userController.js';

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
//
// Age is sensitive: only an admin gets it (since 2026-10-01) - for anyone
// else the field isn't sent at all, not just left off the screen.
export const getMembers = async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const users = await User.find()
    .select(
      'name email role lastLoginAt createdAt memberSince familyId retired birthday photoUpdatedAt',
    )
    .sort('name')
    .lean();

  // Tours already started only (see utils/toursAttended.js).
  const toursAttendedById = await toursAttendedByUser();

  const usersWithAttendance = users.map((user) => {
    // The raw birthday never goes out on this members-visible list - just
    // the computed age, and that to admins only. The email does (shown under each name, and no
    // email = no account of their own, see members.ts's userStatus) - the
    // whole page is members/admins-only, same as getAllUsers, which
    // already shows members everyone's email.
    const { birthday, ...rest } = user;

    return {
      ...rest,
      ...(isAdmin ? { age: computeAge(birthday) } : {}),
      toursAttended: toursAttendedById.get(String(user._id)) ?? 0,
    };
  });

  res.status(200).json({
    status: 'success',
    data: { users: usersWithAttendance },
  });
};
