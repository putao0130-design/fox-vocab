// Postgres document adapter used only inside the Edge Function.
// All writes go through the service-role client (function secret).
// Multi-document mutations use dogverb_commit_tx so they stay atomic.
'use strict';

const COLLECTIONS = ['spaces', 'devices', 'pairing', 'sessions', 'nonces', 'rate'];

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function keyOf(coll, id) { return coll + '\n' + id; }
function assertColl(coll) {
  if (COLLECTIONS.indexOf(coll) < 0) throw new Error('bad-collection');
}

function createPgAdapter(client, opts) {
  opts = opts || {};
  const retries = opts.retries || 5;

  async function rpc(name, args) {
    const res = await client.rpc(name, args);
    if (res.error) {
      const err = new Error(res.error.message || 'rpc-failed');
      err.rpc = name;
      err.details = res.error;
      throw err;
    }
    return res.data;
  }

  async function get(coll, id) {
    assertColl(coll);
    const res = await client.from('dogverb_kv').select('doc').eq('coll', coll).eq('id', id).maybeSingle();
    if (res.error) throw new Error(res.error.message || 'get-failed');
    return res.data && res.data.doc ? res.data.doc : null;
  }

  async function findSafe(coll, query) {
    const res = await client.from('dogverb_kv').select('doc').eq('coll', coll);
    if (res.error) throw new Error(res.error.message || 'find-failed');
    const rows = (res.data || []).map(function (row) { return row.doc; });
    if (!query || !Object.keys(query).length) return rows;
    return rows.filter(function (doc) {
      return Object.keys(query).every(function (k) { return doc[k] === query[k]; });
    });
  }

  function makeTx(reads, writes) {
    async function current(coll, id) {
      const k = keyOf(coll, id);
      if (writes[k] && writes[k].op === 'remove') return null;
      if (writes[k] && writes[k].op === 'put') return clone(writes[k].doc);
      if (Object.prototype.hasOwnProperty.call(reads, k)) return reads[k] ? clone(reads[k]) : null;
      const row = await get(coll, id);
      reads[k] = row ? clone(row) : null;
      return row ? clone(row) : null;
    }
    return {
      async get(coll, id) { assertColl(coll); return current(coll, id); },
      async put(coll, id, doc) {
        assertColl(coll);
        const stored = Object.assign(clone(doc), { id: id });
        await current(coll, id);
        writes[keyOf(coll, id)] = { op: 'put', coll: coll, id: id, doc: stored };
      },
      async patch(coll, id, fields) {
        assertColl(coll);
        const doc = await current(coll, id);
        if (!doc) return false;
        Object.keys(fields).forEach(function (key) { doc[key] = fields[key]; });
        writes[keyOf(coll, id)] = { op: 'put', coll: coll, id: id, doc: doc };
        return true;
      },
      async remove(coll, id) {
        assertColl(coll);
        await current(coll, id);
        writes[keyOf(coll, id)] = { op: 'remove', coll: coll, id: id };
        return true;
      },
      async find(coll, query) {
        assertColl(coll);
        const live = await findSafe(coll, query);
        const seen = {};
        const out = [];
        live.forEach(function (doc) {
          const k = keyOf(coll, doc.id);
          if (!Object.prototype.hasOwnProperty.call(reads, k) && !writes[k]) reads[k] = clone(doc);
          const cur = writes[k] && writes[k].op === 'remove' ? null
            : writes[k] && writes[k].op === 'put' ? writes[k].doc
            : Object.prototype.hasOwnProperty.call(reads, k) ? reads[k] : doc;
          if (!cur) return;
          if (query && !Object.keys(query).every(function (key) { return cur[key] === query[key]; })) return;
          seen[doc.id] = true;
          out.push(clone(cur));
        });
        Object.keys(writes).forEach(function (k) {
          const w = writes[k];
          if (w.coll !== coll || w.op !== 'put' || seen[w.id]) return;
          const cur = w.doc;
          if (query && !Object.keys(query).every(function (key) { return cur[key] === query[key]; })) return;
          out.push(clone(cur));
        });
        return out;
      }
    };
  }

  async function commit(reads, writes) {
    const readPayload = {};
    Object.keys(reads).forEach(function (k) { readPayload[k] = reads[k]; });
    const writePayload = {};
    Object.keys(writes).forEach(function (k) { writePayload[k] = writes[k]; });
    return rpc('dogverb_commit_tx', { p_reads: readPayload, p_writes: writePayload });
  }

  const api = {
    get: get,
    async put(coll, id, doc) {
      const reads = {}; const writes = {};
      const tx = makeTx(reads, writes);
      await tx.put(coll, id, doc);
      const ok = await commit(reads, writes);
      if (!ok) throw new Error('commit-conflict');
    },
    async patch(coll, id, fields) {
      const reads = {}; const writes = {};
      const tx = makeTx(reads, writes);
      const changed = await tx.patch(coll, id, fields);
      if (!changed) return false;
      const ok = await commit(reads, writes);
      if (!ok) throw new Error('commit-conflict');
      return true;
    },
    async remove(coll, id) {
      const reads = {}; const writes = {};
      const tx = makeTx(reads, writes);
      await tx.remove(coll, id);
      const ok = await commit(reads, writes);
      if (!ok) throw new Error('commit-conflict');
      return true;
    },
    find: findSafe,
    async transaction(fn) {
      let last = null;
      for (let i = 0; i < retries; i++) {
        const reads = {}; const writes = {};
        const result = await fn(makeTx(reads, writes));
        if (!Object.keys(writes).length) return result;
        const ok = await commit(reads, writes);
        if (ok) return result;
        last = result;
      }
      const err = new Error('commit-conflict');
      err.code = 'commit-conflict';
      err.last = last;
      throw err;
    }
  };
  return api;
}

module.exports = { createPgAdapter: createPgAdapter, COLLECTIONS: COLLECTIONS };
