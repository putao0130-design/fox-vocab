// CloudBase cloud function. Document-database transactions are server-only.
// This file does not contain a secret. Deploy it in the document-database environment, not PostgreSQL.
'use strict';
const { handleAction } = require('./actions.js');

function wrapTcb(db) {
  return {
    async get(coll, id) {
      const res = await db.collection(coll).doc(id).get();
      const data = res && res.data;
      if (!data || (Array.isArray(data) && !data.length)) return null;
      const doc = Array.isArray(data) ? data[0] : data;
      return Object.assign({ id: id }, doc);
    },
    async put(coll, id, doc) { await db.collection(coll).doc(id).set(Object.assign({ id: id }, doc)); },
    async patch(coll, id, fields) { await db.collection(coll).doc(id).update(fields); },
    async remove(coll, id) { await db.collection(coll).doc(id).remove(); },
    async find(coll, query) {
      const res = await db.collection(coll).where(query).limit(100).get();
      return ((res && res.data) || []).map(function (doc) { return Object.assign({ id: doc._id || doc.id }, doc); });
    },
    async transaction(fn) {
      const transaction = await db.startTransaction();
      const tx = wrapTcb(transaction);
      try {
        const result = await fn(tx);
        await transaction.commit();
        return result;
      } catch (e) {
        try { await transaction.rollback(); } catch (err) { /* already closed */ }
        throw e;
      }
    }
  };
}

exports.main = async function (event, context) {
  const user = context && (context.userInfo || context.auth || {});
  const anonUid = user.uid || user.openId || user.customUserId || '';
  if (!anonUid) return { error: 'anonymous-login-required' };
  const body = Object.assign({}, event || {});
  if (!body.ip) body.ip = (context && (context.clientIP || context.ip)) || 'unknown';
  const sdk = require('@cloudbase/node-sdk');
  const app = sdk.init({ env: sdk.SYMBOL_CURRENT_ENV });
  return handleAction(wrapTcb(app.database()), body, {});
};
exports.handleAction = handleAction;
