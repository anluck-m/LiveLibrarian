import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiRouter from './src/routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use('/api', apiRouter);
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`librarian server running at http://localhost:${PORT}`);
});
