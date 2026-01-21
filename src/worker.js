import path from "path";
import dotenv from "dotenv";

dotenv.config({
  path: path.resolve('../.', ".env"),
});

import executeCppHardened from "./executor.js";

// import { createClient } from "redis";
import redis from './redis/redisHandler.js'
import sqs from './sqs/SqsHandler.js'
import Dynamo from "./dynamoDb/dynamoDbHandler.js"



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


// ---------- CONSUMER ----------
async function startConsumer() {
    console.log("SQS consumer started...");

    while (true) {
        try {
            const response = await sqs.receive();

            if (!response.Messages || response.Messages.length === 0) {
                await sleep(1000);
                continue;
            }

            for (const msg of response.Messages) {
                const receiptHandle = msg.ReceiptHandle;

                try {
                    const job = JSON.parse(msg.Body);

                    // await redisSubmitted(job.id);
                    redis.submit(job.id);
                    console.log("Processing job:", job.id);

                    //  create job (idempotent)
                    try {
                        await Dynamo.createJob(job);
                    } catch (e) {
                         // chekcing for dup
                        if (e.name === "ConditionalCheckFailedException") {
                            console.log("Duplicate job detected, skipping:", job.id);


                            await sqs.remove();
                            //## delete
                            continue;
                        }
                        throw e;
                    }

                    // execute code
                    // await redisPending(job.id);

                    await redis.pending(job.id);
                    const result = await executeCppHardened(job.code, job.input);

                    //  mark completed
                    // await redisCompleted(job.id);
                    await redis.completed(job.id);
                   
                    await Dynamo.updateJob(job.id, "COMPLETED", result);

                    // delete SQS message
                    await sqs.remove();

                    console.log("Job completed:", job.id);
                } catch (err) {
                    console.error("Job failed:", err);

                    if (msg?.Body) {
                        const job = JSON.parse(msg.Body);

                        await redis.failed(job.id);
                        await Dynamo.updateJob(job.id, "FAILED", String(err));
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
