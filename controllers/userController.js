const account = require('./account/lib.js');
const programme = require('./account/libProgramme.js');

module.exports = function (app) {
    //LOGIN SIGNUP
    app.post('/login', account.login);
    app.post('/signup', account.signup);
    app.get('/logout', account.logout);

    app.get('/auth/facebook', account.facebook);
    app.get('/auth/facebook/authenticate', account.facebookAuthenticate);

    app.get('/auth/google', account.google);
    app.get('/auth/google/authenticate', account.googleAuthenticate);

    //SESSION
    app.post('/debutantform', account.debutantform);
    app.get('/loadSeance', account.loadSeance);
    app.post('/priseDeNote', account.priseDeNote);

    //DASHBOARD
    app.get('/workouts', account.workouts);
    app.post('/reguScore', account.reguScore);

    //COMPTE
    app.post('/getUser', account.getUser);
    app.post('/modifyUser', account.modifyUser);
    app.post('/resetPassword', account.resetPassword);

    //TOKEN
    app.post('/verifyToken', account.verifyToken)

    //SUPPR SEANCE
    app.post('/supprSeance', account.supprSeance)

    // //EDIT DB
    // app.get('/editDB', account.editDB)
    // app.get('/editDB2', account.editDB2)

    //NIVEAU
    app.post('/getNiveau', account.getNiveau)

    //PROGRAMME
    app.post('/createProgramme', programme.create);
    app.post('/getProgrammes', programme.getProgrammes);
    app.post('/getProgramme', programme.getProgramme);
    app.post('/deleteProgramme', programme.deleteProgramme);
    app.post('/getProgrammesByUser', programme.getProgrammesByUser);
    app.post('/likeProgramme', programme.likeProgramme);
    app.post('/isProgrammeLiked', programme.isProgrammeLiked);
    app.post('/isProgrammeCommented', programme.isProgrammeCommented);
    app.post('/getProgrammeLikes', programme.getProgrammeLikes);
    app.post('/whoLiked', programme.whoLiked);
    app.post('/getProgrammeCreator', programme.getProgrammeCreator);
    app.post('/sendComment', programme.sendComment);
    app.post('/getComments', programme.getComments);
}