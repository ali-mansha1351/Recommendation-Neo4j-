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
const jobSchema = new Schema({
  position: {
    type: String,
    required: [true, "pleasse enter job position"],
    maxLength: [50, "job position cannot exceed 50 characters"],
  },
  jobDescription: {
    type: String,
    required: [true, "pleasse enter job description"],
    maxLength: [500, "job description cannot exceed 500 characters"],
  },
  content: [
    {
      public_id: {
        type: String,
        //required: true,
      },
      url: {
        type: String,
        //required: true,
      },
    },
  ],
  requiredSkills: {
    type: [String],
    default: [],
    required: [true, "add skills required for the job"],
    isLowercase:true,
  },
  educationRequirement: {
    type: String,
    required: [
      true,
      "add minimum education needed to be eligible for your job",
    ],
  },
  experienceRequirement: {
    type: String,
    required: [true, "add experience needed to be eligible for this job"],
  },
  contactDetails: [
    {
      phoneNumber: {
        type: String,
        required: true,
      },
      email: {
        type: String,
        required: true,
      },
    },
  ],
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
    default: [], // Remove default value of 0 if not intended
  },
  dislikes: {
    type: [String], // Ensure it's an array of strings (user IDs)
    default: [], // Remove default value of 0 if not intended
  },
  comments: [commentSchema], // Array of comment objects
  shares: [shareSchema],
});

const jobPost = model("jobPost", jobSchema);
module.exports = jobPost;
