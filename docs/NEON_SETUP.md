# Neon setup for Wreddi

The app now reads and writes its existing document-shaped data through Neon PostgreSQL JSONB tables. It does not need the MongoDB Atlas connection string at runtime.

## Configure and run

1. From the project folder, copy `.env.example` to `.env`.
2. Set `NEON_DATABASE_URL` to the connection string for the intended Neon project, branch, and database. Use a newly rotated password because the earlier connection credentials were shared in chat. Keep `.env` private and out of Git.
3. Fill in the other required app secrets in `.env`: `ADMIN_KEY`, `JWT_ACCESS_SECRET`, and `JWT_REFRESH_SECRET`.
4. Run `npm install`, then `npm test`, then `npm start`.

The app creates each collection table the first time it needs it. Tables use this layout in the `public` schema:

- `mongo_id TEXT PRIMARY KEY`
- `document JSONB NOT NULL`
- `migrated_at TIMESTAMPTZ`

For already migrated data, each app collection table must contain the documents in its `document` JSONB column, with the document ID represented in BSON Extended JSON as the migration script produced it. Keep the table names as the Mongo collection names (for example, `students`, `courses`, and `questions`). The adapter creates missing tables and relevant unique indexes, but it does not move or delete data from any other tables.

## Safety and limitations

Back up the Neon database before starting the app against it. Do not rerun a destructive import or delete the staging table unless you have verified the destination data. This change does not remove old or unrelated Neon tables.

This is a compatibility bridge: the app keeps its existing Mongoose schemas and Mongo-style query behavior, while documents are stored in PostgreSQL JSONB. Queries currently read a collection's JSONB rows and apply Mongo-style matching in the Node process. This is convenient for transferring the existing app with minimal route changes, but it is not equivalent to a normalized relational redesign and can become expensive for very large collections or heavy traffic.

The local automated test suite checks app logic and JavaScript syntax, but it does not authenticate against your Neon instance. Confirm the app starts and check several real reads and writes in a staging branch before directing users to it.
