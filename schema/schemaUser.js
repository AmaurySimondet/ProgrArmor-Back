const mongoose = require("mongoose");
const findOrCreate = require('mongoose-findorcreate');
const passportLocalMongoose = require("passport-local-mongoose");
const { Schema } = mongoose;

const userSchema = mongoose.Schema(
  {
    facebookId: { type: String },
    googleId: { type: String },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      unique: true,
      required: true
    },
    fName: {
      type: String,
      trim: true,
      required: true,
      unique: false
    },
    lName: {
      type: String,
      trim: true,
      required: true,
      unique: false
    },
    profilePic: {
      type: String
    },
    followers: [{ type: Schema.Types.ObjectId, ref: 'User', default: [] }],
    following: [{ type: Schema.Types.ObjectId, ref: 'User', default: [] }],
    lastLogin: {
      type: Date,
      default: Date.now
    },
    regularityScore: {
      average: Number,
      currentStreak: Number,
      bestStreak: Number,
      lastUpdated: Date
    },
    language: {
      type: String,
      default: "fr"
    }
  },
  { timestamps: true }
);

var options = {
  errorMessages: {
    MissingPasswordError: "T'as pas donné de mot de passe !",
    AttemptTooSoonError: "Ton compte est actuellement verrouillé. Réessaye plus tard !",
    TooManyAttemptsError: "Ton compte est verrouillé à cause de trop de tentatives de connexion ! Ralenti un peu !",
    NoSaltValueStoredError: "Authentification impossible. Aucun salt stocké !",
    IncorrectPasswordError: "Mot de passe ou email incorrect !",
    IncorrectUsernameError: "Mot de passe ou email incorrect !",
    MissingUsernameError: "Aucun email n'a été donné !",
    UserExistsError: 'Un utilisateur avec cet email existe déjà !'
  },
  usernameField: "email",
  passwordField: "password"
};

userSchema.plugin(passportLocalMongoose, options);
userSchema.plugin(findOrCreate);

userSchema.index({ createdAt: -1 });

module.exports = mongoose.model("User", userSchema);