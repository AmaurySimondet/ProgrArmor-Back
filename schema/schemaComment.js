const mongoose = require("mongoose");
const { Schema } = mongoose;

const commentSchema = mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
    },
    programme: { type: Schema.Types.ObjectId, ref: 'Programme' },
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    comment: { type: String, required: true }
  },
  { timestamps: { createdAt: "created_at" } }
);

module.exports = mongoose.model("Comment", commentSchema);