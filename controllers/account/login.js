const User = require("../../schema/schemaUser.js");
const express = require("express");
const app = express();

require('dotenv').config();

const session = require('cookie-session');
const passport = require("passport");
const jwt = require('jsonwebtoken');

const DEV = true;

const url = DEV ? "http://10.0.51.241:8800" : "https://prograrmor-back.vercel.app"
const url_client = DEV ? "http://10.0.51.241:3000" : "https://prograrmor.vercel.app"

app.use(session({
    secret: process.env.secret,
    keys: [process.env.secret],
    resave: false,
    saveUninitialized: false
}));

// CHANGE: USE "createStrategy" INSTEAD OF "authenticate"
passport.use(User.createStrategy());
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());


//FACEBOOK
const FacebookStrategy = require('passport-facebook').Strategy;

passport.use(new FacebookStrategy({
    proxy: true,
    clientID: process.env.FACEBOOK_CLIENT_ID,
    clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
    callbackURL: url + "/user/auth/facebook/authenticate",
    profileFields: ['id', 'name', 'email', 'picture.type(large)']
},
    async (accessToken, refreshToken, profile, done) => {

        const user = {
            facebookId: profile._json.id,
            email: profile._json.email,
            fName: profile._json.first_name,
            lName: profile._json.last_name,
            profilePic: profile._json.picture.data.url
        }

        const oldUser = await User.findOne({ googleId: user.googleId });

        if (oldUser) {
            return done(null, oldUser)
        }
        else {
            const newUser = await new User(user).save();
            return done(null, newUser)
        }
    }
))

async function facebook(req, res) {
    passport.authenticate("facebook", { scope: ['email'] })(req, res, function (err) {
        if (err) {
            console.log(err)
        }
    });
};

async function facebookAuthenticate(req, res) {
    try {
        passport.authenticate("facebook")(req, res, function (err) {
            if (req.user) {
                const token = jwt.sign({ id: req.user._id }, process.env.secret, { expiresIn: "24h" });
                res.redirect(url_client + '/token?token=' + token);
            }
            else {
                console.log(err)
            }
        });
    }
    catch (error) {
        res.send(error);
    }
};

//Google
const GoogleStrategy = require('passport-google-oauth20').Strategy;

passport.use(new GoogleStrategy({
    proxy: true,
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: url + "/user/auth/google/authenticate",
    profileFields: ['id', 'name', 'email', 'photos']
},
    async (accessToken, refreshToken, profile, done) => {

        let user = {}

        if (profile._json.family_name) {
            user = {
                googleId: profile._json.sub,
                email: profile._json.email,
                fName: profile._json.given_name,
                lName: profile._json.family_name,
                profilePic: profile._json.picture
            }
        }
        else {
            user = {
                googleId: profile._json.sub,
                email: profile._json.email,
                fName: profile._json.given_name,
                lName: profile._json.given_name,
                profilePic: profile._json.picture
            }
        }

        const oldUser = await User.findOne({ googleId: user.googleId });

        if (oldUser) {
            return done(null, oldUser)
        }
        else {
            const newUser = await new User(user).save();
            return done(null, newUser)
        }
    }
))

function google(req, res) {
    passport.authenticate("google", { scope: ['email', 'profile'] })(req, res, function (err) {
        if (err) {
            console.log(err)
        }
    });
};

async function googleAuthenticate(req, res) {
    try {
        passport.authenticate("google")(req, res, function (err) {
            if (req.user) {
                const token = jwt.sign({ id: req.user._id }, process.env.secret, { expiresIn: "24h" });
                res.redirect(url_client + '/token?token=' + token);
            }
            else {
                console.log(err)
            }
        });
    }
    catch (error) {
        res.send(error);
    }
};

//Token
function verifyToken(req, res) {
    const token = req.body.token
    jwt.verify(token, process.env.secret, function (err, decoded) {
        if (err) {
            res.json({ success: false, message: "Token verification failed " + err.name });
        }
        else {
            res.json({ success: true, message: "Token verification successfull", id: decoded.id });
        }
    })

}


//SIGNUP
async function signup(req, res) {
    User.register(
        { fName: req.body.fName, email: req.body.email, lName: req.body.lName },
        req.body.password,
        function (err, user) {
            if (err) {
                console.log(err)
                res.json({ success: false, message: "Your account could not be saved. Error: " + err });
            } else {
                passport.authenticate("local")(req, res, function () {
                    const token = jwt.sign({ id: user._id }, process.env.secret, { expiresIn: "24h" });
                    res.json({ success: true, message: "Register successful", token: token });
                });
            };
        });
};


//LOGIN
async function login(req, res) {
    const user = new User({
        email: req.body.email,
        password: req.body.password
    });

    if (!req.body.email) {
        res.json({ success: false, message: "Email was not given" })
    }
    else if (!req.body.password) {
        res.json({ success: false, message: "Password was not given" })
    }

    else {
        req.login(user, function (err) {
            if (err) {
                console.log(err);
            } else {
                passport.authenticate("local", function (err, user, info) {
                    if (err) {
                        res.json({ success: false, message: err });
                    }
                    else {
                        if (!user) {
                            res.json({ success: false, message: "email or password incorrect" });
                        }
                        else {
                            const token = jwt.sign({ id: user._id }, process.env.secret, { expiresIn: "24h" });
                            res.json({ success: true, message: "Register successful", token: token });
                        }
                    }
                })(req, res);
            };
        });
    }
};

//LOGOUT
async function logout(req, res) {
    req.logout(function (err) {
        if (err) { alert(err) }
    });
    res.json({ success: true, message: "Logout successful" })
}

//RESET PASSWORD
async function resetPassword(req, res) {
    let conditions = {
        email: req.body.email
    }

    try {
        User.findOne(conditions).then(function (foundUser) {
            if (foundUser) {
                // console.log(foundUser)
                foundUser.setPassword(req.body.password, function () {
                    foundUser.save();
                    res.json({ success: true, message: "Utilisateur mis à jour!" })
                });
            } else {
                res.json({ success: true, message: 'Utilisateur introuvable' });
            }
        }, function (err) {
            console.error(err);
        })
    }
    catch (e) {
        console.log(e);
    }

}



exports.login = login;
exports.signup = signup;
exports.facebook = facebook;
exports.facebookAuthenticate = facebookAuthenticate;
exports.google = google;
exports.googleAuthenticate = googleAuthenticate;
exports.logout = logout;
exports.verifyToken = verifyToken;
exports.resetPassword = resetPassword;