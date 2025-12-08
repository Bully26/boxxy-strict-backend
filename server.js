import express from "express";
import { executeCppFirejail } from "./executor.js";
const app = express();

// first configure fire jail

app.use(express.json());

app.listen(3000, () => {
    console.log("Server started on port 3000");
});


app.post("/execute", async (req, res) => {
    const { code, language } = req.body;
    const result = await executeCppFirejail(code, {});
    console.log(result);
    res.json(result);
});