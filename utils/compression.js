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
    console.log('Starting video compression');
    console.log('Original video size:', buffer.length / (1024 * 1024), 'MB');

    return new Promise((resolve, reject) => {
        const tempInput = `/tmp/temp-${Date.now()}-input.mp4`;
        const tempOutput = `/tmp/temp-${Date.now()}-output.mp4`;

        console.log('Writing to temp file:', tempInput);

        try {
            fs.writeFileSync(tempInput, buffer);
            console.log('Successfully wrote input file');

            ffmpeg(tempInput)
                .outputOptions([
                    '-c:v libx264',
                    '-crf 28',
                    '-preset faster',
                    '-c:a aac',
                    '-b:a 128k',
                    '-movflags +faststart', // Enable fast start for web playback
                    '-max_muxing_queue_size 9999' // Increase muxing queue size
                ])
                .output(tempOutput)
                .on('start', () => {
                    console.log('Started ffmpeg compression');
                })
                .on('progress', (progress) => {
                    console.log('Processing: ', progress.percent, '% done');
                })
                .on('end', () => {
                    console.log('Compression complete');
                    const compressedBuffer = fs.readFileSync(tempOutput);
                    console.log('Compressed video size:', compressedBuffer.length / (1024 * 1024), 'MB');

                    // Cleanup
                    fs.unlinkSync(tempInput);
                    fs.unlinkSync(tempOutput);

                    resolve(compressedBuffer);
                })
                .on('error', (err) => {
                    console.error('FFmpeg error:', err);
                    // Cleanup
                    if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
                    if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
                    reject(err);
                })
                .run();
        } catch (error) {
            console.error('Error in video compression:', error);
            reject(error);
        }
    });
}

async function compressMedia(buffer, mimetype) {
    if (mimetype.startsWith('image/')) {
        console.log("Compressing image");
        return await compressImage(buffer, mimetype);
    } else if (mimetype.startsWith('video/')) {
        console.log("Compressing video");
        return await compressVideo(buffer);
    }
    return buffer; // Return original buffer for other file types
}


module.exports = {
    compressImage,
    compressVideo,
    compressMedia
}; 