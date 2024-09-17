const login = require('./account/login.js');
const account = require('./account/lib.js');
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

    //USERS
    app.get('/getUsers', user.getUsers);

    //SUPPR SEANCE
    app.post('/supprSeance', account.supprSeance)

    //NIVEAU
    app.post('/getNiveau', account.getNiveau)
}