const { clearCache } = require("../controllers/utils/cache");

(() => {
    clearCache();
    console.log("Cache cleared");
})();