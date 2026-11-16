'use strict';

const mongoose = require('mongoose');
const { EJSON } = mongoose.mongo.BSON;
const { Query: MongoQuery, Aggregator, update: applyMongoUpdate } = require('mingo');
const { getPool } = require('../config/db');

const registered = new Map();
const readyTables = new Set();

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function tableFor(Model) {
  return `public.${quoteIdentifier(Model.collection.name)}`;
}

function encode(value) {
  return EJSON.stringify(value, null, 0, { relaxed: false });
}

function decode(value) {
  if (typeof value === 'string') return EJSON.parse(value, { relaxed: false });
  return EJSON.deserialize(value, { relaxed: false });
}

function clone(value) {
  return decode(encode(value));
}

function idFor(document) {
  if (document._id == null) document._id = new mongoose.Types.ObjectId();
  return encode(document._id);
}

async function ensureTable(Model) {
  const table = tableFor(Model);
  if (readyTables.has(table)) return table;
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${table} (
      mongo_id TEXT PRIMARY KEY,
      document JSONB NOT NULL,
      migrated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await ensureUniqueIndexes(Model, table);
  readyTables.add(table);
  return table;
}

async function ensureUniqueIndexes(Model, table) {
  for (const [keys, options] of Model.schema.indexes()) {
    if (!options || !options.unique || options.partialFilterExpression) continue;
    const fields = Object.keys(keys);
    if (!fields.length || fields.some((field) => field.includes('$'))) continue;
    const arrayPath = fields.some((field) => {
      const path = Model.schema.path(field);
      return path && (path.instance === 'Array' || path.$isMongooseArray);
    });
    if (arrayPath) continue;

    const expressions = fields.map((field) => `(${jsonPathText(field)})`).join(', ');
    const indexName = `ux_${Model.collection.name}_${fields.join('_')}`.slice(0, 40)
      .replace(/[^A-Za-z0-9_]/g, '_');
    const where = options.sparse
      ? ` WHERE ${fields.map((field) => `${jsonPathJson(field)} IS NOT NULL AND ${jsonPathJson(field)} <> 'null'::jsonb`).join(' AND ')}`
      : '';
    try {
      await getPool().query(`CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdentifier(indexName)} ON ${table} (${expressions})${where}`);
    } catch (error) {
      // Existing duplicate data should not prevent startup; writes still receive
      // application-level duplicate checks, and the issue is visible in logs.
      console.warn(`Could not create unique index ${indexName}: ${error.message}`);
    }
  }
}

function jsonPath(field) {
  return `'{${field.split('.').map((part) => part.replace(/'/g, "''")).join(',')}}'`;
}
function jsonPathText(field) { return `document #>> ${jsonPath(field)}`; }
function jsonPathJson(field) { return `document #> ${jsonPath(field)}`; }

async function readRows(Model, client = getPool(), lock = false) {
  const table = await ensureTable(Model);
  const result = await client.query(`SELECT mongo_id, document FROM ${table}${lock ? ' FOR UPDATE' : ''}`);
  return result.rows.map((row) => ({ key: row.mongo_id, document: decode(row.document) }));
}

function castFilter(Model, filter) {
  const input = filter && typeof filter === 'object' ? clone(filter) : {};
  try {
    const query = Model.__mongooseFind(input);
    query.cast(Model);
    return query.getFilter();
  } catch (error) {
    throw error;
  }
}

function castUpdate(Model, filter, update) {
  const query = Model.__mongooseUpdateOne(filter || {}, clone(update || {}));
  query.cast(Model);
  return query._castUpdate(query.getUpdate()) || query.getUpdate();
}

function normalizeUpdate(update) {
  if (!update || typeof update !== 'object') return { $set: {} };
  const operators = {};
  const direct = {};
  for (const [key, value] of Object.entries(update)) {
    if (key.startsWith('$')) operators[key] = value;
    else direct[key] = value;
  }
  if (Object.keys(direct).length) operators.$set = { ...(operators.$set || {}), ...direct };
  return Object.keys(operators).length ? operators : { $set: direct };
}

function equalitySeed(filter, out = {}) {
  for (const [key, value] of Object.entries(filter || {})) {
    if (key.startsWith('$')) continue;
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof mongoose.Types.ObjectId)) {
      if (Object.prototype.hasOwnProperty.call(value, '$eq')) setPath(out, key, value.$eq);
      continue;
    }
    setPath(out, key, value);
  }
  return out;
}

