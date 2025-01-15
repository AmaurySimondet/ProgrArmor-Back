const Feedback = require('../schema/feedback');

async function createFeedback(userId, feedbackData) {
    try {
        const feedback = new Feedback({
            type: feedbackData.type,
            text: feedbackData.text,
            media: feedbackData.media || [],
            user: userId
        });

        await feedback.save();
        return feedback;
    } catch (error) {
        throw error;
    }
}

async function getFeedback(query = {}, page = 1, limit = 10) {
    try {
        const skip = (page - 1) * limit;
        const total = await Feedback.countDocuments(query);

        const feedback = await Feedback.find(query)
            .populate('user', 'profilePic fName lName email')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        return {
            feedback,
            total,
            page,
            limit,
            hasMore: total > skip + limit
        };
    } catch (error) {
        throw error;
    }
}

async function updateFeedbackStatus(feedbackId, status) {
    try {
        const feedback = await Feedback.findByIdAndUpdate(
            feedbackId,
            { status },
            { new: true }
        );

        if (!feedback) {
            throw new Error('Feedback not found');
        }

        return feedback;
    } catch (error) {
        throw error;
    }
}

module.exports = {
    createFeedback,
    getFeedback,
    updateFeedbackStatus
}; 