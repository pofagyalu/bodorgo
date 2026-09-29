import mongoose from 'mongoose';
import Poll from '../models/pollModel.js';
import Post, { POST_POPULATE } from '../models/postModel.js';
import Tour from '../models/tourModel.js';
import Reservation from '../models/reservationModel.js';
import AppError from '../utils/appError.js';
import { emitToChatRoom } from '../chat/tourEvents.js';
import { generalChatRoom, tourChatRoom } from '../chat/chatRooms.js';
import logger from '../logger.js';
import { cleanMailHtml, isBlankMailHtml } from '../utils/mailHtml.js';
import { chatAudience, pushInBackground } from '../chat/chatNotifications.js';

const TOUR_SELECT = 'title slug order';

// Loads a poll the way buildPollView needs it: votes (with voter names,
// for open polls), the tour, and who started it.
function loadPoll(id) {
  return Poll.findById(id)
    .select('+votes')
    .populate({ path: 'tour', select: TOUR_SELECT })
    .populate({ path: 'votes.user', select: 'name username' })
    .populate({ path: 'createdBy', select: 'name username' });
}

const isAdmin = (user) => user.role === 'admin';
const refId = (ref) => String(ref?._id ?? ref);

// Shapes one poll for one specific viewer - the same poll looks different
// depending on who's asking and whether they voted:
// - open ('Nyílt'): everyone sees the counts and who voted for what, all
//   the time ("who's coming?");
// - secret ('Titkos'): only counts, and only once you voted or it closed.
// The raw votes list never leaves this function as-is.
// The tours I'm signed up for - whose open polls (and the general ones)
// wait for my vote.
async function myTourIds(user) {
  return new Set((await Reservation.distinct('tour', { 'attendees.user': user._id })).map(String));
}

// "Rád vár": open, I haven't voted, and it's mine to vote on - a poll of a
// tour I'm on, or a general one. The same rule as the Voks badge's count
// (getPendingCount).
function awaitsMyVote(poll, user, tourIds) {
  if (poll.closesAt.getTime() <= Date.now()) return false;
  if (poll.votes.some((v) => refId(v.user) === refId(user))) return false;
  return !poll.tour || tourIds.has(refId(poll.tour));
}

// buildPollView with "Rád vár" worked out - for one poll by its id.
async function pollViewFor(pollId, user) {
  return buildPollView(await loadPoll(pollId), user, await myTourIds(user));
}

function buildPollView(poll, user, tourIds = new Set()) {
  const userId = refId(user);
  const isClosed = poll.closesAt.getTime() <= Date.now();
  const myVote = poll.votes.find((v) => refId(v.user) === userId);
  const hasVoted = !!myVote;
  const isOpen = poll.visibility === 'open';
  const canSeeResults = isOpen || hasVoted || isClosed;

  const countFor = (optionId) =>
    poll.votes.filter((v) => String(v.option) === String(optionId)).length;
  const minimum = poll.minimum?.option
    ? {
        optionId: poll.minimum.option,
        count: poll.minimum.count,
        current: countFor(poll.minimum.option),
        reached: countFor(poll.minimum.option) >= poll.minimum.count,
      }
    : null;

  const base = {
    _id: poll._id,
    tour: poll.tour,
    question: poll.question,
    details: poll.details ?? '',
    options: poll.options.map((o) => ({ _id: o._id, text: o.text })),
    closesAt: poll.closesAt,
    isClosed,
    hasVoted,
    myOptionId: myVote ? myVote.option : null,
    visibility: poll.visibility,
    minimum,
    awaitsMyVote: awaitsMyVote(poll, user, tourIds),
    post: poll.post ?? null,
    createdBy: poll.createdBy?._id
      ? { _id: poll.createdBy._id, name: poll.createdBy.username || poll.createdBy.name }
      : null,
    // The one who started it, or an admin, may close or delete it.
    canManage: isAdmin(user) || refId(poll.createdBy) === userId,
    createdAt: poll.createdAt,
  };

  if (!canSeeResults) {
    return { ...base, totalVotes: null, results: null };
  }

  const totalVotes = poll.votes.length;
  const results = poll.options.map((o) => {
    const count = countFor(o._id);
    return {
      _id: o._id,
      text: o.text,
      count,
      // One decimal place - Math.round(x * 1000) / 10, not a plain
      // toFixed(1), so a whole-number percentage doesn't grow a
      // pointless ".0" (see the client's own display of this value).
      percentage: totalVotes > 0 ? Math.round((count / totalVotes) * 1000) / 10 : 0,
      // Open polls only: who picked this one.
      ...(isOpen
        ? {
            voters: poll.votes
              .filter((v) => String(v.option) === String(o._id))
              .map((v) => ({ _id: refId(v.user), name: v.user?.username || v.user?.name || '?' })),
          }
        : {}),
    };
  });

  return { ...base, totalVotes, results };
}

