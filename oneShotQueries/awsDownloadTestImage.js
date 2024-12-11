const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Configure AWS
AWS.config.update({
    region: 'us-east-1',
    credentials: new AWS.Credentials({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    })
});

const s3 = new AWS.S3();

async function downloadFromS3() {
    try {
        // Set up S3 download parameters
        const params = {
            Bucket: "awsbucketprog",
            Key: "test-1733843739762.png" // Replace with your file key
        };

        // Set up the local file path where you want to save the downloaded file
        const downloadPath = path.join(__dirname, 'downloaded-image.png');

        console.log('Downloading from S3...');

        // Create a write stream
        const fileStream = fs.createWriteStream(downloadPath);

        // Get the file from S3 and pipe it to the write stream
        const s3Stream = s3.getObject(params).createReadStream();

        // Handle the download completion
        await new Promise((resolve, reject) => {
            s3Stream.pipe(fileStream)
                .on('error', error => reject(error))
                .on('finish', () => {
                    console.log('Download completed successfully');
                    console.log('File saved to:', downloadPath);
                    resolve();
                });
        });

    } catch (error) {
        console.error('Error:', error);
    }
}

// Run the test
downloadFromS3();
