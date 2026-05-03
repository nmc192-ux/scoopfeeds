import { timedQuery } from "./queryTiming.js";

export function createTransaction(db, name, fn) {
  const tx = db.transaction(fn);

  return (...args) => timedQuery(`tx:${name}`, () => tx(...args));
}

export function runInTransaction(db, name, fn, ...args) {
  return createTransaction(db, name, fn)(...args);
}
