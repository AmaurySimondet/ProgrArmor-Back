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
const { sendResetPasswordEmail } = require('./resend');

function stripTrailingSlash(value = "") {
    return value.replace(/\/+$/, "");
}

const url = stripTrailingSlash(process.env.URL_BACKEND || "");
const urlClient = stripTrailingSlash(process.env.URL_CLIENT || "");
console.log("Client URL: " + urlClient);
console.log("Backend URL: " + url);
const tokenExpirationLimit = "7d"

function buildRequestId() {
    return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

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

// //FACEBOOK
// const FacebookStrategy = require('passport-facebook').Strategy;

// passport.use(new FacebookStrategy({
//     proxy: true,
//     clientID: process.env.FACEBOOK_CLIENT_ID,
//     clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
//     callbackURL: url + "/user/auth/facebook/authenticate",
//     profileFields: ['id', 'name', 'email', 'picture.type(large)']
// },
//     async (accessToken, refreshToken, profile, done) => {
//         try {
//             const fName = profile?._json?.first_name;
//             const lName = profile?._json?.last_name;
//             const fullName = `${fName || ''} ${lName || ''}`.trim();

//             const user = {
//                 facebookId: profile._json.id,
//                 email: profile._json.email,
//                 fName,
//                 lName,
//                 profilePic: profile._json.picture?.data?.url,
//                 normalizedName: normalizeString(fullName),
//             };

//             const oldUser = await User.findOne({ facebookId: user.facebookId });
//             if (oldUser) {
//                 // `normalizedName` est requis dans `schemaUser.js`, donc on backfill si besoin.
//                 if (!oldUser.normalizedName) {
//                     oldUser.normalizedName = user.normalizedName;
//                     await oldUser.save();
//                 }
//                 return done(null, oldUser);
//             }

//             return done(null, await new User(user).save());
//         } catch (error) {
//             return done(error, null);
//         }
//     }
// ))

// /**
//  * Initiates Facebook authentication
//  * @param {express.Request} req - Express request object
//  * @param {express.Response} res - Express response object
//  * @returns {Promise<void>}
//  */
// async function facebook(req, res) {
//     const state = req.query.redirect ? encodeURIComponent(req.query.redirect) : '';
//     passport.authenticate("facebook", {
//         scope: ['email'],
//         state: state  // Facebook OAuth also supports the state parameter
//     })(req, res, (err) => {
//         if (err) console.log(err);
//     });
// };

// /**
//  * Handles Facebook authentication callback
//  * @param {express.Request} req - Express request object
//  * @param {express.Response} res - Express response object
//  * @returns {Promise<void>}
//  */
// async function facebookAuthenticate(req, res) {
//     try {
//         passport.authenticate("facebook")(req, res, async (err) => {
//             if (req.user) {
//                 await ensureDefaultUserMeasure(req.user._id);
//                 // Update lastLogin
//                 await User.findByIdAndUpdate(req.user._id, { lastLogin: new Date() });

//                 const token = jwt.sign({ id: req.user._id }, process.env.JWT_SECRET, { expiresIn: tokenExpirationLimit });
//                 // Get redirect URL from state parameter
//                 const redirectUrl = req.query.state ? decodeURIComponent(req.query.state) : '/dashboard';
//                 res.redirect(urlClient + `/token?token=${token}&redirect=${encodeURIComponent(redirectUrl)}`);
//             } else {
//                 console.log(err);
//                 return res.status(401).json({
//                     success: false,
//                     message: "Authentification Facebook échouée"
//                 });
//             }
//         });
//     } catch (error) {
//         console.error("Facebook auth error:", error);
//         res.status(500).json({
//             success: false,
//             message: error.message || "Erreur interne lors de l'authentification Facebook"
//         });
//     }
// };

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
        console.log("Google OAuth callback received");

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
    const requestId = req.headers["x-request-id"] || buildRequestId();
    const state = req.query.redirect ? encodeURIComponent(req.query.redirect) : '';
    console.log("[google] Init", { requestId });
    passport.authenticate("google", {
        scope: ['email', 'profile'],
        state: state,  // Google OAuth2 allows passing state parameter which we'll use for redirect
        session: false
    })(req, res, function (err) {
        if (err) {
            console.log(err)
        }
    });
};