function cleanOptionTexts(options) {
  if (!Array.isArray(options)) return null;
  return options.map((o) => (typeof o === 'string' ? o.trim() : '')).filter(Boolean);
}

// The parts a new poll is built from - shared by the admin's
// Voks form and a chat-started poll. minimumCount applies to the
// first answer ("Igen": at least N people).

// "Részletek": optional, a few formatted sentences under the question -
// only the mailing editor's formatting survives (utils/mailHtml.js).
const DETAILS_MAX = 10000;
function cleanDetails(html) {
  if (isBlankMailHtml(html)) return '';
  const details = cleanMailHtml(html);
  if (details.length > DETAILS_MAX) throw new AppError('A részletek túl hosszúak.', 400);
  return details;
}

function pollFields(body) {
  const options = cleanOptionTexts(body.options);
  if (!options || options.length < 2) {
    throw new AppError('Legalább 2 válaszlehetőség szükséges.', 400);
  }
  const question = String(body.question ?? '').trim();
  if (!question) throw new AppError('A szavazásnak kell legyen kérdése.', 400);
  const closesAt = new Date(body.closesAt);
  if (Number.isNaN(closesAt.getTime())) throw new AppError('Adj meg egy záró időpontot.', 400);
  const minimumCount = body.minimumCount ? Number(body.minimumCount) : null;
  if (
    minimumCount !== null &&
    (!Number.isInteger(minimumCount) || minimumCount < 1 || minimumCount > 500)
  ) {
    throw new AppError('A minimum létszám 1 és 500 közötti egész szám lehet.', 400);
  }
  return {
    question,
    details: cleanDetails(body.details),
    options: options.map((text) => ({ text })),
    closesAt,
    visibility: body.visibility === 'open' ? 'open' : 'secret',
    minimumCount,
  };
}

function applyMinimum(poll, minimumCount) {
  poll.minimum = minimumCount ? { option: poll.options[0]._id, count: minimumCount } : undefined;
}

// Everyone looking at the chat the poll was posted in re-fetches it (each
// gets their own view of it - see buildPollView). Fire-and-forget.
function announcePollChanged(poll) {
  Post.findById(poll.post)
    .select('chatRoomId')
    .then((post) => {
      if (!post) return;
      emitToChatRoom(post.chatRoomId, 'poll-updated', {
        pollId: String(poll._id),
        tourId: refId(poll.tour),
      });
    })
    .catch((err) => logger.error(`poll ${poll._id} update announce failed: ${err.message}`));
}

// GET /polls - requireAuth (any logged-in role, see pollRoutes.js). Every
// poll for every tour, newest first - a club-wide list is simple and
// transparent, same spirit as the Klub Felhasználók list.
export const getAllPolls = async (req, res) => {
  const polls = await Poll.find()
    .select('+votes')
    .sort('-createdAt')
    .populate({ path: 'tour', select: TOUR_SELECT })
    .populate({ path: 'votes.user', select: 'name username' })
    .populate({ path: 'createdBy', select: 'name username' });

  const tourIds = await myTourIds(req.user);
  res.status(200).json({
    status: 'success',
    data: { polls: polls.map((p) => buildPollView(p, req.user, tourIds)) },
  });
};

// GET /polls/pending - how many open polls on my tours are still waiting
// for my vote (the Voks menu's badge).
export const getPendingCount = async (req, res) => {
  // My tours' polls, and the general ones (everyone's) - the same rule as
  // awaitsMyVote above.
  const tourIds = await Reservation.distinct('tour', { 'attendees.user': req.user._id });
  const count = await Poll.countDocuments({
    $or: [{ tour: { $in: tourIds } }, { tour: null }],
    closesAt: { $gt: new Date() },
    'votes.user': { $ne: req.user._id },
  });
  res.status(200).json({ status: 'success', data: { count } });
};

// GET /polls/:id - requireAuth.
export const getPoll = async (req, res) => {
  const poll = await loadPoll(req.params.id);
  if (!poll) throw new AppError('Nincs ilyen szavazás.', 404);
  res.status(200).json({
    status: 'success',
    data: { poll: buildPollView(poll, req.user, await myTourIds(req.user)) },
  });
};

// POST /polls - admin-only (see pollRoutes.js): the Voks page's form.
export const createPoll = async (req, res) => {
  const fields = pollFields(req.body);
  // No tour chosen: a general poll.
  const poll = new Poll({ ...fields, tour: req.body.tour || null, createdBy: req.user._id });
  applyMinimum(poll, fields.minimumCount);
  await poll.save();
  res
    .status(201)
    .json({ status: 'success', data: { poll: await pollViewFor(poll._id, req.user) } });
};

