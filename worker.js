import executeCppHardened from "./executor.js";
import {
    SQSClient,
    ReceiveMessageCommand,
    DeleteMessageCommand,
} from "@aws-sdk/client-sqs";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    PutCommand,
    UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

// ---------- CONFIG ----------
const REGION = "ap-south-1";
const QUEUE_URL =
    "https://sqs.ap-south-1.amazonaws.com/968626156509/boxxy_queue";
const TABLE_NAME = "boxxyStorage";

// ---------- CLIENTS ----------
const sqs = new SQSClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: REGION })
);

// ---------- UTILS ----------
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/*
 DynamoDB Item Shape

 {
   jobId: string,        // partition key
   status: SUBMITTED | COMPLETED | FAILED
   code: string,
   result: string,
   createdAt: ISOString,
   updatedAt: ISOString
 }
*/

// ---------- DB FUNCTIONS ----------

// create job only once (idempotent)
async function createJob(job) {
    console.log("Creating job:", job);
    await ddb.send(
        new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                id: job.id,
                status: "SUBMITTED",
                code: job.code,
                createdAt: new Date().toISOString(),
            },
            ConditionExpression: "attribute_not_exists(jobId)",
        })
    );
}

// update job status + result
async function updateJob(jobId, status, result = null) {
    const updateExpr = result
        ? "SET #s = :s, #r = :r, updatedAt = :u"
        : "SET #s = :s, updatedAt = :u";

    const values = result
        ? {
            ":s": status,
            ":r": result,
            ":u": new Date().toISOString(),
        }
        : {
            ":s": status,
            ":u": new Date().toISOString(),
        };

    await ddb.send(
        new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { id: jobId },
            UpdateExpression: updateExpr,
            ExpressionAttributeNames: {
                "#s": "status",
                "#r": "result",
            },
            ExpressionAttributeValues: values,
        })
    );
}

// ---------- CONSUMER ----------
async function startConsumer() {
    console.log("SQS consumer started...");

    while (true) {
        try {
            const response = await sqs.send(
                new ReceiveMessageCommand({
                    QueueUrl: QUEUE_URL,
                    MaxNumberOfMessages: 1,
                    WaitTimeSeconds: 8,
                    VisibilityTimeout: 60,
                })
            );

            if (!response.Messages || response.Messages.length === 0) {
                await sleep(1000);
                continue;
            }

            for (const msg of response.Messages) {
                const receiptHandle = msg.ReceiptHandle;

                try {
                    const job = JSON.parse(msg.Body);
                    console.log("Processing job:", job.id);

                    // 1️⃣ create job (idempotent)
                    try {
                        await createJob(job);
                    } catch (e) {
                        if (e.name === "ConditionalCheckFailedException") {
                            console.log("Duplicate job detected, skipping:", job.id);
                            await sqs.send(
                                new DeleteMessageCommand({
                                    QueueUrl: QUEUE_URL,
                                    ReceiptHandle: receiptHandle,
                                })
                            );
                            continue;
                        }
                        throw e;
                    }

                    // 2️⃣ execute code
                    const result = await executeCppHardened(job.code);

                    // 3️⃣ mark completed
                    await updateJob(job.id, "COMPLETED", result);

                    // 4️⃣ delete SQS message
                    await sqs.send(
                        new DeleteMessageCommand({
                            QueueUrl: QUEUE_URL,
                            ReceiptHandle: receiptHandle,
                        })
                    );

                    console.log("Job completed:", job.id);
                } catch (err) {
                    console.error("Job failed:", err);

                    if (msg?.Body) {
                        const job = JSON.parse(msg.Body);
                        await updateJob(job.id, "FAILED", String(err));
                    }

                    // DO NOT delete → SQS will retry
                }
            }
        } catch (err) {
            console.error("Polling error:", err);
            await sleep(5000);
        }
    }
}

// ---------- START ----------
startConsumer();
