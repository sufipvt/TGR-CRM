// CSV upload handling for lead import: in memory, 5 MB max, .csv only.
const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.originalname.toLowerCase().endsWith('.csv')) cb(null, true);
    else cb(new Error('Only .csv files are allowed'));
  }
});

module.exports = { upload };
