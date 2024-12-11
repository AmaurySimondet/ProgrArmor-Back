const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Configure AWS
AWS.config.update({
    region: 'us-east-1', // Update with your region
    credentials: new AWS.Credentials({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    })
});

const s3 = new AWS.S3();
const cloudfront = new AWS.CloudFront();

async function uploadToS3AndInvalidate() {
    try {
        // Read test image
        const resolvedPath = '/Users/amaury.simondet/Developer/Perso/ProgrArmor-Back/android-chrome-512x512.png';
        const fileContent = fs.readFileSync(resolvedPath);

        // Set up S3 upload parameters
        const params = {
            Bucket: "awsbucketprog",
            Key: `test-${Date.now()}.png`,
            Body: fileContent,
            ContentType: 'image/png'
        };

        // Upload to S3
        console.log('Uploading to S3...');
        const uploadResult = await s3.upload(params).promise();
        console.log('Upload Success:', uploadResult.Location);

        // Create CloudFront invalidation
        const invalidationParams = {
            DistributionId: 'E29BSRHXOM9Q3J',
            InvalidationBatch: {
                CallerReference: Date.now().toString(),
                Paths: {
                    Quantity: 1,
                    Items: ['/*'] // Invalidate all paths
                }
            }
        };

        console.log('Creating invalidation...');
        const invalidationResult = await cloudfront.createInvalidation(invalidationParams).promise();
        console.log('Invalidation created:', invalidationResult.Invalidation.Id);

        console.log('CloudFront URL:', 'https://d28n1fykqesg8f.cloudfront.net/' + params.Key);

    } catch (error) {
        console.error('Error:', error);
    }
}

// Run the test
uploadToS3AndInvalidate();
