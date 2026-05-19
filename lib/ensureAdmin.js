function ensureAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!process.env.ADMIN_ID) {
        return res.status(503).json({ success: false, message: 'Admin not configured' });
    }
    if (String(req.user._id) !== String(process.env.ADMIN_ID)) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    return next();
}

module.exports = { ensureAdmin };
