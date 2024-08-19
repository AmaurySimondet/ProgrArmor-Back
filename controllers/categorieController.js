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
    app.get('/categorie', async (req, res) => {
        try {
            console.log("Fetching categorie by ID:", req.params.id);
            const categorieId = req.query.id;
            const categorieName = req.query.name;
            const categorieReturned = await categorie.getCategorieById(categorieId, categorieName);
            res.json({ success: true, categorieReturned });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}
