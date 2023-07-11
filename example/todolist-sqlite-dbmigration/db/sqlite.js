const sqlite3 = require('sqlite3').verbose();

let db = new sqlite3.Database('./database.db', (err) => {
  if (err) {
    console.error(err.message);
  }
  console.log('Connected to the sqlite database.');
});

db.serialize(() => {
  db.run('CREATE TABLE IF NOT EXISTS todos (id TEXT PRIMARY KEY, todo TEXT NOT NULL)', (err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Todo table created successfully.');
  });
});

module.exports = db;