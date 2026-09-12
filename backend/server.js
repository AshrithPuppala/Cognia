require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const reasonRoute = require('./routes/reason');

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'cognia-backend' });
});

app.use('/reason', reasonRoute);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Cognia backend listening on http://localhost:${PORT}`);
});
