const categorie = require('../lib/categorie');

module.exports = function (app) {
    // Get all categories
    app.get('/categories', async (req, res) => {
        try {
            const categorieType = req.query.categorieType; // Optional query parameter
            const categories = await categorie.getAllCategories(categorieType);
            res.json({ success: true, categories });
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
