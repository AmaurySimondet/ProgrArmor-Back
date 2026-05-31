const UserProgram = require('../schema/userProgram');

async function updateLastSeanceId(programId, seanceId) {
    if (!programId || !seanceId) return;
    await UserProgram.findByIdAndUpdate(programId, { lastSeanceId: seanceId });
}

module.exports = {
    updateLastSeanceId,
};
