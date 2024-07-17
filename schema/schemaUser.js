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
    modeSombre: {
      type: Boolean
    },
    seances: Array,
    checkItems: Object,
    programmes: [{ type: Schema.Types.ObjectId, ref: 'Programme' }],
  },
  { timestamps: { createdAt: "created_at" } }
);

userSchema.plugin(passportLocalMongoose, { usernameField: "email" });
userSchema.plugin(findOrCreate);

module.exports = mongoose.model("User", userSchema);