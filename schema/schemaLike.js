const mongoose = require("mongoose");
const { Schema } = mongoose;

const likeSchema = mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
    },
    programme: { type: Schema.Types.ObjectId, ref: 'Programme' },
    user: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: "created_at" } }
);

module.exports = mongoose.model("Like", likeSchema);