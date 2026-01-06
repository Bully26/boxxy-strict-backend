
import executeCppHardened from "./executor";
/*
What will the worker do?

first try to get message from message queue
update the task id as submitted
execute the code
update the task id as completed
save the result to dynamo db 


// ok this will work i guess
// but we have to make docker file out of it i guess

*/


// there will a infinte for loop which runs as worker
// its run a function continously



function getJob() {
  /*

   this should be a continous process 
   will get task id 
   input 
   code 
   language 
  */
   // fetch job from message queue
   // return it 

   return {};
   
   
}
function updateJobStatus(id, status) {
    
}


function saveResultToDynamoDB(id, result) {
    
}   


function worker() {
   
    // select job from message queue execute it and update the status 
    
    const job = getJob();
    if(!job)
    {
        sleep(1000);
        return;
    }
    // update the job status
    const updateJob = updateJobStatus(job.id, "submitted");

    // now execute the code
   
    const result = executeCppHardened(job.code, job.language);

    // update the job status

    const completedJob = updateJobStatus(job.id, result);

    // save the result to dynamo db
    saveResultToDynamoDB(job.id, result);

    return ;
}
// now its done we have to make docker file for this code 
