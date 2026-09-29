import http from 'http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';
import { afterAll, beforeAll, afterEach, describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createMember, createTour } from '../helpers/factories.js';
import registerChatHandlers from '../../src/chat/chatSocket.js';
import Post from '../../src/models/postModel.js';
import { generalChatRoom, tourChatRoom } from '../../src/chat/chatRooms.js';

// A real Socket.IO server on a random port, with the same stand-in
// session as the HTTP tests (x-test-user header).
let server;
let url;
const sockets = [];

beforeAll(async () => {
  server = http.createServer(app);
  const io = new Server(server);
  io.engine.use((req, res, next) => {
    const raw = req.headers['x-test-user'];
    req.session = { user: raw ? JSON.parse(raw) : undefined };
    next();
  });
  registerChatHandlers(io);
  await new Promise((resolve) => server.listen(0, resolve));
  url = `http://localhost:${server.address().port}`;
});

afterEach(() => {
  sockets.splice(0).forEach((s) => s.disconnect());
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

async function connect(user) {
  const socket = ioClient(url, {
    extraHeaders: user ? asUser(user) : {},
    transports: ['websocket', 'polling'],
  });
  sockets.push(socket);
  await new Promise((resolve) => socket.on('connect', resolve));
  return socket;
}

const next = (socket, event) => new Promise((resolve) => socket.once(event, resolve));

async function joined(user, chatRoomId) {
  const socket = await connect(user);
  const history = next(socket, 'initial-posts');
  socket.emit('join-chat', { chatRoomId });
  return { socket, history: await history };
}

describe('chat rooms', () => {
  it("the general room: one for the whole club, messages delivered like in a tour's", async () => {
    const room = await generalChatRoom();
    expect(String((await generalChatRoom())._id)).toBe(String(room._id));
    expect(room).toMatchObject({ type: 'general', tourId: null });

    const a = await joined(await createMember(), String(room._id));
    const b = await joined(await createMember(), String(room._id));
    const got = next(b.socket, 'new-post');
    a.socket.emit('create-post', { chatRoomId: String(room._id), text: 'Mindenkinek!' });
    const post = await got;
    expect(post).toMatchObject({ chatRoomId: String(room._id), text: 'Mindenkinek!' });
  });

  it("a tour's room is made once, and an unknown room can't be joined", async () => {
    const tour = await createTour();
    const first = await tourChatRoom(tour._id);
    expect(String((await tourChatRoom(tour._id))._id)).toBe(String(first._id));
    expect(first).toMatchObject({ type: 'tour' });

    const socket = await connect(await createMember());
    const error = next(socket, 'chat-error');
    socket.emit('join-chat', { chatRoomId: '000000000000000000000000' });
    expect(await error).toBe('Nincs ilyen Kotyogó.');
  });

  it('refuses to join when logged out', async () => {
    const socket = await connect(null);
    const error = next(socket, 'chat-error');
    socket.emit('join-chat', { chatRoomId: 'x' });
    expect(await error).toContain('Not authenticated');
  });

  it("delivers a new message to everyone in that tour, with the author's username", async () => {
    const tour = await createTour();
    const roomId = String((await tourChatRoom(tour._id))._id);
    const alice = await createMember({ username: 'aliz' });
    const bob = await createMember();
    const a = await joined(alice, roomId);
    const b = await joined(bob, roomId);
    expect(a.history).toEqual({ chatRoomId: roomId, posts: [] });

    const received = next(b.socket, 'new-post');
    a.socket.emit('create-post', { chatRoomId: roomId, text: '  Sziasztok!  ' });
    const post = await received;
    expect(post.text).toBe('Sziasztok!');
    expect(post.creator.username).toBe('aliz');

    // The history now has it for a newcomer.
    const c = await joined(await createMember(), roomId);
    expect(c.history.posts).toHaveLength(1);
  });

  it('after leaving a chat room, its messages no longer arrive', async () => {
    const tour = await createTour();
    const roomId = String((await tourChatRoom(tour._id))._id);
    const alice = await createMember();
    const bob = await createMember();
    const a = await joined(alice, roomId);
    const b = await joined(bob, roomId);
    b.socket.emit('leave-chat', { chatRoomId: roomId });
    let got = false;
    b.socket.on('new-post', () => (got = true));
    const echo = next(a.socket, 'new-post');
    a.socket.emit('create-post', { chatRoomId: roomId, text: 'hello' });
    await echo;
    await new Promise((r) => setTimeout(r, 100));
    expect(got).toBe(false);
  });

  it('the author edits and deletes their own message; everyone gets the update', async () => {
    const tour = await createTour();
    const roomId = String((await tourChatRoom(tour._id))._id);
    const alice = await createMember();
    const bob = await createMember();
    const a = await joined(alice, roomId);
    const b = await joined(bob, roomId);
    const created = next(a.socket, 'new-post');
    a.socket.emit('create-post', { chatRoomId: roomId, text: 'eredeti' });
    const post = await created;

    const edited = next(b.socket, 'post-updated');
    a.socket.emit('edit-post', { postId: post._id, text: 'javított' });
    expect(await edited).toMatchObject({ text: 'javított' });
    expect((await Post.findById(post._id)).editedAt).toBeTruthy();

    const deleted = next(b.socket, 'post-updated');
    a.socket.emit('delete-post', { postId: post._id });
    const gone = await deleted;
    expect(gone.text).toBe('');
    expect(gone.deletedAt).toBeTruthy();

    // A deleted message can't be edited back.
    const error = next(a.socket, 'chat-error');
    a.socket.emit('edit-post', { postId: post._id, text: 'vissza' });
    expect(await error).toContain('nem szerkesztheted');
  });

  it("nobody can edit or delete someone else's message", async () => {
    const tour = await createTour();
    const roomId = String((await tourChatRoom(tour._id))._id);
    const alice = await createMember();
    const mallory = await createMember();
    const a = await joined(alice, roomId);
    const m = await joined(mallory, roomId);
    const created = next(a.socket, 'new-post');
    a.socket.emit('create-post', { chatRoomId: roomId, text: 'az enyém' });
    const post = await created;

    const editError = next(m.socket, 'chat-error');
    m.socket.emit('edit-post', { postId: post._id, text: 'feltört' });
    expect(await editError).toContain('nem szerkesztheted');
    const deleteError = next(m.socket, 'chat-error');
    m.socket.emit('delete-post', { postId: post._id });
    expect(await deleteError).toContain('nem törölheted');
    expect((await Post.findById(post._id)).text).toBe('az enyém');
  });

  it('ignores empty messages and refuses posting when logged out', async () => {
    const tour = await createTour();
    const roomId = String((await tourChatRoom(tour._id))._id);
    const alice = await createMember();
    const a = await joined(alice, roomId);
    a.socket.emit('create-post', { chatRoomId: roomId, text: '   ' });
    const anon = await connect(null);
    const error = next(anon, 'chat-error');
    anon.emit('create-post', { chatRoomId: roomId, text: 'x' });
    expect(await error).toContain('Not authenticated');
    await new Promise((r) => setTimeout(r, 100));
    expect(await Post.countDocuments()).toBe(0);
  });
});

describe('hangulatjelek (reactions)', () => {
  it('one per person: another replaces mine, the same again takes it back; everyone sees who', async () => {
    const tour = await createTour();
    const roomId = String((await tourChatRoom(tour._id))._id);
    const alice = await createMember();
    const bob = await createMember();
    const a = await joined(alice, roomId);
    const b = await joined(bob, roomId);
    const created = next(a.socket, 'new-post');
    a.socket.emit('create-post', { chatRoomId: roomId, text: 'Megjöttünk!' });
    const post = await created;

    let update = next(a.socket, 'post-updated');
    b.socket.emit('react-post', { postId: post._id, emoji: '👍' });
    let seen = await update;
    expect(seen.reactions).toHaveLength(1);
    expect(seen.reactions[0]).toMatchObject({ emoji: '👍', user: { name: bob.name } });

    update = next(a.socket, 'post-updated');
    b.socket.emit('react-post', { postId: post._id, emoji: '😂' });
    seen = await update;
    expect(seen.reactions.map((r) => r.emoji)).toEqual(['😂']);

    update = next(a.socket, 'post-updated');
    b.socket.emit('react-post', { postId: post._id, emoji: '😂' });
    seen = await update;
    expect(seen.reactions).toHaveLength(0);
  });

  it('ignores my own message, an unknown emoji and a deleted message', async () => {
    const tour = await createTour();
    const roomId = String((await tourChatRoom(tour._id))._id);
    const alice = await createMember();
    const bob = await createMember();
    const a = await joined(alice, roomId);
    const b = await joined(bob, roomId);
    const created = next(a.socket, 'new-post');
    a.socket.emit('create-post', { chatRoomId: roomId, text: 'x' });
    const post = await created;

    a.socket.emit('react-post', { postId: post._id, emoji: '👍' });
    b.socket.emit('react-post', { postId: post._id, emoji: '💩' });
    const deleted = next(a.socket, 'post-updated');
    a.socket.emit('delete-post', { postId: post._id });
    await deleted;
    b.socket.emit('react-post', { postId: post._id, emoji: '👍' });
    await new Promise((r) => setTimeout(r, 150));
    expect((await Post.findById(post._id)).reactions).toHaveLength(0);
  });
});
