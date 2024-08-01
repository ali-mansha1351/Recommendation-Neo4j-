//error handler class
//Error is the parent class here
//ErrorHandler is the child class
//super is the parent class constructor here
class ErrorHandler extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = ErrorHandler;