function getPath(object, path) {
  return path.split('.').reduce((value, key) => value == null ? undefined : value[key], object);
}
function setPath(object, path, value) {
  const parts = path.split('.');
  let target = object;
  for (const part of parts.slice(0, -1)) {
    if (!target[part] || typeof target[part] !== 'object') target[part] = {};
    target = target[part];
  }
  target[parts[parts.length - 1]] = value;
}
function unsetPath(object, path) {
  const parts = path.split('.');
  let target = object;
  for (const part of parts.slice(0, -1)) {
    target = target && target[part];
    if (!target) return;
  }
  if (target) delete target[parts[parts.length - 1]];
}

function positionalize(update, document, filter) {
  const result = clone(update);
  for (const [operator, fields] of Object.entries(result)) {
    if (!operator.startsWith('$') || !fields || typeof fields !== 'object') continue;
    for (const [path, value] of Object.entries(fields)) {
      if (!path.includes('.$.')) continue;
      const parts = path.split('.');
      const marker = parts.indexOf('$');
      const arrayPath = parts.slice(0, marker).join('.');
      const array = getPath(document, arrayPath);
      if (!Array.isArray(array)) continue;
      const elementFilter = {};
      for (const [filterPath, filterValue] of Object.entries(filter || {})) {
        if (filterPath.startsWith(`${arrayPath}.`)) setPath(elementFilter, filterPath.slice(arrayPath.length + 1), filterValue);
      }
      let index = array.findIndex((item) => new MongoQuery(elementFilter).test(item));
      if (index < 0) index = 0;
      const rewritten = [...parts];
      rewritten[marker] = String(index);
      delete fields[path];
      fields[rewritten.join('.')] = value;
    }
  }
  return result;
}

function applyUpdate(document, update, filter, inserting = false) {
  const normalized = normalizeUpdate(update);
  if (inserting && normalized.$setOnInsert) {
    normalized.$set = { ...(normalized.$set || {}), ...normalized.$setOnInsert };
    delete normalized.$setOnInsert;
  } else {
    delete normalized.$setOnInsert;
  }
  const rewritten = positionalize(normalized, document, filter);
  try {
    applyMongoUpdate(document, rewritten);
  } catch (error) {
    // Mongoose treats non-operator keys in a mixed update as $set. Normalize
    // those above; this catch only surfaces unsupported operators clearly.
    throw new Error(`Unsupported update operation: ${error.message}`);
  }
  return document;
}

function projectObject(document, projection) {
  if (!projection) return document;
  const fields = typeof projection === 'string'
    ? projection.split(/\s+/).filter(Boolean)
    : Object.entries(projection).map(([key, include]) => include ? key : `-${key}`);
  const includes = fields.filter((field) => !field.startsWith('-') && field !== '+');
  const excludes = fields.filter((field) => field.startsWith('-')).map((field) => field.slice(1));
  if (includes.length) {
    const out = {};
    for (const field of includes) {
      if (field === '_id' && fields.includes('-_id')) continue;
      const value = getPath(document, field);
      if (value !== undefined) setPath(out, field, value);
    }
    if (!fields.includes('-_id') && document._id !== undefined) out._id = document._id;
    return out;
  }
  const out = clone(document);
  for (const field of excludes) unsetPath(out, field);
  return out;
}

