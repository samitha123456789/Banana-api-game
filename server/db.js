require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error('MONGODB_URI is not set in the environment (.env)');
}

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true
  }
});

let dbInstance;

/**
 * Connect to MongoDB 
 * @param {string} [dbName]
 * @returns {Promise<import('mongodb').Db>}
 */
async function connectToDatabase(dbName = process.env.MONGODB_DB_NAME || 'banana') {
  if (dbInstance) {
    return dbInstance;
  }

  await client.connect();
  const db = client.db(dbName);

  // ping to confirm a successful connection
  await db.command({ ping: 1 });

  console.log(`Connected to MongoDB database "${dbName}"`);
  dbInstance = db;
  return dbInstance;
}

module.exports = {
  client,
  connectToDatabase
};
