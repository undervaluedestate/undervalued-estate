import dotenv from 'dotenv';
import { app } from './app';

dotenv.config();

const port = process.env.PORT || 4000;
app.listen(port as number, () => {
  console.log(`Undervalued Estate API listening on http://localhost:${port}`);
});