function compareValues(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (a instanceof Date) a = a.getTime();
  if (b instanceof Date) b = b.getTime();
  if (a && typeof a.toHexString === 'function') a = a.toHexString();
  if (b && typeof b.toHexString === 'function') b = b.toHexString();
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortRows(rows, sort) {
  if (!sort) return rows;
  let entries;
  if (typeof sort === 'string') {
    entries = sort.split(/\s+/).filter(Boolean).map((part) => [part.replace(/^-/, ''), part.startsWith('-') ? -1 : 1]);
  } else entries = Object.entries(sort);
  return rows.sort((a, b) => {
    for (const [field, direction] of entries) {
      const cmp = compareValues(getPath(a, field), getPath(b, field));
      if (cmp) return cmp * (Number(direction) < 0 ? -1 : 1);
    }
    return 0;
  });
}

function attachDocumentHelpers(Model, doc, projection) {
  const baseToObject = doc.toObject.bind(doc);
  const original = clone(baseToObject({ depopulate: true, virtuals: false }));
  Object.defineProperty(doc, '__pgModel', { value: Model, configurable: true });
  Object.defineProperty(doc, '__pgOriginal', { value: original, writable: true, configurable: true });
  Object.defineProperty(doc, '__pgBaseToObject', { value: baseToObject, configurable: true });
  if (projection) {
    doc.toObject = function (options) { return projectObject(baseToObject(options), projection); };
    doc.toJSON = function (options) { return this.toObject(options); };
  }
  doc.save = function () { return persistDocument(Model, this); };
  doc.populate = function (paths) { return populateDocument(Model, this, paths); };
  return doc;
}

function materialize(Model, data, projection) {
  const doc = Model.hydrate(data);
  return attachDocumentHelpers(Model, doc, projection);
}

async function persistDocument(Model, doc) {
  const table = await ensureTable(Model);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`wreddi:${Model.collection.name}`]);
    if (typeof doc.validate === 'function') await doc.validate();
    let data = doc.__pgBaseToObject
      ? doc.__pgBaseToObject({ depopulate: true, virtuals: false, minimize: false })
      : doc.toObject({ depopulate: true, virtuals: false, minimize: false });
    data = clone(data);
    if (!data._id) data._id = new mongoose.Types.ObjectId();
    const key = idFor(data);
    await client.query(`
      INSERT INTO ${table} (mongo_id, document, migrated_at)
      VALUES ($1, $2::jsonb, now())
      ON CONFLICT (mongo_id) DO UPDATE
        SET document = EXCLUDED.document, migrated_at = now()
    `, [key, encode(data)]);
    await client.query('COMMIT');
    doc.__pgOriginal = clone(data);
    return doc;
  } catch (error) {
    await client.query('ROLLBACK');
    throw normalizeDbError(error);
  } finally {
    client.release();
  }
}

function normalizeDbError(error) {
  if (error && error.code === '23505') {
    error.code = 11000;
    error.name = 'MongoServerError';
  }
  return error;
}

async function populateOne(Model, document, path) {
  const schemaPath = Model.schema.path(path);
  let ref = schemaPath && schemaPath.options && schemaPath.options.ref;
  if (!ref && schemaPath && schemaPath.caster && schemaPath.caster.options) ref = schemaPath.caster.options.ref;
  if (!ref) return document;
  const Target = registered.get(ref);
  if (!Target) return document;
  const value = getPath(document, path);
  const isArray = Array.isArray(value);
  const ids = isArray ? value : value == null ? [] : [value];
  if (!ids.length) {
    if (document.$__) setPath(document._doc, path, isArray ? [] : null);
    else setPath(document, path, isArray ? [] : null);
    return document;
  }
  const related = await Target.find({ _id: { $in: ids } }).lean();
  const byId = new Map(related.map((item) => [encode(item._id), item]));
  const populated = isArray ? ids.map((id) => byId.get(encode(id)) || null) : byId.get(encode(ids[0])) || null;
  if (document.$__) setPath(document._doc, path, populated);
  else setPath(document, path, populated);
  return document;
}

