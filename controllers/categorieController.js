const categorie = require('../lib/categorie');

module.exports = function (app) {
    // Get all categories
    app.get('/categories', async (req, res) => {
        try {
            const categorieType = req.query.categorieType; // Optional query parameter
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 7;
            const search = req.query.search;

            const { categories, total } = await categorie.getAllCategories(categorieType, page, limit, search);
            res.json({
                success: true,
                categories,
                pagination: {
                    page,
                    limit,
                    total,
                    hasMore: total > page * limit
                }
            });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Get an categorie by ID
    app.get('/category', async (req, res) => {
        try {
            const categorieId = req.query.id;
            const categorieName = req.query.name;
            const fields = req.query.fields; // Optional query parameter
            const categoryReturned = await categorie.getCategoryById(categorieId, categorieName, fields);
            res.json({ success: true, categoryReturned });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}
