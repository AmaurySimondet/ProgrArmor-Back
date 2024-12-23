const categorieType = require('../lib/categorieType');

module.exports = function (app) {
    // Get all category types
    app.get('/categorietypes', async (req, res) => {
        try {
            const categorieTypes = await categorieType.getAllCategorieTypes();
            res.json({ success: true, categorieTypes });
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
}
