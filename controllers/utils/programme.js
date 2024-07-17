const Comment = require("../../schema/schemaComment.js");
const Like = require("../../schema/schemaLike.js");

function getConditions(req) {
    console.log("body", req.body)
    console.log("type", typeof req.body)
    console.log("keys", Object.keys(req.body))

    let conditions = {};
    if (req.body.ownedByMe) {
        conditions.createdBy = req.body.id
    }
    if (req.body.likedByMe) {
        Like.find({ user: req.body.id }, (err, data) => {
            if (err) {
                return res.json({ success: false, message: err })
            }
            else {
                let programmesLiked = [];
                data.forEach(element => {
                    programmesLiked.push(element.programme)
                });
                conditions._id.$in = programmesLiked
            }
        })
    }
    else if (req.body.commentedByMe) {
        Comment.find({ user: req.body.id }, (err, data) => {
            if (err) {
                return res.json({ success: false, message: err })
            }
            else {
                let programmesCommented = [];
                data.forEach(element => {
                    programmesCommented.push(element.programme)
                });
                if (conditions._id) {
                    if (conditions._id.$in) {
                        conditions._id.$and = [{ $in: conditions._id.$in }, { $in: programmesCommented }]
                        delete conditions._id.$in
                    }
                }
            }
        })
    }
    if (req.body.type) {
        conditions.type = req.body.type.value
    }
    if (req.body.niveau) {
        conditions.niveau = req.body.niveau.value
    }
    if (req.body.dureeMax) {
        conditions.duree = { $lte: parseInt(req.body.dureeMax) }
    }
    if (req.body.seancesParSemaine) {
        conditions.seancesSemaine = { $lte: parseInt(req.body.seancesParSemaine) }
    }
    if (req.body.materiel) {
        conditions.materiel = { $in: req.body.materiel.map(element => element.value) }
    }
    if (req.body.programmeId) {
        conditions._id = req.body.programmeId
    }
    if (req.body.createdBy) {
        conditions.createdBy = req.body.createdBy
    }

    return conditions
}

module.exports = { getConditions: getConditions }