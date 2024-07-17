const User = require("../../schema/schemaUser.js");

async function getUserSeancesItems(id) {
    await User.findById(id, (err, user) => {
        if (err) {
            throw new Error("User has no seances")
        }
        else {
            if (user) {
                if (user.seances.length === 0) {
                    throw new Error("User has no seances")
                }
                else {
                    console.log("user", user.seances.length)
                    return { success: true, seances: user.seances, checkItems: user.checkItems }
                }
            }
            else {
                throw new Error("User not found")
            }
        }
    })
}

module.exports = { getUserSeancesItems }