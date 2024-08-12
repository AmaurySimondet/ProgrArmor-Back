const categorieType = require('../lib/categorieType');

module.exports = function (app) {
    // Get all category types
    app.get('/categorietypes', async (req, res) => {
        try {
            console.log("Fetching all category types");
            const categorieTypes = await categorieType.getAllCategorieTypes();
            res.json({ success: true, categorieTypes });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Get a category type by ID
    app.get('/categorietype/:id', async (req, res) => {
        try {
            console.log("Fetching category type by ID:", req.params.id);
            const categorieTypeId = req.params.id;
            const categorieType = await categorieType.getCategorieTypeById(categorieTypeId);
            res.json({ success: true, categorieType });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}
