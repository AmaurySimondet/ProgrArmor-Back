const { clearCache } = require("../utils/cache");

(() => {
    clearCache();
    console.log("Cache cleared");
})();