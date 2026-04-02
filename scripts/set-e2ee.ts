import express from 'express';
import { encrypt } from '../src/crypto/secrets.js';
import Database from 'better-sqlite3';

const db = new Database('./data/ithildin.db');
const app = express();
app.use(express.urlencoded({ extended: true }));

app.get('/', (_req, res) => {
  res.send(`
    <h2>Set E2EE Password</h2>
    <form method="post">
      <label>Vault Encryption Password: <input name="pw" type="password" autofocus></label>
      <br><br>
      <button type="submit">Save</button>
    </form>
  `);
});

app.post('/', (req, res) => {
  const pw = req.body.pw;
  console.log('Got password, length:', pw?.length);
  if (pw) {
    db.prepare('UPDATE user_configs SET vault_encryption_password = ? WHERE user_id = 1').run(encrypt(pw));
    res.send('<h2>Saved!</h2><p>You can close this tab.</p>');
  } else {
    res.send('<h2>No password provided</h2>');
  }
});

app.listen(3002, () => console.log('Open http://localhost:3002'));
