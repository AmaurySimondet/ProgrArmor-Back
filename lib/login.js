const express = require("express");

require('dotenv').config();

const passport = require("passport");
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require("../schema/schemaUser");
const UserMeasure = require("../schema/userMeasure");
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const { normalizeString } = require('../utils/string');
const { normalizeWeightUnit } = require('../utils/weightUnit');
const { normalizeHeightUnit } = require('../utils/heightUnit');

const url = process.env.URL_BACKEND
const urlClient = process.env.URL_CLIENT
console.log("Client URL: " + urlClient);
console.log("Backend URL: " + url);
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
            const fName = profile?._json?.first_name;
            const lName = profile?._json?.last_name;
            const fullName = `${fName || ''} ${lName || ''}`.trim();

            const user = {
                facebookId: profile._json.id,
                email: profile._json.email,
                fName,
                lName,
                profilePic: profile._json.picture?.data?.url,
                normalizedName: normalizeString(fullName),
            };

            const oldUser = await User.findOne({ facebookId: user.facebookId });
            if (oldUser) {
                // `normalizedName` est requis dans `schemaUser.js`, donc on backfill si besoin.
                if (!oldUser.normalizedName) {
                    oldUser.normalizedName = user.normalizedName;
                    await oldUser.save();
                }
                return done(null, oldUser);
            }

            return done(null, await new User(user).save());
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
                await ensureDefaultUserMeasure(req.user._id);
                // Update lastLogin
                await User.findByIdAndUpdate(req.user._id, { lastLogin: new Date() });

                const token = jwt.sign({ id: req.user._id }, process.env.JWT_SECRET, { expiresIn: tokenExpirationLimit });
                // Get redirect URL from state parameter
                const redirectUrl = req.query.state ? decodeURIComponent(req.query.state) : '/dashboard';
                res.redirect(urlClient + `/token?token=${token}&redirect=${encodeURIComponent(redirectUrl)}`);
            } else {
                console.log(err);
                return res.status(401).json({
                    success: false,
                    message: "Authentification Facebook échouée"
                });
            }
        });
    } catch (error) {
        console.error("Facebook auth error:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Erreur interne lors de l'authentification Facebook"
        });
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
        // NOTE: `normalizedName` est requis dans `schemaUser.js`, donc on doit le remplir aussi pour l'OAuth Google.
        // Les logs de secrets (client secret) sont volontairement supprimés.
        console.log("Google profile: " + JSON.stringify(profile));

        const fName = profile?._json?.given_name;
        const lName = profile?._json?.family_name || profile?._json?.given_name;
        const fullName = `${fName || ''} ${lName || ''}`.trim();

        const user = {
            googleId: profile?._json?.sub,
            email: profile?._json?.email,
            fName,
            lName,
            profilePic: profile?._json?.picture,
            normalizedName: normalizeString(fullName),
        };

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
    console.log("[googleAuthenticate] Called");
    try {
        const authenticate = () => new Promise((resolve, reject) => {
            console.log("[googleAuthenticate] Calling passport.authenticate('google')");
            passport.authenticate("google")(req, res, (err) => {
                if (err) {
                    console.error("[googleAuthenticate] Passport authenticate error:", err);
                    reject(err);
                }
                else {
                    console.log("[googleAuthenticate] Passport authenticate success");
                    resolve();
                }
            });
        });

        await authenticate();
        console.log("[googleAuthenticate] Authenticated, req.user:", req.user);

        if (!req.user) {
            console.error("[googleAuthenticate] Authentication failed - no user in req");
            throw new Error('Authentication failed - no user');
        }

        await ensureDefaultUserMeasure(req.user._id);

        console.log("[googleAuthenticate] Updating user lastLogin and signing token for userId:", req.user._id);

        const [userUpdateResult, token] = await Promise.all([
            User.findByIdAndUpdate(req.user._id, { lastLogin: new Date() }),
            jwt.sign({ id: req.user._id }, process.env.JWT_SECRET, { expiresIn: tokenExpirationLimit })
        ]);

        console.log("[googleAuthenticate] Updated user lastLogin:", userUpdateResult);
        console.log("[googleAuthenticate] Generated JWT token");

        // Get redirect URL from state parameter
        const redirectUrl = req.query.state ? decodeURIComponent(req.query.state) : '/dashboard';
        console.log("[googleAuthenticate] Redirect URL:", redirectUrl);

        // Mobile deep links - redirect directly with token
        if (redirectUrl.match(/^(progarmor|exp):\/\//)) {
            const deepLink = `${redirectUrl}?token=${token}`;
            console.log("[googleAuthenticate] Detected mobile deep link. Redirecting to:", deepLink);
            res.redirect(deepLink);
        } else {
            // Web - go through Token page
            const webRedirect = urlClient + `/token?token=${token}&redirect=${encodeURIComponent(redirectUrl)}`;
            console.log("[googleAuthenticate] Redirecting to web Token page:", webRedirect);
            res.redirect(webRedirect);
        }
    }
    catch (error) {
        console.error('[googleAuthenticate] Google auth error:', error);
        res.status(500).json({
            success: false,
            message: error.message || "Erreur interne lors de l'authentification Google"
        });
    }
};

