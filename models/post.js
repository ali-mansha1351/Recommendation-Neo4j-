const { Schema, model } = require("mongoose");

const replySchema = new Schema({
  text: {
    type: String,
    required: true,
  },
  user_id: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  timeStamp: {
    type: Date,
    default: Date.now,
  },
  likes: {
    type: [String], // Ensure it's an array of strings (user IDs)
    default: [], // Set default to an empty array
  },
  dislikes: {
    type: [String],
    default: [],
  },
});

const commentSchema = new Schema({
  text: {
    type: String,
    required: true,
  },
  user_id: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  timeStamp: {
    type: Date,
    default: Date.now,
  },
  likes: {
    type: [String], // Ensure it's an array of strings (user IDs)
    default: [], // Set default to an empty array
  },
  dislikes: {
    type: [String], // Ensure it's an array of strings (user IDs)
    default: [], // Set default to an empty array
  },
  replies: [replySchema], // Array of reply objects
});

const shareSchema = new Schema({
  user_id: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  sharedAt: {
    type: Date,
    default: Date.now,
  },
});

const postSchema = new Schema({
  title:{
    type:String,
  }
  ,description: {
    type: String,
  },
  postImg: {
    type: [String],
  },
  timeStamp: {
    type: Date,
    default: Date.now,
  },
  user_id: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  likes: {
    type: [String], // Ensure it's an array of strings (user IDs)
    default: [],
  },
  dislikes: {
    type: [String], // Ensure it's an array of strings (user IDs)
    default: [],
  },
  comments: [commentSchema], // Array of comment objects
  shares: [shareSchema], // Array of share objects
});

const userPost = model("userPost", postSchema);
module.exports = userPost;
