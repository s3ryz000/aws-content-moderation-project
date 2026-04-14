// this is already inside AWS Lambda > Functions > process-image > Code Source

import { RekognitionClient, DetectModerationLabelsCommand } from "@aws-sdk/client-rekognition";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

const rekognition = new RekognitionClient({ region: "ap-southeast-2" });
const dynamo = new DynamoDBClient({ region: "ap-southeast-2" });

export const handler = async (event) => {
    try {
        for (const record of event.Records) {
            const bucket = record.s3.bucket.name;
            const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

            const command = new DetectModerationLabelsCommand({
                Image: {
                    S3Object: {
                        Bucket: bucket,
                        Name: key
                    }
                },
                MinConfidence: 70
            });

            const response = await rekognition.send(command);

            const labels = response.ModerationLabels || [];
            const status = labels.length > 0 ? "FLAGGED" : "APPROVED";

            await dynamo.send(new PutItemCommand({
                TableName: "image-moderation-results",
                Item: {
                    imageKey: { S: key },
                    bucketName: { S: bucket },
                    status: { S: status },
                    moderationLabels: { S: JSON.stringify(labels) }
                }
            }));

            console.log(`Processed ${key} -> ${status}`);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Processing complete" })
        };
    } catch (error) {
        console.error("Error processing image:", error);
        throw error;
    }
};