class AppError extends Error {
  // code (optional): a fixed word the client can act on, whatever the
  // message says - e.g. 'fresh-login-required' (auth/freshLogin.js).
  constructor(message, statusCode, code) {
    super(message);

    this.statusCode = statusCode;
    if (code) this.code = code;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    // Sending back to user only the operational errors
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export default AppError;
