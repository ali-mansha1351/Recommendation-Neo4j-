const { Schema, model } = require("mongoose");
const { isLowercase } = require("validator");

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

const questionPostSchema = new Schema({
  title: {
    type: String,
    required: true,
  },
  description: { 
    type: String,
    required: true,
  },
  relatedSkills: {
    type: [String],
    isLowercase:true,
  },
  questionImg: {
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
    default: [], // Remove default value of 0 if not intended
  },
  dislikes: {
    type: [String], // Ensure it's an array of strings (user IDs)
    default: [], // Remove default value of 0 if not intended
  },
  comments: [commentSchema], // Array of comment objects
  shares: [shareSchema],
});

const Question = model("Question", questionPostSchema);
module.exports = Question;
