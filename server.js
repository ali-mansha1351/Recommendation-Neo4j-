const app = require("./app");
const dotenv = require("dotenv");
const {connectDatabase,connectGraphDB}= require("./config/database");

//handle Uncaught exception error
process.on("uncaughtException", (err) => {
  console.log(`ERROR: ${err.message}`);
  console.log("shutting down due to uncaught exception error");
  process.exit(1);
});

//setting up config file
dotenv.config({ path: "backend/config/config.env" });

connectDatabase();

const server = app.listen(process.env.PORT, () => {
  console.log(
    `servre started on port: ${process.env.PORT} in ${process.env.NODE_ENV} mode.`
  );
});

// handle unhandled promise rejection error
process.on("unhandledRejection", (err) => {
  console.log(`ERROR: ${err.message}`);
  console.log("shutting down the server due to unhandled promise rejection");
  server.close(() => {
    process.exit(1);
  });
});
