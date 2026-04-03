const success = require("../lib/success");

module.exports = function (router) {
    router.post("/usersuccess/newSuccess", async (req, res) => {
        try {
            const user = req.body?.user || req.query?.user;
            const ttlMinutes = req.body?.ttlMinutes ?? req.query?.ttlMinutes ?? 5;
            const result = await success.processNewSuccesses(user, Number(ttlMinutes));
            res.json({ success: true, ...result });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    router.put("/usersuccess/acknowledge", async (req, res) => {
        try {
            const user = req.body?.user || req.query?.user;
            const many = Array.isArray(req.body?.userSuccessIds) ? req.body.userSuccessIds : [];
            const single = req.body?.userSuccessId ? [req.body.userSuccessId] : [];
            const ids = many.length ? many : single;
            await success.acknowledgeUserSuccesses(user, ids);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    router.put("/usersuccess/profileUse", async (req, res) => {
        try {
            const user = req.body?.user || req.query?.user;
            const many = Array.isArray(req.body?.successIds) ? req.body.successIds : [];
            const single = req.body?.successId ? [req.body.successId] : [];
            const ids = many.length ? many : single;
            await success.setProfileUse(user, ids);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    router.get("/success/all", async (req, res) => {
        try {
            const user = req.query?.user;
            const page = req.query?.page;
            const limit = req.query?.limit;
            const result = await success.getAllSuccessesForUser(user, { page, limit });
            res.json({ success: true, ...result });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
};