// A poll started from a chat - a tour's (tour set) or the general one
// (tour null). It's a normal poll (it shows on Voks too), plus a chat
// message carrying its live card; the room's audience gets a notification
// - a poll asks for action, so it always buzzes.
async function startChatPoll(req, res, tour) {
  const fields = pollFields(req.body);
  if (fields.closesAt.getTime() <= Date.now())
    throw new AppError('A záró időpont a jövőben legyen.', 400);

  const poll = new Poll({ ...fields, tour: tour?._id ?? null, createdBy: req.user._id });
  applyMinimum(poll, fields.minimumCount);
  const room = tour ? await tourChatRoom(tour._id) : await generalChatRoom();
  const post = await Post.create({
    chatRoomId: room._id,
    creator: req.user._id,
    text: fields.question,
    poll: poll._id,
  });
  poll.post = post._id;
  await poll.save();

  await post.populate(POST_POPULATE);
  emitToChatRoom(room._id, 'new-post', post);

  const author = req.user.username || req.user.name;
  const audience = await chatAudience(tour, [req.user._id]);
  pushInBackground(audience.ids, {
    title: `${audience.label} – szavazás`,
    body: `${author}: ${fields.question} – szavazz!`,
    tag: `poll-${poll._id}`,
    url: audience.url,
    renotify: true,
  });

  res
    .status(201)
    .json({ status: 'success', data: { poll: await pollViewFor(poll._id, req.user) } });
}

// POST /tours/:tourId/polls - from the tour's chat, by anyone signed up
// for the tour (or an admin).
export const createTourPoll = async (req, res) => {
  const { tourId } = req.params;
  if (!mongoose.isValidObjectId(tourId)) throw new AppError('Nincs ilyen tábor.', 404);
  const tour = await Tour.findById(tourId).select('title order');
  if (!tour) throw new AppError('Nincs ilyen tábor.', 404);
  if (
    !isAdmin(req.user) &&
    !(await Reservation.exists({ tour: tourId, 'attendees.user': req.user._id }))
  ) {
    throw new AppError('Csak a tábor résztvevői indíthatnak szavazást.', 403);
  }
  await startChatPoll(req, res, tour);
};

// POST /chat-rooms/general/polls - from the general room, by anyone
// logged in; everyone is told.
export const createGeneralPoll = async (req, res) => {
  await startChatPoll(req, res, null);
};

// PATCH /polls/:id - admin-only. Once a poll has at least one real vote,
// the question/options are locked (changing either would silently orphan
// those votes - a stored vote only ever references an option's _id, so a
// removed/retyped option would leave it pointing at nothing meaningful);
// the tour and closesAt can still be adjusted freely regardless.
export const updatePoll = async (req, res) => {
  const poll = await Poll.findById(req.params.id).select('+votes');
  if (!poll) {
    throw new AppError('Nincs ilyen szavazás.', 404);
  }

  const { tour, question, closesAt, visibility } = req.body;
  const hasVotes = poll.votes.length > 0;

  // Compares actual values, not just "was this key present in the body" -
  // the admin edit form always resends question/options as part of its
  // payload regardless of what the admin actually changed, so a
  // presence-only check would reject every single edit once a poll has any
  // votes at all, including just extending the deadline. Re-submitting the
  // same question/options unchanged is fine even with votes already cast;
  // only a genuine change to either is blocked.
  const newOptions =
    req.body.options !== undefined ? cleanOptionTexts(req.body.options) : undefined;
  const questionChanged = question !== undefined && question.trim() !== poll.question;
  const optionsChanged =
    newOptions !== undefined &&
    (newOptions.length !== poll.options.length ||
      newOptions.some((text, i) => text !== poll.options[i]?.text));

  if (hasVotes && (questionChanged || optionsChanged)) {
    throw new AppError(
      'Ezen a szavazáson már van leadott szavazat, ezért a kérdés és a válaszlehetőségek többé nem módosíthatók - csak a tábor és a záró időpont.',
      400,
    );
  }

  if (tour !== undefined) poll.tour = tour || null;
  // The details may be fixed any time (a link, a typo) - votes or not.
  if (req.body.details !== undefined) poll.details = cleanDetails(req.body.details);
  if (closesAt !== undefined) poll.closesAt = closesAt;
  // Secret → open would reveal how people voted in secret - only before
  // anyone voted.
  if (visibility === 'open' || visibility === 'secret') {
    if (hasVotes && visibility !== poll.visibility) {
      throw new AppError('Szavazatok után már nem lehet nyílt és titkos között váltani.', 400);
    }
    poll.visibility = visibility;
  }

  if (questionChanged) {
    poll.question = question.trim();
  }
  if (optionsChanged) {
    if (newOptions.length < 2) {
      throw new AppError('Legalább 2 válaszlehetőség szükséges.', 400);
    }
    poll.options = newOptions.map((text) => ({ text }));
    if (poll.minimum?.option) poll.minimum.option = poll.options[0]._id;
  }
  if (req.body.minimumCount !== undefined) {
    const m = req.body.minimumCount ? Number(req.body.minimumCount) : null;
    if (m !== null && (!Number.isInteger(m) || m < 1 || m > 500)) {
      throw new AppError('A minimum létszám 1 és 500 közötti egész szám lehet.', 400);
    }
    applyMinimum(poll, m);
  }

  await poll.save();
  announcePollChanged(poll);
  res
    .status(200)
    .json({ status: 'success', data: { poll: await pollViewFor(poll._id, req.user) } });
};

