const express = require('express');
const Raven = require('raven');
const request = require('supertest');

Raven.config(false).install();

describe('multiple async errors', function() {
  function onUncaughtException() {}

  beforeAll(function() {
    process.addListener('uncaughtException', onUncaughtException);
  });

  afterAll(function() {
    process.removeListener('uncaughtException', onUncaughtException);
  });

  beforeEach(function() {
    const app = express();

    app.use(Raven.requestHandler());

    app.numErrors = 0;
    app.use((req, res, next) => {
      // Every time this increments, Raven's also calling `next(err)`.
      process.domain.on('error', (err) => app.numErrors++);
      next();
    })

    app.get('/throw-two-async', () => {
      setTimeout(function() {
        throw new Error('boo');
      });

      setTimeout(function() {
        throw new Error('hoo');
      }, 10);
    });
    
    // This spy stands in for Raven's own `errorHandler`. Same principle:
    // if this middleware doesn't get called, neither will Raven's handler.
    //
    // Can't directly register the spy as error middleware
    // since it'll fail Express' function-length tests.
    const errorHandlingSpy = jasmine.createSpy('errorHandler');
    app.use((err, req, res, next) => {
      errorHandlingSpy.apply(null, arguments);
      next(err);
    });
    app.errorHandler = errorHandlingSpy;

    app.use((err, req, res, next) => {
      res.status(500).send(err.message);
    });

    this.app = app;
  });

  it('calls `next` multiple times while logging only one error', function(done) {
    // Node will log the second exception to the console even though we register an uncaught
    // exception handler, annoyingly.
    spyOn(console, 'error');

    request(this.app)
      .get('/throw-two-async')
      .expect(500, 'boo')
      .end((err) => {
        expect(err).toBeFalsy();
        expect(this.app.numErrors).toBe(1);
        expect(this.app.errorHandler.calls.count()).toBe(1);
        
        setTimeout(() => {
          expect(this.app.numErrors).toBe(2);

          // Based on the number of errors, we would expect the error handler
          // to have been called twice too. But it's not.
          expect(this.app.errorHandler.calls.count()).toBe(1);

          done();
        }, 20);
      });
    });
});
