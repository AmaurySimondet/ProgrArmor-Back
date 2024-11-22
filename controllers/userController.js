const login = require('../lib/login.js');
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
    app.post('/verifyToken', login.verifyToken)

    //COMPTE
    app.post('/getUser', user.getUser);
    app.post('/modifyUser', user.modifyUser);
    app.post('/resetPassword', login.resetPassword);

    //USERS
    app.get('/getUsers', user.getUsers);
}