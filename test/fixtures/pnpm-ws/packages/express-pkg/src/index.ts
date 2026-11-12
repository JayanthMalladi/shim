import express from "express";
const app = express();
app.get("*", (req, res) => res.send("ok")); // E-splat (break)
export default app;
