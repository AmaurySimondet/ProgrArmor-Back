const login = require('../lib/login.js');
const User = require('../lib/user.js');

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
    app.get('/getUser', User.getUser);
    app.post('/modifyUser', User.modifyUser);
    app.post('/resetPassword', login.resetPassword);
    app.put('/updateLanguage', User.updateLanguage);

    //USERS
    app.get('/getUsers', User.getUsers);
    app.get('/searchUsers', User.searchUsers);
    app.get('/userStats', User.userStats);
    app.get('/regularityScore', User.getRegularityScore);

    //FOLLOWERS
    app.post('/followUser', User.followUser);
    app.post('/unfollowUser', User.unfollowUser);
}
