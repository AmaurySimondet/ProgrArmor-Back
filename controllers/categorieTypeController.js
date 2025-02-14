const categorieType = require('../lib/categorieType');

module.exports = function (app) {
    // Get all category types
    app.get('/categorietypes', async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 7;

            const { categorieTypes, total } = await categorieType.getAllCategorieTypes(page, limit);
            res.json({
                success: true,
                categorieTypes,
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
    // Get a category type by ID
    app.get('/categorietype', async (req, res) => {
        try {
            const categorieTypeId = req.query.id;
            const categorieTypeName = req.query.name;
            const categorieTypeReturned = await categorieType.getCategorieTypeById(categorieTypeId, categorieTypeName);
            res.json({ success: true, categorieTypeReturned });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
    // Create a new category type
    app.post('/categorietype', async (req, res) => {
        try {
            const categorieTypeData = req.body;
            const newCategorieType = await categorieType.createCategorieType(categorieTypeData);
            res.json({ success: true, categorieType: newCategorieType });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}