// POST /polls/:id/close - whoever started it, or an admin: closes it now.
export const closePoll = async (req, res) => {
  const poll = await Poll.findById(req.params.id);
  if (!poll) throw new AppError('Nincs ilyen szavazás.', 404);
  if (!isAdmin(req.user) && refId(poll.createdBy) !== String(req.user._id)) {
    throw new AppError('Csak az indítója vagy egy admin zárhatja le.', 403);
  }
  if (poll.closesAt.getTime() > Date.now()) {
    poll.closesAt = new Date();
    await poll.save();
    announcePollChanged(poll);
  }
  res
    .status(200)
    .json({ status: 'success', data: { poll: await pollViewFor(poll._id, req.user) } });
};

// DELETE /polls/:id - whoever started it, or an admin. Its chat message
// stays as a "Hozzászólás törölve" placeholder, like a deleted message.
export const deletePoll = async (req, res) => {
  const poll = await Poll.findById(req.params.id);
  if (!poll) {
    throw new AppError('Nincs ilyen szavazás.', 404);
  }
  if (!isAdmin(req.user) && refId(poll.createdBy) !== String(req.user._id)) {
    throw new AppError('Csak az indítója vagy egy admin törölheti.', 403);
  }
  await poll.deleteOne();
  if (poll.post) {
    const post = await Post.findByIdAndUpdate(
      poll.post,
      { text: '', poll: null, deletedAt: new Date() },
      { returnDocument: 'after' },
    ).populate(POST_POPULATE);
    if (post) emitToChatRoom(post.chatRoomId, 'post-updated', post);
  }
  res.status(204).json({ status: 'success', data: null });
};

// POST /polls/:id/vote - requireAuth, any role, while it's open. Voting
// again changes the vote. When a minimum ("at least 5 yes") is first
// reached, those who picked that answer are told.
export const voteOnPoll = async (req, res) => {
  const poll = await Poll.findById(req.params.id)
    .select('+votes')
    .populate({ path: 'tour', select: TOUR_SELECT });
  if (!poll) {
    throw new AppError('Nincs ilyen szavazás.', 404);
  }

  if (poll.closesAt.getTime() <= Date.now()) {
    throw new AppError('Ez a szavazás már lezárult.', 400);
  }

  const option = mongoose.isValidObjectId(req.body.optionId)
    ? poll.options.id(req.body.optionId)
    : null;
  if (!option) {
    throw new AppError('Érvénytelen válasz.', 400);
  }

  const mine = poll.votes.find((v) => String(v.user) === String(req.user._id));
  if (mine) {
    mine.option = option._id;
    mine.votedAt = new Date();
  } else {
    poll.votes.push({ user: req.user._id, option: option._id });
  }

  const minimumOption = poll.minimum?.option ? String(poll.minimum.option) : null;
  const onMinimum = minimumOption
    ? poll.votes.filter((v) => String(v.option) === minimumOption)
    : [];
  const justReached =
    !!minimumOption && !poll.minimumReachedAt && onMinimum.length >= poll.minimum.count;
  if (justReached) poll.minimumReachedAt = new Date();
  await poll.save();

  announcePollChanged(poll);
  if (justReached) {
    const answer = poll.options.id(minimumOption)?.text ?? '';
    const where = await chatAudience(poll.tour ?? null, []);
    pushInBackground(
      onMinimum.map((v) => String(v.user)),
      {
        title: `Összejött! – ${where.label}`,
        body: `${poll.question} – megvan a ${poll.minimum.count} fő („${answer}”).`,
        tag: `poll-${poll._id}`,
        url: poll.post ? where.url : '/szavazasok',
        renotify: true,
      },
    );
  }

  res
    .status(200)
    .json({ status: 'success', data: { poll: await pollViewFor(poll._id, req.user) } });
};
