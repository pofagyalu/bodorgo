import request from 'supertest';
import mongoose from 'mongoose';

import config from '../config';
import app from '../app';
import User from '../user/user.model';
import AuthMethod from '../auth/auth.method.model';

jest.mock('../config');
config.jwt.secret =
  '082e3fdc12c2396287232acc933a5f5a467694d9df8698756ce7b5823d152235';

const DB_TEST_URI = `mongodb+srv://${config.db.userName}:${config.db.password}@${config.db.clusterAddress}/bodorgo-test?retryWrites=true&w=majority`;

const mockUser = {
  name: 'Johnny',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john.doe@gmail.com',
  password: 'password12345678',
  emailVerified: true,
};
const mockAuth = {
  type: 'PASSWORD',
  secret: 'password12345678',
};

describe('Testing /api/v1/users/login endpoint', () => {
  beforeAll(async () => {
    await mongoose.connect(DB_TEST_URI);
  });

  beforeEach(async () => {
    await mongoose.connection.collections.users.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.connection.collections.users.drop();
    await mongoose.connection.collections.authmethods.drop();
    await mongoose.connection.close();
  });

  it('should return an access token when given valid login credentials', async () => {
    const user = new User(mockUser);
    const newUser = await user.save();
    mockAuth.user = newUser._id;

    const auth = new AuthMethod(mockAuth);
    await auth.save();

    const response = await request(app)
      .post('/api/v1/users/login')
      .send({ email: mockUser.email, password: mockUser.password });

    expect(response.status).toBe(200);
    expect(response.headers['set-cookie'][0]).toContain('authToken');
  });

  it('should return a warning message when email is not verified', async () => {
    mockUser.emailVerified = false;
    const user = new User(mockUser);
    await user.save();

    const response = await request(app)
      .post('/api/v1/users/login')
      .send({ email: mockUser.email, password: mockUser.password });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe(
      'Email confirmation in progress, please check your inbox.',
    );
  });

  it('should return a warning message when user is locked', async () => {
    mockUser.lockUntil = new Date(Date.now() + 5 * 60 * 60 * 1000);
    mockUser.emailVerified = true;
    const user = new User(mockUser);
    await user.save();

    const response = await request(app)
      .post('/api/v1/users/login')
      .send({ email: mockUser.email, password: mockUser.password });

    expect(response.status).toBe(429);
    expect(response.body.message).toBe(
      'Too many login attempts. Please try again 5 minutes later',
    );
  });

  it('should return an error when a non-existing email address is given', async () => {
    mockUser.lockUntil = undefined;
    const user = new User(mockUser);
    await user.save();

    const response = await request(app)
      .post('/api/v1/users/login')
      .send({ email: 'johnny.doe@gmail.com', password: 'password12345678' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('No user found.');
  });

  it('should return an error when given wrong password', async () => {
    mockUser.emailVerified = true;
    const user = new User(mockUser);
    const newUser = await user.save();
    mockAuth.user = newUser._id;

    const auth = new AuthMethod(mockAuth);
    await auth.save();

    const response = await request(app)
      .post('/api/v1/users/login')
      .send({ email: 'john.doe@gmail.com', password: 'wrongpassword' });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Wrong credentials. Please try again.');
  });
});
