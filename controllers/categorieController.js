const categorie = require('../lib/categorie');

module.exports = function (app) {
    // Get all categories
    app.get('/categories', async (req, res) => {
        try {
            console.log("Fetching all categories");
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
            console.log("Fetching categorie by ID:", req.params.id);
            const categorieId = req.query.id;
            const categorieName = req.query.name;
            const categoryReturned = await categorie.getCategoryById(categorieId, categorieName);
            res.json({ success: true, categoryReturned });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}
