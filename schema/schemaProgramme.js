const mongoose = require("mongoose");
const { Schema } = mongoose;

const programmeSchema = mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    materiel: {
      type: Array,
      required: true
    },
    programme: {
      type: Array,
      required: true
    },
    type: {
      type: String,
      required: true
    },
    niveau: {
      type: String,
      required: true
    },
    duree: {
      type: String,
      required: true
    },
    description: {
      type: String,
    },
    titre: {
      type: String,
    },
    seancesSemaine: {
      type: Number,
      required: true
    },
    seancesTotal: {
      type: Number,
      required: true
    },
    likes: [{ type: Schema.Types.ObjectId, ref: 'Like' }],
    comments: [{ type: Schema.Types.ObjectId, ref: 'Comment' }]

  },
  { timestamps: { createdAt: "created_at" } }
);

module.exports = mongoose.model("Programme", programmeSchema);