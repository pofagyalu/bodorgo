import Poll from '../models/pollModel.js';
import AppError from '../utils/appError.js';

const TOUR_SELECT = 'title slug order';

// Shapes one poll for one specific viewer - the whole point of this
// function existing (rather than just returning the Mongoose doc) is that
// the same poll looks different depending on who's asking and whether they
// voted yet: the raw per-user votes list (loaded via +votes) never leaves
// this function as-is, only the aggregate counts below do, and only once
// the viewer has earned seeing them.
function buildPollView(poll, userId) {
  const isClosed = poll.closesAt.getTime() <= Date.now();
  const myVote = poll.votes.find((v) => String(v.user) === String(userId));
  const hasVoted = !!myVote;
  // The one rule beyond what the admin asked for (confirmed with them):
  // once a poll closes, results open up to everyone, not just people who
  // voted - otherwise someone who forgot to vote could never see the
  // outcome even long after it was decided.
  const canSeeResults = hasVoted || isClosed;

  const base = {
    _id: poll._id,
    tour: poll.tour,
    question: poll.question,
    options: poll.options.map((o) => ({ _id: o._id, text: o.text })),
    closesAt: poll.closesAt,
    isClosed,
    hasVoted,
    myOptionId: myVote ? myVote.option : null,
    createdAt: poll.createdAt,
  };

  if (!canSeeResults) {
    return { ...base, totalVotes: null, results: null };
  }

  const counts = new Map(poll.options.map((o) => [String(o._id), 0]));
  for (const vote of poll.votes) {
    const key = String(vote.option);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const totalVotes = poll.votes.length;
  const results = poll.options.map((o) => {
    const count = counts.get(String(o._id)) ?? 0;
    return {
      _id: o._id,
      text: o.text,
      count,
      // One decimal place - Math.round(x * 1000) / 10, not a plain
      // toFixed(1), so a whole-number percentage doesn't grow a
      // pointless ".0" (see the client's own display of this value).
      percentage: totalVotes > 0 ? Math.round((count / totalVotes) * 1000) / 10 : 0,
    };
  });

  return { ...base, totalVotes, results };
}

function cleanOptionTexts(options) {
  if (!Array.isArray(options)) return null;
  return options.map((o) => (typeof o === 'string' ? o.trim() : '')).filter(Boolean);
}

// GET /polls - requireAuth (any logged-in role, see pollRoutes.js). Every
// poll for every tour, newest first - no per-tour scoping (yet); this app
// has no notion of "which tours a given member cares about" beyond
// attendance, and a club-wide poll list is simple and transparent, same
// spirit as the Klub Felhasználók list.
export const getAllPolls = async (req, res) => {
  const polls = await Poll.find()
    .select('+votes')
    .sort('-createdAt')
    .populate({ path: 'tour', select: TOUR_SELECT });

  res.status(200).json({
    status: 'success',
    data: { polls: polls.map((p) => buildPollView(p, req.user._id)) },
  });
};

// GET /polls/:id - requireAuth.
export const getPoll = async (req, res) => {
  const poll = await Poll.findById(req.params.id)
    .select('+votes')
    .populate({ path: 'tour', select: TOUR_SELECT });

  if (!poll) {
    throw new AppError('Nincs ilyen szavazás.', 404);
  }

  res.status(200).json({ status: 'success', data: { poll: buildPollView(poll, req.user._id) } });
};

// POST /polls - admin-only (see pollRoutes.js).
export const createPoll = async (req, res) => {
  const { tour, question, closesAt } = req.body;
  const options = cleanOptionTexts(req.body.options);

  if (!options || options.length < 2) {
    throw new AppError('Legalább 2 válaszlehetőség szükséges.', 400);
  }

  const poll = await Poll.create({
    tour,
    question,
    options: options.map((text) => ({ text })),
    closesAt,
    createdBy: req.user._id,
  });

  await poll.populate({ path: 'tour', select: TOUR_SELECT });

  res.status(201).json({ status: 'success', data: { poll: buildPollView(poll, req.user._id) } });
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

  const { tour, question, closesAt } = req.body;
  const hasVotes = poll.votes.length > 0;

  // Compares actual values, not just "was this key present in the body" -
  // the admin edit form always resends question/options as part of its
  // payload regardless of what the admin actually changed, so a
  // presence-only check would reject every single edit once a poll has any
  // votes at all, including just extending the deadline. Re-submitting the
  // same question/options unchanged is fine even with votes already cast;
  // only a genuine change to either is blocked.
  const newOptions = req.body.options !== undefined ? cleanOptionTexts(req.body.options) : undefined;
  const questionChanged = question !== undefined && question.trim() !== poll.question;
  const optionsChanged =
    newOptions !== undefined &&
    (newOptions.length !== poll.options.length || newOptions.some((text, i) => text !== poll.options[i]?.text));

  if (hasVotes && (questionChanged || optionsChanged)) {
    throw new AppError(
      'Ezen a szavazáson már van leadott szavazat, ezért a kérdés és a válaszlehetőségek többé nem módosíthatók - csak a tábor és a záró időpont.',
      400,
    );
  }

  if (tour !== undefined) poll.tour = tour;
  if (closesAt !== undefined) poll.closesAt = closesAt;

  if (questionChanged) {
    poll.question = question.trim();
  }
  if (optionsChanged) {
    if (newOptions.length < 2) {
      throw new AppError('Legalább 2 válaszlehetőség szükséges.', 400);
    }
    poll.options = newOptions.map((text) => ({ text }));
  }

  await poll.save();
  await poll.populate({ path: 'tour', select: TOUR_SELECT });

  res.status(200).json({ status: 'success', data: { poll: buildPollView(poll, req.user._id) } });
};

// DELETE /polls/:id - admin-only.
export const deletePoll = async (req, res) => {
  const poll = await Poll.findByIdAndDelete(req.params.id);
  if (!poll) {
    throw new AppError('Nincs ilyen szavazás.', 404);
  }
  res.status(204).json({ status: 'success', data: null });
};

// POST /polls/:id/vote - requireAuth, any role, once per poll. The option
// picked is never revealed back to anyone but tallied into the aggregate
// counts buildPollView computes - see pollModel.js's own comment on why
// `votes` is select:false everywhere else.
export const voteOnPoll = async (req, res) => {
  const poll = await Poll.findById(req.params.id).select('+votes');
  if (!poll) {
    throw new AppError('Nincs ilyen szavazás.', 404);
  }

  if (poll.closesAt.getTime() <= Date.now()) {
    throw new AppError('Ez a szavazás már lezárult.', 400);
  }

  const alreadyVoted = poll.votes.some((v) => String(v.user) === String(req.user._id));
  if (alreadyVoted) {
    throw new AppError('Már szavaztál ezen a szavazáson.', 400);
  }

  const option = poll.options.id(req.body.optionId);
  if (!option) {
    throw new AppError('Érvénytelen válasz.', 400);
  }

  poll.votes.push({ user: req.user._id, option: option._id });
  await poll.save();
  await poll.populate({ path: 'tour', select: TOUR_SELECT });

  res.status(200).json({ status: 'success', data: { poll: buildPollView(poll, req.user._id) } });
};
