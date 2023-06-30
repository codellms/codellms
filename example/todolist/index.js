const express = require('express');
const app = express();

// Routes
app.use('/', require('./src/routes/todoRoutes'));

// Start server
const port = 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
