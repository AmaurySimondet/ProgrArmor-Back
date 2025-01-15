//Définition des modules
const os = require('os');
const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const passport = require("passport");
const User = require("./schema/schemaUser.js");
const session = require('cookie-session');
const cors = require('cors');
require('dotenv').config();
const { timingMiddleware } = require('./utils/timing');

//Depreciation warnings
mongoose.set('useNewUrlParser', true);
mongoose.set('useFindAndModify', false);
mongoose.set('useCreateIndex', true);

// Ensure environment variable is set
const mongoURL = process.env.mongoURL;

if (!mongoURL) {
  console.error("Error: mongoURL environment variable is not set.");
  process.exit(1);
}

// Connection to the database
mongoose
  .connect(mongoURL + process.env.DATABASE, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    useCreateIndex: true,
    useFindAndModify: false,
  })
  .then(() => {
    console.log("Connected to mongoDB");
  })
  .catch((e) => {
    console.log("Error while DB connecting");
    console.log(e);
  });

//On définit notre objet express nommé app
const app = express();

app.use(session({
  secret: "Our little secret.",
  resave: false,
  saveUninitialized: false
}));

//Body Parser
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true, parameterLimit: 50000 }));
app.use(express.raw({ limit: '50mb' }));

//PASSPORT
app.use(passport.initialize());
app.use(passport.session());
passport.use(User.createStrategy());
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());
const LocalStrategy = require('passport-local').Strategy;
passport.use(new LocalStrategy(User.authenticate()));

//CORS
app.use(cors());

//Définition du routeur
const router = express.Router();
app.use(timingMiddleware);
app.use("/user", router);
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

// Define and set up the port
const port = process.env.PORT || 8800;

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

const ipAddress = getIPAddress();

app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on http://${ipAddress}:${port}`);
});