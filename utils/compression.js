const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');

async function compressImage(buffer, mimetype) {
    // Only compress if it's an image
    if (!mimetype.startsWith('image/')) {
        return buffer;
    }

    const compressedImage = await sharp(buffer)
        .rotate()
        .resize(1920, 1080, { // Max dimensions while maintaining aspect ratio
            fit: 'inside',
            withoutEnlargement: true
        })
        .jpeg({ quality: 80 }) // Compress to JPEG with 80% quality
        .toBuffer();

    return compressedImage;
}

async function compressVideo(buffer) {
    return new Promise((resolve, reject) => {
        const tempInput = `temp-${Date.now()}-input.mp4`;
        const tempOutput = `temp-${Date.now()}-output.mp4`;

        // Write buffer to temporary file
        fs.writeFileSync(tempInput, buffer);

        ffmpeg(tempInput)
            .outputOptions([
                '-c:v libx264',     // video codec
                '-crf 28',          // compression quality (23-28 is a good range)
                '-preset faster',    // encoding speed preset
                '-c:a aac',         // audio codec
                '-b:a 128k'         // audio bitrate
            ])
            .output(tempOutput)
            .on('end', () => {
                // Read the compressed file back into a buffer
                const compressedBuffer = fs.readFileSync(tempOutput);

                // Clean up temp files
                fs.unlinkSync(tempInput);
                fs.unlinkSync(tempOutput);

                resolve(compressedBuffer);
            })
            .on('error', (err) => {
                // Clean up temp files
                if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
                if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);

                reject(err);
            })
            .run();
    });
}

async function compressMedia(buffer, mimetype) {
    if (mimetype.startsWith('image/')) {
        return await compressImage(buffer, mimetype);
    } else if (mimetype.startsWith('video/')) {
        return await compressVideo(buffer);
    }
    return buffer; // Return original buffer for other file types
}

module.exports = {
    compressImage,
    compressVideo,
    compressMedia
}; 