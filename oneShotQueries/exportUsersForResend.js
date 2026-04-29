const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config();
const User = require("../schema/schemaUser");

const uri = process.env.mongoURL;
const dbName = process.env.DATABSE;

if (!uri) {
  console.error("Variable d'environnement mongoURL manquante.");
  process.exit(1);
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) return "";
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

async function exportUsersForResend() {
  try {
    await mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
  });

    const users = await User.find(
      {},
      { email: 1, fName: 1, lName: 1, language: 1 }
    ).lean();

    const header = ["mail", "fname", "lname", "language"];
    const rows = users.map((user) =>
      [
        escapeCsvValue(user.email || ""),
        escapeCsvValue(user.fName || ""),
        escapeCsvValue(user.lName || ""),
        escapeCsvValue(user.language || "fr"),
      ].join(",")
    );

    const csvContent = [header.join(","), ...rows].join("\n");
    const outputPath = path.resolve(process.cwd(), "users_resend.csv");

    fs.writeFileSync(outputPath, csvContent, "utf8");
    console.log(`Export termine: ${users.length} users -> ${outputPath}`);
  } catch (error) {
    console.error("Erreur pendant l'export CSV:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

exportUsersForResend();
