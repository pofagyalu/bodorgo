import Poll from '../models/pollModel.js';
import { pushInBackground, tourAttendeeIds } from './chatNotifications.js';

const REMINDER_BEFORE_MS = 2 * 60 * 60 * 1000;

// Every few minutes (see server.js): polls closing within 2 hours remind
// the tour's attendees who haven't voted yet - once per poll. A poll that
// was started with less than 2 hours to go is skipped; its "new poll"
// notification only just went out.
export async function checkPollReminders(now = new Date()) {
  const soon = new Date(now.getTime() + REMINDER_BEFORE_MS);
  const polls = await Poll.find({ reminderSentAt: null, closesAt: { $gt: now, $lte: soon } })
    .select('+votes')
    .populate({ path: 'tour', select: 'title order' });

  const reminded = [];
  for (const poll of polls) {
    // Marked first, so a restart halfway can't remind twice.
    await Poll.updateOne({ _id: poll._id }, { reminderSentAt: now });
    if (poll.closesAt.getTime() - poll.createdAt.getTime() <= REMINDER_BEFORE_MS) continue;

    const voted = poll.votes.map((v) => v.user);
    const users = await tourAttendeeIds(poll.tour._id, voted);
    const time = poll.closesAt.toLocaleTimeString('hu-HU', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Budapest',
    });
    pushInBackground(users, {
      title: `Még nem szavaztál – ${poll.tour.title}`,
      body: `${poll.question} – ${time}-kor lezárul.`,
      tag: `poll-${poll._id}`,
      url: poll.post ? `/chat?tabor=${poll.tour._id}` : '/szavazasok',
      renotify: true,
    });
    reminded.push({ poll: String(poll._id), users });
  }
  return reminded;
}
