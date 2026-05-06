// this is already inside AWS Lambda > Functions > get-upload-url > Code Source

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
    region: "ap-southeast-2",
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED"
});

export const handler = async (event) => {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "http://localhost:8080",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
    };

    if (event.requestContext?.http?.method === "OPTIONS") {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: ""
        };
    }

    const bucket = "content-moderation-bucket-420";

    let fileName = "uploaded-file";

    if (event.body) {
        const requestBody = JSON.parse(event.body);
        fileName = requestBody.filename || fileName;
    }

    const key = `uploads/${fileName}`;

    const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 60 });

    return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
            uploadUrl,
            key
        })
    };
};