async function populateDocument(Model, document, paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  for (const item of list) {
    const path = typeof item === 'string' ? item : item && item.path;
    if (path) await populateOne(Model, document, path);
  }
  return document;
}

class PgQuery {
  constructor(Model, kind, filter = {}, projection = null) {
    this.Model = Model;
    this.kind = kind;
    this.filter = filter || {};
    this.projection = projection || null;
    this.sortSpec = null;
    this.limitCount = null;
    this.skipCount = 0;
    this.populatePaths = [];
    this.isLean = false;
  }
  sort(value) { this.sortSpec = value; return this; }
  limit(value) { this.limitCount = Number(value); return this; }
  skip(value) { this.skipCount = Number(value) || 0; return this; }
  select(value) { this.projection = value; return this; }
  lean(value = true) { this.isLean = value !== false; return this; }
  populate(value) { this.populatePaths.push(...(Array.isArray(value) ? value : [value])); return this; }
  setOptions(options = {}) { if (options.sort) this.sort(options.sort); if (options.limit) this.limit(options.limit); if (options.skip) this.skip(options.skip); if (options.lean) this.lean(); return this; }
  cursor() {
    const query = this;
    let rowsPromise;
    let index = 0;
    return {
      async next() {
        if (!rowsPromise) rowsPromise = query.exec();
        const rows = await rowsPromise;
        return rows[index++] || null;
      },
      async *[Symbol.asyncIterator]() {
        let row;
        while ((row = await this.next()) !== null) yield row;
      },
    };
  }
  async exec() {
    const rows = await readRows(this.Model);
    const filter = castFilter(this.Model, this.filter);
    let docs = new MongoQuery(filter).find(rows.map((row) => row.document)).all();
    if (this.kind === 'count') return docs.length;
    docs = sortRows(docs, this.sortSpec);
    if (this.skipCount > 0) docs = docs.slice(this.skipCount);
    if (this.limitCount != null && this.limitCount >= 0) docs = docs.slice(0, this.limitCount);
    const isOne = this.kind === 'findOne';
    if (isOne) docs = docs.slice(0, 1);
    const out = [];
    for (const data of docs) {
      const item = this.isLean
        ? projectObject(data, this.projection)
        : materialize(this.Model, data, this.projection);
      for (const populate of this.populatePaths) {
        const path = typeof populate === 'string' ? populate : populate && populate.path;
        if (path) await populateOne(this.Model, item, path);
      }
      out.push(item);
    }
    return isOne ? (out[0] || null) : out;
  }
  then(resolve, reject) { return this.exec().then(resolve, reject); }
  catch(reject) { return this.exec().catch(reject); }
  finally(callback) { return this.exec().finally(callback); }
}

class PgMutationQuery {
  constructor(run, projection = null) {
    this.run = run;
    this.isLean = false;
    this.projection = projection;
    this.populatePaths = [];
  }
  lean(value = true) { this.isLean = value !== false; return this; }
  select(value) { this.projection = value; return this; }
  populate(value) { this.populatePaths.push(...(Array.isArray(value) ? value : [value])); return this; }
  async exec() {
    let doc = await this.run();
    if (!doc) return null;
    const Model = doc.__pgModel;
    for (const populate of this.populatePaths) {
      const path = typeof populate === 'string' ? populate : populate && populate.path;
      if (path) await populateOne(Model, doc, path);
    }
    if (this.isLean) {
      const data = doc.__pgBaseToObject({ depopulate: false });
      return projectObject(data, this.projection);
    }
    if (this.projection) return materialize(Model, doc.__pgBaseToObject({ depopulate: true }), this.projection);
    return doc;
  }
  then(resolve, reject) { return this.exec().then(resolve, reject); }
  catch(reject) { return this.exec().catch(reject); }
  finally(callback) { return this.exec().finally(callback); }
}

