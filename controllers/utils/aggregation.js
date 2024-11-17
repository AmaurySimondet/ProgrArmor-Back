/**
* This file contains utility functions for creating aggregation pipelines
* for MongoDB queries.
*/

const mongoose = require('mongoose');

/**
 * Create an aggregation pipeline to filter sets by date.
 * @param { } userId 
 * @returns 
 */
function filterOnDatesAgg(userId) {
    return [
        { $group: { _id: null, lastRecordedDate: { $max: "$date" } } },
        {
            // Step 2: Calculate six weeks before this latest date
            $addFields: {
                cutoffDate: {
                    $dateSubtract: {
                        startDate: "$lastRecordedDate",
                        unit: "week",
                        amount: 3 * 4
                    }
                }
            }
        },
        {
            // Step 3: Match documents with dates after the cutoff date
            $lookup: {
                from: "seancesets",
                as: "filteredSets",
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $gte: ["$date", "$$cutoffDate"]
                            },
                            user: mongoose.Types.ObjectId(userId)
                        }
                    }
                ],
                let: { cutoffDate: "$cutoffDate" }
            }
        },
        { $unwind: "$filteredSets" },
        { $replaceRoot: { newRoot: "$filteredSets" } }
    ]
}

module.exports = { filterOnDatesAgg }