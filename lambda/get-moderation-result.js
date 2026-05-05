// this is already inside AWS Lambda > Functions > get-moderation-results > Code Source Ben

import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";

const dynamo = new DynamoDBClient({ region: "ap-southeast-2" });

export const handler = async (event) => {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "http://localhost:8080",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS"
    };

    if (event.requestContext?.http?.method === "OPTIONS") {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: ""
        };
    }

    try {
        const imageKey = event.queryStringParameters?.imageKey;

        if (!imageKey) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ error: "Missing imageKey" })
            };
        }

        const result = await dynamo.send(new GetItemCommand({
            TableName: "image-moderation-results",
            Key: {
                imageKey: { S: imageKey }
            }
        }));

        if (!result.Item) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ error: "Result not found" })
            };
        }

        const moderationLabelsRaw = result.Item.moderationLabels?.S || "[]";
        const moderationLabelsParsed = JSON.parse(moderationLabelsRaw);

        const labelNames = moderationLabelsParsed.map(function (label) {
            return label.Name;
        });

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                imageKey: result.Item.imageKey?.S,
                bucketName: result.Item.bucketName?.S,
                status: result.Item.status?.S,
                moderationLabels: labelNames
            })
        };
    } catch (error) {
        console.error("Error reading moderation result:", error);

        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: "Internal server error" })
        };
    }
};