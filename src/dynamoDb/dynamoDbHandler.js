import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import { createClient } from "redis";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
});




const REGION = process.env.AWS_REGION;
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME;

if (!REGION || !TABLE_NAME) {
  throw new Error("Missing AWS_REGION or DYNAMODB_TABLE_NAME");
}

const client = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(client);


const Dynamo = {
  createJob: async (job) => {
    return ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          id: job.id,
          status: "SUBMITTED",
          code: job.code,
          createdAt: new Date().toISOString(),
        },
        ConditionExpression: "attribute_not_exists(id)",
      })
    );
  },

  updateJob: async (jobId, status, result = null) => {
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

    return ddb.send(
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
  },
};

export default Dynamo;
