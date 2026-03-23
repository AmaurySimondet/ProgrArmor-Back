//Définition des modules
const os = require('os');
const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const passport = require("passport");
const session = require('cookie-session');
const cors = require('cors');
require('dotenv').config();
const { timingMiddleware } = require('./utils/timing');
const { sessionConfig, configurePassport } = require('./lib/login');

// Ensure environment variables are set
const mongoURL = process.env.mongoURL;
const JWT_SECRET = process.env.JWT_SECRET;
const DATABASE = process.env.DATABASE;

if (!mongoURL || !JWT_SECRET || !DATABASE) {
  console.error("Error: Required environment variables are not set.");
  process.exit(1);
}

const MONGO_URI = mongoURL + DATABASE;
const MAX_POOL_SIZE = Number(process.env.MONGO_MAX_POOL_SIZE || 5);

const globalCache = global;
if (!globalCache.__mongoose) {
  globalCache.__mongoose = { conn: null, promise: null };
}
const cached = globalCache.__mongoose;

async function connectDB() {
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  if (!cached.promise) {
    console.log("Connecting to Mongo...");
    cached.promise = mongoose
      .connect(MONGO_URI, {
        maxPoolSize: MAX_POOL_SIZE,
        minPoolSize: 0,
        serverSelectionTimeoutMS: 5000,
        tls: true,
        tlsAllowInvalidCertificates: true // ⚠️ uniquement pour test
      })
      .then((connection) => {
        console.log("Connected to mongoDB - " + DATABASE);
        return connection;
      })
      .catch((e) => {
        cached.promise = null;
        console.log("Error while DB connecting");
        console.log(e);
        throw e;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

//On définit notre objet express nommé app
const app = express();

// Use centralized session configuration
app.use(session(sessionConfig));

//Body Parser
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true, parameterLimit: 50000 }));
app.use(express.raw({ limit: '50mb' }));

// Lazy DB connection: in serverless, each invocation reuses cached promise/connection.
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    res.status(500).json({ error: "Database connection failed" });
  }
});

//PASSPORT
app.use(passport.initialize());
app.use(passport.session());
configurePassport();

//CORS
app.use(cors());

//Définition du routeur
const router = express.Router();
app.use(timingMiddleware);
app.use("/user", router);

// Public routes that don't require authentication
const publicRoutes = ['/login', '/verifyToken', '/signup', '/auth/facebook', '/auth/facebook/authenticate', '/auth/google', '/auth/google/authenticate', '/admin/inscription'];

// Protect all routes except public ones using Passport's JWT strategy
router.use((req, res, next) => {
  if (publicRoutes.includes(req.path)) {
    return next();
  }
  passport.authenticate('jwt', { session: false })(req, res, next);
});

require(__dirname + "/controllers/userController")(router);
require(__dirname + "/controllers/adminController")(router);
require(__dirname + "/controllers/seanceController")(router);
require(__dirname + "/controllers/exerciceTypeController")(router);
require(__dirname + "/controllers/exerciceController")(router);
require(__dirname + "/controllers/categorieTypeController")(router);
require(__dirname + "/controllers/setController")(router);
require(__dirname + "/controllers/categorieController")(router);
require(__dirname + "/controllers/awsImageController")(router);
require(__dirname + "/controllers/notificationController")(router);
require(__dirname + "/controllers/weatherController")(router);
require(__dirname + "/controllers/reactionController")(router);
require(__dirname + "/controllers/feedbackController")(router);
require(__dirname + "/controllers/fatSecretController")(router);
require(__dirname + "/controllers/variationController")(router);
require(__dirname + "/controllers/typesController")(router);
require(__dirname + "/controllers/megatypesController")(router);
require(__dirname + "/controllers/shiftController")(router);

// Function to get the first non-internal IP address
const getIPAddress = () => {
  const networkInterfaces = os.networkInterfaces();
  for (const iface in networkInterfaces) {
    for (const alias of networkInterfaces[iface]) {
      if (alias.family === 'IPv4' && !alias.internal) {
        return alias.address;
      }
    }
  }
  return 'localhost'; // fallback if no external IP is found
};

const PORT = process.env.PORT || 8800;
console.log("PORT", PORT);
console.log("process.env.VERCEL", process.env.VERCEL);

if (process.env.VERCEL !== "1") {
  const ip = getIPAddress();
  app.listen(PORT, ip, () => {
    console.log(`Server running on http://${ip}:${PORT}`);
  });
}

module.exports = app;