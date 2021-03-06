/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ifEnvSupports} from '../test-util';

class MicroTaskQueueZoneSpec implements ZoneSpec {
  name: string = 'MicroTaskQueue';
  queue: MicroTask[] = [];
  properties = {queue: this.queue, flush: this.flush.bind(this)};

  flush() {
    while (this.queue.length) {
      const task = this.queue.shift();
      task.invoke();
    }
  }

  onScheduleTask(delegate: ZoneDelegate, currentZone: Zone, targetZone: Zone, task: MicroTask):
      any {
    this.queue.push(task);
  }
}

function flushMicrotasks() {
  Zone.current.get('flush')();
}

describe(
    'Promise', ifEnvSupports('Promise', function() {
      if (!global.Promise) return;
      let log: string[];
      let queueZone: Zone;
      let testZone: Zone;
      let pZone: Zone;

      beforeEach(() => {
        testZone = Zone.current.fork({name: 'TestZone'});

        pZone = Zone.current.fork({
          name: 'promise-zone',
          onScheduleTask: (parentZoneDelegate: ZoneDelegate, currentZone: Zone, targetZone: Zone,
                           task: MicroTask): any => {
            log.push('scheduleTask');
            parentZoneDelegate.scheduleTask(targetZone, task);
          }
        });

        queueZone = Zone.current.fork(new MicroTaskQueueZoneSpec());

        log = [];
      });

      it('should pretend to be a native code', () => {
        expect(String(Promise).indexOf('[native code]') >= 0).toBe(true);
      });

      it('should make sure that new Promise is instance of Promise', () => {
        expect(Promise.resolve(123) instanceof Promise).toBe(true);
        expect(new Promise(() => null) instanceof Promise).toBe(true);
      });

      it('should ensure that Promise this is instanceof Promise', () => {
        expect(() => {
          Promise.call({}, null);
        }).toThrowError('Must be an instanceof Promise.');
      });

      it('should allow subclassing', () => {
        class MyPromise extends Promise<any> {
          constructor(fn: any) {
            super(fn);
          }
        }
        expect(new MyPromise(null).then(() => null) instanceof MyPromise).toBe(true);
      });

      it('should intercept scheduling of resolution and then', (done) => {
        pZone.run(() => {
          let p: Promise<any> = new Promise(function(resolve, reject) {
            expect(resolve('RValue')).toBe(undefined);
          });
          expect(log).toEqual([]);
          expect(p instanceof Promise).toBe(true);
          p = p.then((v) => {
            log.push(v);
            expect(v).toBe('RValue');
            expect(log).toEqual(['scheduleTask', 'RValue']);
            return 'second value';
          });
          expect(p instanceof Promise).toBe(true);
          expect(log).toEqual(['scheduleTask']);
          p = p.then((v) => {
            log.push(v);
            expect(log).toEqual(['scheduleTask', 'RValue', 'scheduleTask', 'second value']);
            done();
          });
          expect(p instanceof Promise).toBe(true);
          expect(log).toEqual(['scheduleTask']);
        });
      });

      it('should allow sync resolution of promises', () => {
        queueZone.run(() => {
          const flush = Zone.current.get('flush');
          const queue = Zone.current.get('queue');
          const p = new Promise<string>(function(resolve, reject) {
                      resolve('RValue');
                    })
                        .then((v: string) => {
                          log.push(v);
                          return 'second value';
                        })
                        .then((v: string) => {
                          log.push(v);
                        });
          expect(queue.length).toEqual(1);
          expect(log).toEqual([]);
          flush();
          expect(log).toEqual(['RValue', 'second value']);
        });
      });

      it('should allow sync resolution of promises returning promises', () => {
        queueZone.run(() => {
          const flush = Zone.current.get('flush');
          const queue = Zone.current.get('queue');
          const p = new Promise<string>(function(resolve, reject) {
                      resolve(Promise.resolve('RValue'));
                    })
                        .then((v: string) => {
                          log.push(v);
                          return Promise.resolve('second value');
                        })
                        .then((v: string) => {
                          log.push(v);
                        });
          expect(queue.length).toEqual(1);
          expect(log).toEqual([]);
          flush();
          expect(log).toEqual(['RValue', 'second value']);
        });
      });

      describe('Promise API', function() {
        it('should work with .then', function(done) {
          let resolve;

          testZone.run(function() {
            new Promise(function(resolveFn) {
              resolve = resolveFn;
            }).then(function() {
              expect(Zone.current).toBe(testZone);
              done();
            });
          });

          resolve();
        });

        it('should work with .catch', function(done) {
          let reject;

          testZone.run(function() {
            new Promise(function(resolveFn, rejectFn) {
              reject = rejectFn;
            })['catch'](function() {
              expect(Zone.current).toBe(testZone);
              done();
            });
          });


          expect(reject()).toBe(undefined);
        });

        it('should work with Promise.resolve', () => {
          queueZone.run(() => {
            let value = null;
            Promise.resolve('resolveValue').then((v) => value = v);
            expect(Zone.current.get('queue').length).toEqual(1);
            flushMicrotasks();
            expect(value).toEqual('resolveValue');
          });
        });

        it('should work with Promise.reject', () => {
          queueZone.run(() => {
            let value = null;
            Promise.reject('rejectReason')['catch']((v) => value = v);
            expect(Zone.current.get('queue').length).toEqual(1);
            flushMicrotasks();
            expect(value).toEqual('rejectReason');
          });
        });

        describe('reject', () => {
          it('should reject promise', () => {
            queueZone.run(() => {
              let value = null;
              Promise.reject('rejectReason')['catch']((v) => value = v);
              flushMicrotasks();
              expect(value).toEqual('rejectReason');
            });
          });

          it('should re-reject promise', () => {
            queueZone.run(() => {
              let value = null;
              Promise.reject('rejectReason')['catch']((v) => {
                throw v;
              })['catch']((v) => value = v);
              flushMicrotasks();
              expect(value).toEqual('rejectReason');
            });
          });

          it('should reject and recover promise', () => {
            queueZone.run(() => {
              let value = null;
              Promise.reject('rejectReason')['catch']((v) => v).then((v) => value = v);
              flushMicrotasks();
              expect(value).toEqual('rejectReason');
            });
          });

          it('should reject if chained promise does not catch promise', () => {
            queueZone.run(() => {
              let value = null;
              Promise.reject('rejectReason')
                  .then((v) => fail('should not get here'))
                  .then(null, (v) => value = v);
              flushMicrotasks();
              expect(value).toEqual('rejectReason');
            });
          });

          it('should notify Zone.onError if no one catches promise', (done) => {
            let promiseError: Error = null;
            let zone: Zone = null;
            let task: Task = null;
            let error: Error = null;
            queueZone
                .fork({
                  name: 'promise-error',
                  onHandleError: (delegate: ZoneDelegate, current: Zone, target: Zone, error: any):
                                     boolean => {
                                       promiseError = error;
                                       delegate.handleError(target, error);
                                       return false;
                                     }
                })
                .run(() => {
                  zone = Zone.current;
                  task = Zone.currentTask;
                  error = new Error('rejectedErrorShouldBeHandled');
                  try {
                    // throw so that the stack trace is captured
                    throw error;
                  } catch (e) {
                  }
                  Promise.reject(error);
                  expect(promiseError).toBe(null);
                });
            setTimeout(() => null);
            setTimeout(() => {
              expect(promiseError.message)
                  .toBe(
                      'Uncaught (in promise): ' + error + (error.stack ? '\n' + error.stack : ''));
              expect(promiseError['rejection']).toBe(error);
              expect(promiseError['zone']).toBe(zone);
              expect(promiseError['task']).toBe(task);
              done();
            });
          });
        });

        describe('Promise.race', () => {
          it('should reject the value', () => {
            queueZone.run(() => {
              let value = null;
              (Promise as any).race([
                Promise.reject('rejection1'), 'v1'
              ])['catch']((v) => value = v);
              // expect(Zone.current.get('queue').length).toEqual(2);
              flushMicrotasks();
              expect(value).toEqual('rejection1');
            });
          });

          it('should resolve the value', () => {
            queueZone.run(() => {
              let value = null;
              (Promise as any).race([Promise.resolve('resolution'), 'v1']).then((v) => value = v);
              // expect(Zone.current.get('queue').length).toEqual(2);
              flushMicrotasks();
              expect(value).toEqual('resolution');
            });
          });
        });

        describe('Promise.all', () => {
          it('should reject the value', () => {
            queueZone.run(() => {
              let value = null;
              Promise.all([Promise.reject('rejection'), 'v1'])['catch']((v) => value = v);
              // expect(Zone.current.get('queue').length).toEqual(2);
              flushMicrotasks();
              expect(value).toEqual('rejection');
            });
          });

          it('should resolve the value', () => {
            queueZone.run(() => {
              let value = null;
              Promise.all([Promise.resolve('resolution'), 'v1']).then((v) => value = v);
              // expect(Zone.current.get('queue').length).toEqual(2);
              flushMicrotasks();
              expect(value).toEqual(['resolution', 'v1']);
            });
          });
        });
      });

      describe('Promise subclasses', function() {
        function MyPromise(init) {
          this._promise = new Promise(init);
        }

        MyPromise.prototype.catch = function _catch() {
          return this._promise.catch.apply(this._promise, arguments);
        };

        MyPromise.prototype.then = function then() {
          return this._promise.then.apply(this._promise, arguments);
        };

        const setPrototypeOf = (Object as any).setPrototypeOf || function(obj, proto) {
          obj.__proto__ = proto;
          return obj;
        };

        setPrototypeOf(MyPromise.prototype, Promise.prototype);

        it('should reject if the Promise subclass rejects', function() {
          const myPromise = new MyPromise(function(resolve, reject) {
            reject('foo');
          });

          return Promise.resolve()
              .then(function() {
                return myPromise;
              })
              .then(
                  function() {
                    throw new Error('Unexpected resolution');
                  },
                  function(result) {
                    expect(result).toBe('foo');
                  });
        });

        it('should resolve if the Promise subclass resolves', function() {
          const myPromise = new MyPromise(function(resolve, reject) {
            resolve('foo');
          });

          return Promise.resolve()
              .then(function() {
                return myPromise;
              })
              .then(function(result) {
                expect(result).toBe('foo');
              });
        });
      });

      describe('fetch', ifEnvSupports('fetch', function() {
                 it('should work for text response', function(done) {
                   testZone.run(function() {
                     global['fetch']('/base/test/assets/sample.json').then(function(response) {
                       const fetchZone = Zone.current;
                       expect(fetchZone).toBe(testZone);

                       response.text().then(function(text) {
                         expect(Zone.current).toBe(fetchZone);
                         expect(text.trim()).toEqual('{"hello": "world"}');
                         done();
                       });
                     });
                   });
                 });

                 it('should work for json response', function(done) {
                   testZone.run(function() {
                     global['fetch']('/base/test/assets/sample.json').then(function(response: any) {
                       const fetchZone = Zone.current;
                       expect(fetchZone).toBe(testZone);

                       response.json().then(function(obj: any) {
                         expect(Zone.current).toBe(fetchZone);
                         expect(obj.hello).toEqual('world');
                         done();
                       });
                     });
                   });
                 });

                 it('should work for blob response', function(done) {
                   testZone.run(function() {
                     global['fetch']('/base/test/assets/sample.json').then(function(response: any) {
                       const fetchZone = Zone.current;
                       expect(fetchZone).toBe(testZone);

                       // Android 4.3- doesn't support response.blob()
                       if (response.blob) {
                         response.blob().then(function(blob) {
                           expect(Zone.current).toBe(fetchZone);
                           expect(blob instanceof Blob).toEqual(true);
                           done();
                         });
                       } else {
                         done();
                       }
                     });
                   });
                 });

                 it('should work for arrayBuffer response', function(done) {
                   testZone.run(function() {
                     global['fetch']('/base/test/assets/sample.json').then(function(response: any) {
                       const fetchZone = Zone.current;
                       expect(fetchZone).toBe(testZone);

                       // Android 4.3- doesn't support response.arrayBuffer()
                       if (response.arrayBuffer) {
                         response.arrayBuffer().then(function(blob) {
                           expect(Zone.current).toBe(fetchZone);
                           expect(blob instanceof ArrayBuffer).toEqual(true);
                           done();
                         });
                       } else {
                         done();
                       }
                     });
                   });
                 });

               }));
    }));
