const express = require("express");
const app = express();
const cookieParser = require("cookie-parser");
const errorMiddleware = require("./middlewares/errors");

app.use(express.json());
app.use(cookieParser()); // Corrected: Invoke cookieParser as a function

const questions = require("./routes/question");
const post = require("./routes/post");
const job = require("./routes/job");
const auth = require("./routes/auth");

// .use means make use of it in all the routes
app.use("/api/v1", questions);
app.use("/api/v1", post);
app.use("/api/v1", auth);
app.use("/api/v1", job);
app.use(errorMiddleware);

module.exports = app;
