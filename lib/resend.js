const { Resend } = require("resend");

function stripTrailingSlash(value = "") {
    return value.replace(/\/+$/, "");
}

function getResetPasswordUrl(rawToken) {
    const directResetUrl = process.env.RESET_PASSWORD_URL || "";
    if (directResetUrl) {
        return `${stripTrailingSlash(directResetUrl)}?token=${encodeURIComponent(rawToken)}`;
    }

    const clientUrl = process.env.URL_CLIENT || "";
    return `${stripTrailingSlash(clientUrl)}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

async function sendResetPasswordEmail({ to, firstName, rawToken }) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    const audience = process.env.RESEND_AUDIENCE || "ProgArmor";

    if (!apiKey || !from) {
        console.warn("[forgotPassword] Resend not configured. Missing RESEND_API_KEY or RESEND_FROM_EMAIL.");
        return { sent: false, reason: "missing_config" };
    }

    const resetUrl = getResetPasswordUrl(rawToken);
    const resend = new Resend(apiKey);
    const safeName = firstName || "athlete";

    await resend.emails.send({
        from,
        to,
        subject: "Reinitialisation de votre mot de passe",
        text: `Bonjour ${safeName},\n\nVous avez demande une reinitialisation de mot de passe.\n\nCliquez ici pour choisir un nouveau mot de passe (lien valide 30 minutes):\n${resetUrl}\n\nSi vous n'etes pas a l'origine de cette demande, ignorez cet email.\n\n- ${audience}`,
        html: `<p>Bonjour ${safeName},</p><p>Vous avez demande une reinitialisation de mot de passe.</p><p><a href="${resetUrl}">Reinitialiser mon mot de passe</a> (lien valide 30 minutes)</p><p>Si vous n'etes pas a l'origine de cette demande, ignorez cet email.</p><p>- ${audience}</p>`,
    });

    return { sent: true };
}

module.exports = {
    sendResetPasswordEmail,
};