//Token
function verifyToken(req, res) {
    const token = req.body.token;
    jwt.verify(token, process.env.JWT_SECRET, async function (err, decoded) {
        if (err) {
            return res.json({ success: false, message: "Token verification failed " + err.name });
        }
        try {
            const user = await User.findById(decoded.id, { weightUnit: 1, heightUnit: 1, language: 1 }).lean();
            if (!user) {
                return res.json({ success: false, message: "User not found" });
            }
            return res.json({
                success: true,
                message: "Token verification successfull",
                id: decoded.id,
                weightUnit: normalizeWeightUnit(user.weightUnit),
                heightUnit: normalizeHeightUnit(user.heightUnit),
                language: user.language || "fr"
            });
        } catch (e) {
            return res.status(500).json({ success: false, message: e.message });
        }
    });
}

async function ensureDefaultUserMeasure(userId) {
    if (!userId) return;
    const existing = await UserMeasure.findOne({ userId }, { _id: 1 }).lean();
    if (existing) return;
    await UserMeasure.create({
        userId,
        measuredAt: new Date(),
        height: { cm: 170, ft: 5.5774 },
        weight: { kg: 70, lb: 154.32 }
    });
}


//SIGNUP
async function signup(req, res) {
    const normalizedName = normalizeString(req.body.fName + " " + req.body.lName);
    const weightUnit = normalizeWeightUnit(req.body.weightUnit);
    const heightUnit = normalizeHeightUnit(req.body.heightUnit);
    User.register(
        {
            fName: req.body.fName,
            email: req.body.email,
            lName: req.body.lName,
            normalizedName: normalizedName,
            language: req.body.language,
            weightUnit,
            heightUnit
        },
        req.body.password,
        function (err, user) {
            if (err) {
                console.log("Signup error:", err);

                // Email déjà pris
                if (err.name === "UserExistsError" ||
                    err.code === 11000 && (err.keyPattern?.email || err.keyValue?.email)) {
                    return res.status(409).json({
                        success: false,
                        message: "Cet email est déjà utilisé"
                    });
                }

                // Autres erreurs de signup
                return res.status(400).json({
                    success: false,
                    message: err.message || "Erreur lors de l'inscription"
                });
            } else {
                passport.authenticate("local")(req, res, async function () {
                    try {
                        await ensureDefaultUserMeasure(user._id);

                        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: tokenExpirationLimit });
                        res.json({ success: true, message: "Register successful", token: token });
                    } catch (measureError) {
                        console.error("Default user measure creation error:", measureError);
                        return res.status(500).json({
                            success: false,
                            message: "Inscription créée mais la mesure par défaut n'a pas pu être enregistrée"
                        });
                    }
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
            message: !email ? "Email manquant" : "Mot de passe manquant"
        });
    }

    try {
        // First find the user by email
        const foundUser = await User.findOne({ email });

        if (!foundUser) {
            return res.status(401).json({
                success: false,
                message: "Email ou mot de passe incorrect"
            });
        }

        // Create a new user instance for authentication
        const user = new User({ email, password });

        req.login(user, function (err) {
            if (err) {
                console.log("Login error:", err);
                return res.status(500).json({
                    success: false,
                    message: err.message || "Erreur interne lors de la connexion"
                });
            }

            passport.authenticate("local", async function (err, user, info) {
                if (err || !user) {
                    return res.status(401).json({
                        success: false,
                        message: "Email ou mot de passe incorrect"
                    });
                }

                // Update lastLogin
                await User.findByIdAndUpdate(user._id, { lastLogin: new Date() });

                const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: tokenExpirationLimit });
                const userObj = typeof user.toObject === "function" ? user.toObject() : { ...user };
                userObj.weightUnit = normalizeWeightUnit(userObj.weightUnit);
                res.json({
                    success: true,
                    message: "Login successful",
                    token: token,
                    id: user._id,
                    user: userObj
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

// FORGOT PASSWORD (UNAUTHENTICATED)
async function forgotPassword(req, res) {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, message: "Email is required" });
        }

        const foundUser = await User.findOne({ email });

        // Always return same response to avoid user enumeration.
        if (!foundUser) {
            return res.json({
                success: true,
                message: "If an account exists for this email, a reset link has been generated."
            });
        }

        const rawToken = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiresAt = new Date(Date.now() + 1000 * 60 * 30); // 30 minutes

        foundUser.resetPasswordToken = hashedToken;
        foundUser.resetPasswordExpires = expiresAt;
        await foundUser.save();

        const resetUrl = `${urlClient}/reset-password?token=${rawToken}`;

        // TODO: Plug your email service here.
        res.json({
            success: true,
            message: "If an account exists for this email, a reset link has been generated.",
            resetUrl: resetUrl
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}

// RESET PASSWORD WITH TOKEN (UNAUTHENTICATED)
async function resetPasswordWithToken(req, res) {
    try {
        const { token, password } = req.body;

        if (!token || !password) {
            return res.status(400).json({ success: false, message: "Token and password are required" });
        }

        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        const foundUser = await User.findOne({
            resetPasswordToken: hashedToken,
            resetPasswordExpires: { $gt: new Date() }
        });

        if (!foundUser) {
            return res.status(400).json({ success: false, message: "Invalid or expired reset token" });
        }

        await foundUser.setPassword(password);
        foundUser.resetPasswordToken = null;
        foundUser.resetPasswordExpires = null;
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
exports.forgotPassword = forgotPassword;
exports.resetPasswordWithToken = resetPasswordWithToken;