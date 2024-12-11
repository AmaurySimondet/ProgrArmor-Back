
const AWS = require('aws-sdk');
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
const cloudfront = new AWS.CloudFront();

async function configureBucketCORS() {
    const corsParams = {
        Bucket: process.env.AWS_BUCKET_NAME,
        CORSConfiguration: {
            CORSRules: [
                {
                    AllowedHeaders: ['*'],
                    AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
                    AllowedOrigins: ['*'],
                    ExposeHeaders: ['ETag'],
                    MaxAgeSeconds: 3000
                }
            ]
        }
    };

    try {
        await s3.putBucketCors(corsParams).promise();
        console.log('Successfully set CORS configuration');
    } catch (err) {
        console.warn('Warning: Could not set CORS configuration. You may need to set it manually in the S3 console:', err.message);
        // Don't throw the error, just warn about it
    }
}


// Call this when initializing your application
configureBucketCORS().catch(console.error);