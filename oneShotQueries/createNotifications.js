const mongoose = require("mongoose");
const User = require("../schema/schemaUser");
const Notification = require("../schema/notification");
require("dotenv").config();

// Connect to MongoDB
mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

(async () => {
    try {
        console.log("Starting notification creation for existing follow relationships...");

        // Get all users with their followers and following lists
        const users = await User.find({}).select('_id followers following');
        let notificationsToCreate = [];

        // Process each user's followers
        for (const user of users) {
            // Create notifications for each follower relationship
            for (const followerId of user.followers) {
                // Check if notification already exists
                const existingNotification = await Notification.findOne({
                    type: 'follow',
                    fromUser: followerId,
                    forUser: user._id
                });

                if (!existingNotification) {
                    notificationsToCreate.push({
                        type: 'follow',
                        fromUser: followerId,
                        forUser: user._id,
                        read: false, // Mark as read since these are historical
                        createdAt: new Date(),
                        updatedAt: new Date()
                    });
                }
            }
        }

        // Batch insert all notifications
        if (notificationsToCreate.length > 0) {
            await Notification.insertMany(notificationsToCreate);
            console.log(`Successfully created ${notificationsToCreate.length} notifications`);
        } else {
            console.log("No new notifications needed to be created");
        }

        console.log("Notification creation completed successfully");
    } catch (err) {
        console.error("Error creating notifications:", err);
    } finally {
        await mongoose.connection.close();
        console.log("Database connection closed");
    }
})(); 