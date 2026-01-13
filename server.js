import "dotenv/config";
import express from "express";
import { executeCppFirejail } from "./executor.js";
const app = express();

// first configure fire jail


/*

FOR TESTING ONLY 
NOT NEEDED IN PRODUCTION


*/
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server started on port ${PORT}`);
});


app.post("/execute", async (req, res) => {
    const { code, language } = req.body;
    const result = await executeCppFirejail(code, {});
    console.log(result);
    res.json(result);
});