async function googleAuthenticate(req, res) {
    const requestId = req.headers["x-request-id"] || buildRequestId();
    console.log("[googleAuthenticate] Called", { requestId, prompt: req.query.prompt || "" });
    try {
        const authenticate = () => new Promise((resolve, reject) => {
            passport.authenticate("google", { session: false })(req, res, (err) => {
                if (err) {
                    console.error("[googleAuthenticate] Passport authenticate error:", {
                        requestId,
                        errorCode: err?.code,
                        errorMessage: err?.message
                    });
                    reject(err);
                }
                else resolve();
            });
        });

        await authenticate();
        console.log("[googleAuthenticate] Success", { requestId, userId: req.user?._id });

        if (!req.user) {
            console.error("[googleAuthenticate] Authentication failed - no user in req");
            throw new Error('Authentication failed - no user');
        }

        await ensureDefaultUserMeasure(req.user._id);

        const [, token] = await Promise.all([
            User.findByIdAndUpdate(req.user._id, { lastLogin: new Date() }),
            jwt.sign({ id: req.user._id }, process.env.JWT_SECRET, { expiresIn: tokenExpirationLimit })
        ]);

        // Get redirect URL from state parameter
        const redirectUrl = req.query.state ? decodeURIComponent(req.query.state) : '/dashboard';

        // Mobile deep links - redirect directly with token
        if (redirectUrl.match(/^(progarmor|exp):\/\//)) {
            const deepLink = `${redirectUrl}?token=${token}`;
            res.redirect(deepLink);
        } else {
            // Web - go through Token page
            const webRedirect = urlClient + `/token?token=${token}&redirect=${encodeURIComponent(redirectUrl)}`;
            res.redirect(webRedirect);
        }
    }
    catch (error) {
        console.error('[googleAuthenticate] Google auth error:', {
            requestId,
            errorCode: error?.code,
            errorMessage: error?.message
        });
        const redirectUrl = req.query.state ? decodeURIComponent(req.query.state) : '/dashboard';
        const oauthErrorPayload = typeof error?.oauthError?.data === "string" ? error.oauthError.data : "";
        const isInvalidGrant = error?.code === "invalid_grant" || /invalid_grant/i.test(oauthErrorPayload);

        // Silent Google auth (prompt=none) can legitimately fail (expired/replayed one-time code,
        // blocked third-party context, etc.). Redirect to client with a recoverable error
        // instead of returning a 500 JSON in an iframe/popup flow.
        if (isInvalidGrant && req.query.prompt === "none") {
            const failureRedirect = `${urlClient}/token?error=google_silent_auth_failed&redirect=${encodeURIComponent(redirectUrl)}`;
            return res.redirect(failureRedirect);
        }

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
                (async () => {
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
                })();
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

        passport.authenticate("local", async function (err, user) {
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
        if (!req.user?._id) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const foundUser = await User.findById(req.user._id);

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
        const requestId = req.headers["x-request-id"] || buildRequestId();

        if (!email) {
            console.warn("[forgotPassword] Missing email", { requestId });
            return res.status(400).json({ success: false, message: "Email is required" });
        }

        const foundUser = await User.findOne({ email });

        // Always return same response to avoid user enumeration.
        if (!foundUser) {
            console.info("[forgotPassword] Account not found (masked response)", { requestId });
            return res.json({
                success: true,
                message: "If an account exists for this email, a reset email has been sent."
            });
        }

        const rawToken = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiresAt = new Date(Date.now() + 1000 * 60 * 30); // 30 minutes

        foundUser.resetPasswordToken = hashedToken;
        foundUser.resetPasswordExpires = expiresAt;
        await foundUser.save();
        console.info("[forgotPassword] Token stored", {
            requestId,
            userId: String(foundUser._id),
            email: foundUser.email,
            expiresAt: expiresAt.toISOString(),
            tokenHashPrefix: hashedToken.slice(0, 10),
        });

        await sendResetPasswordEmail({
            to: foundUser.email,
            firstName: foundUser.fName,
            rawToken,
        });
        console.info("[forgotPassword] Reset email requested", {
            requestId,
            userId: String(foundUser._id),
            email: foundUser.email,
        });

        res.json({
            success: true,
            message: "If an account exists for this email, a reset email has been sent."
        });
    } catch (error) {
        console.error("[forgotPassword] Error", { message: error?.message });
        res.status(500).json({ success: false, message: error.message });
    }
}

// RESET PASSWORD WITH TOKEN (UNAUTHENTICATED)
async function resetPasswordWithToken(req, res) {
    try {
        const { token, password } = req.body;
        const requestId = req.headers["x-request-id"] || buildRequestId();
        const normalizedToken = typeof token === "string" ? token.trim() : "";

        if (!normalizedToken || !password) {
            console.warn("[resetPasswordWithToken] Missing token/password", {
                requestId,
                hasToken: Boolean(normalizedToken),
                hasPassword: Boolean(password),
            });
            return res.status(400).json({ success: false, message: "Token and password are required" });
        }

        const hashedToken = crypto.createHash('sha256').update(normalizedToken).digest('hex');
        console.info("[resetPasswordWithToken] Attempt", {
            requestId,
            tokenPrefix: normalizedToken.slice(0, 8),
            tokenLength: normalizedToken.length,
            tokenHashPrefix: hashedToken.slice(0, 10),
        });

        const foundUser = await User.findOne({
            resetPasswordToken: hashedToken,
            resetPasswordExpires: { $gt: new Date() }
        });

        if (!foundUser) {
            const userWithToken = await User.findOne({ resetPasswordToken: hashedToken })
                .select("_id email resetPasswordExpires")
                .lean();
            console.warn("[resetPasswordWithToken] Invalid or expired token", {
                requestId,
                tokenHashPrefix: hashedToken.slice(0, 10),
                matchFoundIgnoringExpiry: Boolean(userWithToken),
                matchedUserId: userWithToken ? String(userWithToken._id) : null,
                matchedEmail: userWithToken?.email || null,
                matchedExpiry: userWithToken?.resetPasswordExpires
                    ? new Date(userWithToken.resetPasswordExpires).toISOString()
                    : null,
                now: new Date().toISOString(),
            });
            return res.status(400).json({ success: false, message: "Invalid or expired reset token" });
        }

        await foundUser.setPassword(password);
        foundUser.resetPasswordToken = null;
        foundUser.resetPasswordExpires = null;
        await foundUser.save();
        console.info("[resetPasswordWithToken] Password reset success", {
            requestId,
            userId: String(foundUser._id),
            email: foundUser.email,
        });

        res.json({ success: true, message: "Password updated successfully!" });
    } catch (error) {
        console.error("[resetPasswordWithToken] Error", { message: error?.message });
        res.status(500).json({ success: false, message: error.message });
    }
}



exports.login = login;
exports.signup = signup;
// exports.facebook = facebook;
// exports.facebookAuthenticate = facebookAuthenticate;
exports.google = google;
exports.googleAuthenticate = googleAuthenticate;
exports.logout = logout;
exports.verifyToken = verifyToken;
exports.resetPassword = resetPassword;
exports.forgotPassword = forgotPassword;
exports.resetPasswordWithToken = resetPasswordWithToken;