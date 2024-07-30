const mongoose = require("mongoose");
const { Schema } = mongoose;

// Define the Seance schema
const seanceSchema = new Schema(
    {
        _id: Schema.Types.ObjectId,
        name: { type: String, required: true },
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    },
    {
        timestamps: { createdAt: "createdAt", updatedAt: "updatedAt", date: "date" }
    }
);

// Create and export the model
module.exports = mongoose.model("Seance", seanceSchema);
