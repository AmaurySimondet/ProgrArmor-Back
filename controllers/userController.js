const login = require('./account/login.js');
const account = require('./account/lib.js');
const programme = require('./account/libProgramme.js');
const user = require('./utils/user.js');

module.exports = function (app) {
    //LOGIN SIGNUP
    app.post('/login', login.login);
    app.post('/signup', login.signup);
    app.get('/logout', login.logout);

    app.get('/auth/facebook', login.facebook);
    app.get('/auth/facebook/authenticate', login.facebookAuthenticate);

    app.get('/auth/google', login.google);
    app.get('/auth/google/authenticate', login.googleAuthenticate);

    //TOKEN
    app.post('/verifyToken', login.verifyToken)

    //SESSION
    app.post('/debutantform', account.debutantform);
    app.get('/loadSeance', account.loadSeance);
    app.post('/priseDeNote', account.priseDeNote);

    //DASHBOARD
    app.get('/workouts', account.workouts);
    app.post('/reguScore', account.reguScore);

    //COMPTE
    app.post('/getUser', user.getUser);
    app.post('/modifyUser', user.modifyUser);
    app.post('/resetPassword', login.resetPassword);

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