//Définition des modules
const os = require('os');
const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const passport = require("passport");
const session = require('cookie-session');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const { timingMiddleware } = require('./utils/timing');
const { sessionConfig, configurePassport } = require('./lib/login');
const { server: serverConstants } = require('./constants');

// Ensure environment variables are set
const { MONGO_URL: mongoURL, JWT_SECRET, DATABASE } = serverConstants;

if (!mongoURL || !JWT_SECRET || !DATABASE) {
  console.error("Error: Required environment variables are not set.");
  process.exit(1);
}

const MONGO_URI = mongoURL + DATABASE;
const { MONGO_MAX_POOL_SIZE, PORT, HOST } = serverConstants;
const allowInvalidMongoCerts = process.env.NODE_ENV !== 'production';
const isProduction = process.env.NODE_ENV === 'production';
const configuredOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const defaultClientOrigin = process.env.URL_CLIENT ? process.env.URL_CLIENT.trim() : "";

function normalizeOrigin(origin) {
  const trimmed = origin.trim();
  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch (_) {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}

const allowedOrigins = [...new Set([
  ...configuredOrigins,
  ...(defaultClientOrigin ? [defaultClientOrigin] : [])
].map(normalizeOrigin))];

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
        maxPoolSize: MONGO_MAX_POOL_SIZE,
        minPoolSize: 0,
        serverSelectionTimeoutMS: 5000,
        tls: true,
        // Keep permissive cert validation only outside production.
        tlsAllowInvalidCertificates: allowInvalidMongoCerts
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
// Trust first proxy hop (e.g. Render/Heroku/Nginx) so req.ip uses X-Forwarded-For correctly.
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);

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

// Basic security headers with API-friendly defaults.
app.use(helmet({
  crossOriginResourcePolicy: false
}));

//CORS
const corsOptions = {
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  origin(origin, callback) {
    // Allow mobile apps, server-to-server calls and non-browser clients.
    if (!origin) return callback(null, true);
    if (!isProduction) {
      const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
      if (isLocalOrigin) {
        return callback(null, true);
      }
    }
    const normalizedOrigin = normalizeOrigin(origin);
    if (allowedOrigins.length === 0 || allowedOrigins.includes(normalizedOrigin)) {
      return callback(null, true);
    }
    return callback(null, false);
  }
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

//Définition du routeur
const router = express.Router();
app.use(timingMiddleware);
app.use("/user", router);

// Public routes that don't require authentication
const publicRoutes = ['/login', '/verifyToken', '/signup', '/forgotPassword', '/resetPasswordWithToken', '/auth/facebook', '/auth/facebook/authenticate', '/auth/google', '/auth/google/authenticate', '/admin/inscription'];
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 25 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please try again later." }
});
const strictResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 10 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many reset attempts, please try again later." }
});

router.use('/login', authLimiter);
router.use('/signup', authLimiter);
router.use('/verifyToken', authLimiter);
router.use('/forgotPassword', strictResetLimiter);
router.use('/resetPasswordWithToken', strictResetLimiter);

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
require(__dirname + "/controllers/setController")(router);
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
require(__dirname + "/controllers/successController")(router);
require(__dirname + "/controllers/variationProgressionEdgeController")(router);

console.log("PORT", PORT);
console.log("process.env.VERCEL", process.env.VERCEL);
console.log("process.env.DATABASE", process.env.DATABASE);

function getLocalExternalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal (i.e., 127.0.0.1), non-ipv4, docker, etc.
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

if (process.env.VERCEL !== "1") {
  app.listen(PORT, HOST, function () {
    // Affichage de l'IP réelle de la machine (externe, pas 0.0.0.0)
    const externalIp = getLocalExternalIp() || HOST;
    const address = this.address();
    // address peut être un objet (host/port) ou une string (socket path)
    if (typeof address === 'string') {
      console.log(`Server running on ${address}`);
    } else {
      console.log(`Server running on http://${externalIp}:${address.port} (bound: ${address.address})`);
    }
  });
}

module.exports = app;