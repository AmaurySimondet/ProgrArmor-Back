const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Import models
const Variation = require('../schema/variation');
const Type = require('../schema/type');
const { normalizeString } = require('../utils/string');

const mongoURL = process.env.mongoURL;
const DATABASE = process.env.DATABASE;

// Path to CSV file
const csvFilePath = path.join(__dirname, 'data', 'exercises - muscu.csv');

async function run() {
    if (!mongoURL) {
        console.error("mongoURL environment variable is missing");
        process.exit(1);
    }

    try {
        await mongoose.connect(mongoURL + DATABASE);
        console.log("Connected to MongoDB");

        // 1. Fetch all types to map typeId -> megatypeId
        console.log("Fetching types...");
        const types = await Type.find({}).select('_id megatype').lean();
        const typeMegatypeMap = new Map();
        types.forEach(t => {
            if (t.megatype) {
                typeMegatypeMap.set(t._id.toString(), t.megatype.toString());
            }
        });
        console.log(`Loaded ${types.length} types.`);

        // Read CSV
        const fileContent = fs.readFileSync(csvFilePath, 'utf-8');
        const lines = fileContent.split(/\r?\n/);

        // Parse header
        const headerLine = lines[0];
        const headers = headerLine.split(',');

        // Map header names to indices
        const colMap = {};
        headers.forEach((h, i) => {
            colMap[h.trim()] = i;
        });

        let updatedCount = 0;
        let createdCount = 0;
        let skippedCount = 0;

        // Iterate over data lines
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Simple CSV split (assuming no commas in fields based on sample)
            // For more robustness with quotes, a regex or parser lib is better, 
            // but proceeding with split as per environment constraints.
            const values = line.split(',');

            // Helper to get value by column name
            const getVal = (colName) => {
                const idx = colMap[colName];
                if (idx === undefined || idx >= values.length) return undefined;
                return values[idx].trim();
            };

            const isExerciceStr = getVal('isExercice');
            const picture = getVal('picture');
            const typeId = getVal('type');
            const nameEn = getVal('name_en');
            const nameFr = getVal('name_fr');
            const toCreateStr = getVal('toCreate');
            const alreadyExistsStr = getVal('alreadyExists');
            const _id = getVal('_id');
            const popularityStr = getVal('popularity');

            // Variations
            const variations = [];
            for (let v = 1; v <= 4; v++) {
                const vId = getVal(`variation_${v}`);
                if (vId && vId.length === 24) {
                    variations.push(vId);
                }
            }

            const isExercice = isExerciceStr === 'TRUE';
            const alreadyExists = alreadyExistsStr === 'TRUE';
            const popularity = popularityStr ? parseInt(popularityStr, 10) : 0;

            if (!nameFr || !nameEn || !typeId) {
                console.warn(`Skipping line ${i + 1}: Missing required fields (name or type)`);
                skippedCount++;
                continue;
            }

            // Find megatype
            const megatypeId = typeMegatypeMap.get(typeId);

            const variationData = {
                isExercice,
                picture,
                type: typeId,
                name: {
                    fr: nameFr,
                    en: nameEn
                },
                normalizedName: {
                    fr: normalizeString(nameFr),
                    en: normalizeString(nameEn)
                },
                popularity,
                equivalentTo: variations,
                megatype: megatypeId || undefined,
                selfmade: false,
                verified: true,
                createdAt: new Date(),
                updatedAt: new Date()
            };

            if (alreadyExists && _id) {
                // Update
                await Variation.findByIdAndUpdate(_id, { $set: variationData });
                updatedCount++;
                // console.log(`Updated variation ${_id} (${nameEn})`);
            } else {
                // Create
                // If _id is provided in CSV but alreadyExists is FALSE, normally we let Mongo generate _id,
                // or if we want to force a specific ID (migration), we can set it.
                // The user said: "else, same but we will need to create the variation document"
                // Usually creations don't have ID in CSV, or if they do, we might want to use it if it's a valid ObjectId.
                // Checking sample: created rows have empty _id.

                const newVar = new Variation(variationData);
                newVar._id = new mongoose.Types.ObjectId();
                await newVar.save();
                createdCount++;
                console.log(`Created variation (${nameEn})`);
            }
        }

        console.log(`Finished processing.`);
        console.log(`Updated: ${updatedCount}`);
        console.log(`Created: ${createdCount}`);
        console.log(`Skipped: ${skippedCount}`);

    } catch (err) {
        console.error("Error:", err);
    } finally {
        await mongoose.disconnect();
        console.log("Disconnected from MongoDB");
    }
}

run();