async function withLockedRows(Model, callback) {
  const table = await ensureTable(Model);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`wreddi:${Model.collection.name}`]);
    const result = await client.query(`SELECT mongo_id, document FROM ${table} FOR UPDATE`);
    const rows = result.rows.map((row) => ({ key: row.mongo_id, document: decode(row.document) }));
    const value = await callback(client, table, rows);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw normalizeDbError(error);
  } finally {
    client.release();
  }
}

function findMatch(Model, rows, filter) {
  const casted = castFilter(Model, filter);
  return rows.filter((row) => new MongoQuery(casted).test(row.document));
}

async function updateRows(Model, filter, update, options = {}, mode = 'one', returnDocument = false) {
  const castedUpdate = castUpdate(Model, filter, update);
  return withLockedRows(Model, async (client, table, rows) => {
    const matches = findMatch(Model, rows, filter);
    const selected = mode === 'many' ? matches : matches.slice(0, 1);
    const before = selected.length ? clone(selected[0].document) : null;
    if (!selected.length && options.upsert) {
      const seed = equalitySeed(castFilter(Model, filter));
      const doc = new Model(seed);
      let base = doc.toObject({ depopulate: true, virtuals: false, minimize: false });
      applyUpdate(base, castedUpdate, filter, true);
      const newDoc = new Model(base);
      await newDoc.validate();
      const data = newDoc.toObject({ depopulate: true, virtuals: false, minimize: false });
      const key = idFor(data);
      await client.query(`INSERT INTO ${table} (mongo_id, document, migrated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (mongo_id) DO UPDATE SET document = EXCLUDED.document, migrated_at = now()`, [key, encode(data)]);
      return returnDocument ? attachDocumentHelpers(Model, newDoc, null) : { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: data._id, n: 1, nModified: 0 };
    }
    let modifiedCount = 0;
    for (const row of selected) {
      const updated = applyUpdate(clone(row.document), castedUpdate, filter, false);
      const key = idFor(updated);
      await client.query(`UPDATE ${table} SET document = $2::jsonb, migrated_at = now() WHERE mongo_id = $1`, [key, encode(updated)]);
      row.updated = updated;
      modifiedCount++;
    }
    if (returnDocument) {
      const result = selected.length ? (options.new || options.returnDocument === 'after' ? selected[0].updated : before) : null;
      return result ? materialize(Model, result) : null;
    }
    return { acknowledged: true, matchedCount: selected.length, modifiedCount, upsertedCount: 0, n: selected.length, nModified: modifiedCount };
  });
}

async function deleteRows(Model, filter, mode = 'one') {
  return withLockedRows(Model, async (client, table, rows) => {
    const matches = findMatch(Model, rows, filter);
    const selected = mode === 'many' ? matches : matches.slice(0, 1);
    for (const row of selected) await client.query(`DELETE FROM ${table} WHERE mongo_id = $1`, [row.key]);
    return { acknowledged: true, deletedCount: selected.length, n: selected.length };
  });
}

