const express = require("express");

require('dotenv').config();

const passport = require("passport");
const jwt = require('jsonwebtoken');
const User = require("../schema/schemaUser");
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;

const url = process.env.URL_BACKEND
const urlClient = process.env.URL_CLIENT
const tokenExpirationLimit = "7d"

// Session configuration
const sessionConfig = {
    secret: process.env.JWT_SECRET,
    keys: [process.env.JWT_SECRET],
    resave: false,
    saveUninitialized: false
};

// Passport configuration
const configurePassport = () => {
    passport.use(User.createStrategy());
    passport.serializeUser(User.serializeUser());
    passport.deserializeUser(User.deserializeUser());

    // JWT Strategy configuration
    const jwtOptions = {
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        secretOrKey: process.env.JWT_SECRET
    };

    passport.use(new JwtStrategy(jwtOptions, async (jwt_payload, done) => {
        try {
            const user = await User.findById(jwt_payload.id);
            if (user) {
                return done(null, user);
            }
            return done(null, false);
        } catch (error) {
            return done(error, false);
        }
    }));
};

// Export configurations
exports.sessionConfig = sessionConfig;
exports.configurePassport = configurePassport;

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
        try {
            const user = {
                facebookId: profile._json.id,
                email: profile._json.email,
                fName: profile._json.first_name,
                lName: profile._json.last_name,
                profilePic: profile._json.picture.data.url
            };

            const oldUser = await User.findOne({ facebookId: user.facebookId });
            return done(null, oldUser || await new User(user).save());
        } catch (error) {
            return done(error, null);
        }
    }
))

/**
 * Initiates Facebook authentication
 * @param {express.Request} req - Express request object
 * @param {express.Response} res - Express response object
 * @returns {Promise<void>}
 */
async function facebook(req, res) {
    const state = req.query.redirect ? encodeURIComponent(req.query.redirect) : '';
    passport.authenticate("facebook", {
        scope: ['email'],
        state: state  // Facebook OAuth also supports the state parameter
    })(req, res, (err) => {
        if (err) console.log(err);
    });
};

/**
 * Handles Facebook authentication callback
 * @param {express.Request} req - Express request object
 * @param {express.Response} res - Express response object
 * @returns {Promise<void>}
 */
async function facebookAuthenticate(req, res) {
    try {
        passport.authenticate("facebook")(req, res, async (err) => {
            if (req.user) {
                // Update lastLogin
                await User.findByIdAndUpdate(req.user._id, { lastLogin: new Date() });

                const token = jwt.sign({ id: req.user._id }, process.env.JWT_SECRET, { expiresIn: tokenExpirationLimit });
                // Get redirect URL from state parameter
                const redirectUrl = req.query.state ? decodeURIComponent(req.query.state) : '/dashboard';
                res.redirect(urlClient + `/token?token=${token}&redirect=${encodeURIComponent(redirectUrl)}`);
            } else {
                console.log(err);
            }
        });
    } catch (error) {
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
    const state = req.query.redirect ? encodeURIComponent(req.query.redirect) : '';
    passport.authenticate("google", {
        scope: ['email', 'profile'],
        state: state  // Google OAuth2 allows passing state parameter which we'll use for redirect
    })(req, res, function (err) {
        if (err) {
            console.log(err)
        }
    });
};

async function googleAuthenticate(req, res) {
    try {
        const authenticate = () => new Promise((resolve, reject) => {
            passport.authenticate("google")(req, res, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        await authenticate();

        if (!req.user) {
            throw new Error('Authentication failed - no user');
        }

        const [_, token] = await Promise.all([
            User.findByIdAndUpdate(req.user._id, { lastLogin: new Date() }),
            jwt.sign({ id: req.user._id }, process.env.JWT_SECRET, { expiresIn: tokenExpirationLimit })
        ]);

        // Get redirect URL from state parameter
        const redirectUrl = req.query.state ? decodeURIComponent(req.query.state) : '/dashboard';
        res.redirect(urlClient + `/token?token=${token}&redirect=${encodeURIComponent(redirectUrl)}`);
    }
    catch (error) {
        console.error('Google auth error:', error);
        res.status(500).send(error);
    }
};

//Token
function verifyToken(req, res) {
    const token = req.body.token
    jwt.verify(token, process.env.JWT_SECRET, function (err, decoded) {
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
                res.json({ success: false, message: "" + err });
            } else {
                passport.authenticate("local")(req, res, function () {
                    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: tokenExpirationLimit });
                    res.json({ success: true, message: "Register successful", token: token });
                });
            };
        });
};


//LOGIN
async function login(req, res) {
    const { email, password } = req.body;

    if (!email || !password) {
        console.log("Missing email or password");
        return res.status(400).json({
            success: false,
            message: !email ? "Email was not given" : "Password was not given"
        });
    }

    try {
        // First find the user by email
        const foundUser = await User.findOne({ email });

        if (!foundUser) {
            return res.status(401).json({
                success: false,
                message: "Email or password incorrect"
            });
        }

        // Create a new user instance for authentication
        const user = new User({ email, password });

        req.login(user, function (err) {
            if (err) {
                console.log("Login error:", err);
                return res.status(500).json({ success: false, message: err.message });
            }

            passport.authenticate("local", async function (err, user, info) {
                if (err || !user) {
                    return res.status(401).json({
                        success: false,
                        message: err?.message || "email or password incorrect"
                    });
                }

                // Update lastLogin
                await User.findByIdAndUpdate(user._id, { lastLogin: new Date() });

                const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: tokenExpirationLimit });
                res.json({
                    success: true,
                    message: "Login successful",
                    token: token,
                    id: user._id
                });
            })(req, res);
        });
    } catch (error) {
        console.log("Login catch error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
}

//LOGOUT
async function logout(req, res) {
    req.logout(function (err) {
        if (err) alert(err)
    });
    res.json({ success: true, message: "Logout successful" })
}

//RESET PASSWORD
async function resetPassword(req, res) {
    try {
        const foundUser = await User.findOne({ email: req.body.email });

        if (!foundUser) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        await foundUser.setPassword(req.body.password);
        await foundUser.save();
        res.json({ success: true, message: "Password updated successfully!" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
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