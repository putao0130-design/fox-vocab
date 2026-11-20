// In-memory document store with serialized transactions. Tests use this.
// It is not CloudBase and it does not open a network connection.
'use strict';
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function createMemoryDb() {
  const data = {};
  let chain = Promise.resolve();
  function make(target) {
    function bucket(coll) { if (!target[coll]) target[coll] = {}; return target[coll]; }
    return {
      async get(coll, id) { const doc = bucket(coll)[id]; return doc ? clone(doc) : null; },
      async put(coll, id, doc) { bucket(coll)[id] = Object.assign(clone(doc), { id: id }); },
      async patch(coll, id, fields) {
        const doc = bucket(coll)[id];
        if (!doc) return false;
        Object.keys(fields).forEach(function (key) { doc[key] = fields[key]; });
        return true;
      },
      async remove(coll, id) { return delete bucket(coll)[id]; },
      async find(coll, query) {
        return Object.keys(bucket(coll)).filter(function (id) {
          const doc = bucket(coll)[id];
          return Object.keys(query).every(function (key) { return doc[key] === query[key]; });
        }).map(function (id) { return clone(bucket(coll)[id]); });
      }
    };
  }
  const api = make(data);
  api.transaction = function (fn) {
    const run = chain.then(async function () {
      const snap = clone(data);
      const result = await fn(make(snap));
      Object.keys(data).forEach(function (key) { delete data[key]; });
      Object.keys(snap).forEach(function (key) { data[key] = snap[key]; });
      return result;
    });
    chain = run.then(function () {}, function () {});
    return run;
  };
  api.dump = function () { return clone(data); };
  return api;
}
module.exports = { createMemoryDb: createMemoryDb };