function createModel(name, schema) {
  const Model = mongoose.models[name] || mongoose.model(name, schema);
  registered.set(name, Model);
  const originalFind = Model.find.bind(Model);
  const originalUpdateOne = Model.updateOne.bind(Model);
  Model.__mongooseFind = originalFind;
  Model.__mongooseUpdateOne = originalUpdateOne;

  Model.prototype.save = function () { return persistDocument(Model, this); };
  Model.prototype.populate = function (paths) { return populateDocument(Model, this, paths); };

  Model.find = (filter = {}, projection = null) => new PgQuery(Model, 'find', filter, projection);
  Model.findOne = (filter = {}, projection = null) => new PgQuery(Model, 'findOne', filter, projection);
  Model.findById = (id, projection = null) => new PgQuery(Model, 'findOne', { _id: id }, projection);
  Model.countDocuments = (filter = {}) => new PgQuery(Model, 'count', filter);
  Model.estimatedDocumentCount = async () => (await readRows(Model)).length;
  Model.exists = async (filter = {}) => {
    const doc = await Model.findOne(filter).select('_id').lean();
    return doc ? { _id: doc._id } : null;
  };
  Model.create = async (...args) => {
    const input = args.length === 1 ? args[0] : args;
    if (Array.isArray(input)) {
      const docs = [];
      for (const item of input) docs.push(await new Model(item).save());
      return docs;
    }
    return new Model(input).save();
  };
  Model.insertMany = async (items) => Promise.all(items.map((item) => new Model(item).save()));
  Model.findOneAndUpdate = (filter, update, options = {}) => new PgMutationQuery(
    () => updateRows(Model, filter, update, options, 'one', true),
    options.projection || options.select || null
  );
  Model.findByIdAndUpdate = (id, update, options = {}) => Model.findOneAndUpdate({ _id: id }, update, options);
  Model.updateOne = (filter, update, options = {}) => updateRows(Model, filter, update, options, 'one', false);
  Model.updateMany = (filter, update, options = {}) => updateRows(Model, filter, update, options, 'many', false);
  Model.deleteOne = (filter) => deleteRows(Model, filter, 'one');
  Model.deleteMany = (filter = {}) => deleteRows(Model, filter, 'many');
  Model.findOneAndDelete = async (filter) => {
    return withLockedRows(Model, async (client, table, rows) => {
      const row = findMatch(Model, rows, filter)[0];
      if (!row) return null;
      await client.query(`DELETE FROM ${table} WHERE mongo_id = $1`, [row.key]);
      return materialize(Model, row.document);
    });
  };
  Model.findByIdAndDelete = (id) => Model.findOneAndDelete({ _id: id });
  Model.distinct = async (field, filter = {}) => {
    const docs = await Model.find(filter).lean();
    const values = [];
    for (const doc of docs) {
      const value = getPath(doc, field);
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined && !values.some((existing) => encode(existing) === encode(item))) values.push(item);
      }
    }
    return values;
  };
  Model.aggregate = async (pipeline = []) => {
    const docs = (await readRows(Model)).map((row) => row.document);
    return new Aggregator(pipeline).run(docs);
  };
  Model.bulkWrite = async (operations = []) => {
    let matchedCount = 0, modifiedCount = 0, deletedCount = 0, upsertedCount = 0, insertedCount = 0;
    for (const operation of operations) {
      if (operation.updateOne) {
        const result = await Model.updateOne(operation.updateOne.filter, operation.updateOne.update, { upsert: operation.updateOne.upsert });
        matchedCount += result.matchedCount || 0; modifiedCount += result.modifiedCount || 0; upsertedCount += result.upsertedCount || 0;
      } else if (operation.deleteOne) {
        const result = await Model.deleteOne(operation.deleteOne.filter); deletedCount += result.deletedCount || 0;
      } else if (operation.deleteMany) {
        const result = await Model.deleteMany(operation.deleteMany.filter); deletedCount += result.deletedCount || 0;
      } else if (operation.deleteOne) {
        const result = await Model.deleteOne(operation.deleteOne.filter); deletedCount += result.deletedCount || 0;
      } else if (operation.insertOne) {
        await Model.create(operation.insertOne.document); insertedCount++;
      } else {
        throw new Error('Unsupported bulkWrite operation in Neon adapter.');
      }
    }
    return { acknowledged: true, matchedCount, modifiedCount, deletedCount, upsertedCount, insertedCount };
  };

  // A small compatibility surface for the one raw collection operation used
  // by the app's startup plan migration.
  Model.collection.findOne = async (filter = {}) => Model.findOne(filter).lean();
  Model.collection.updateOne = (filter, update, options = {}) => Model.updateOne(filter, update, options);
  return Model;
}

module.exports = { createModel };
