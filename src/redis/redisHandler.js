import { createClient } from "redis";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
});


const redis_url = process.env.REDIS_URL;
const redis = createClient({url:redis_url});


// create redis object with all neccessary function 
redis.on("error",(err)=>{
            console.log('ERROR OCCURED DURING REDIS CONNECTION');
        })
redis.connect();

const Redis = {
    submit:async (jobId)=>{
           await redis.set(`job:${jobId}`, "SUBMITTED");
    },
    pending:async (jobId)=>{
           await redis.set(`job:${jobId}`, "PENDING");
    },
    completed: async (jobId)=>{
         await redis.set(`job:${jobId}`, "COMPLETED");
    },
    failed : async (jobId)=>{
        await redis.set(`job:${job.Id}`, "FAILED");
    }
}
console.log("redis working");


export default Redis;