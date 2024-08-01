const mongoose = require("mongoose");
const validator = require("validator");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
//dont store the authentication tokens in the local storage, because it can easily excess by js code

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "please Enter your Name"],
    trim: true,
    maxLenght: [100, "Name cant be exceed 100 character"],
    default: 0.0,
  },

  email: {
    type: String,
    unique: false,
    required: [true, "Please enter your Email"],
    validate: [validator.isEmail, "Please enter a valid email address"],
  },

  user_type: {
    type: String,
    required: true,
    enum: {
      values: ["Student", "Mentor", "Recruiter"],
    },
  },
  password: {
    type: String,
    required: [true, "Please enter the password"],
    minlength: [6, "Your password must be longer than 6 characters"],
    select: false, // Don't display the password
  },
  avatar: {
    public_id: {
      type: String,
      //required: true,
    },
    url: {
      type: String,
      //required: true,
    },
  },
  gender: {
    type: String,
    enum: {
      values: ["Male", "Female"],
    },
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  userSkills: {
    type: Array,
    required:[true,"please enter your skills"],
  },
  userInterests:{
    type:Array,
    required:[true,"please enter your interests"],
    
},
  role: {
    type: String,
    default: "user",
  },
  following: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],
  followers: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],
  resetPasswordToken: String, //for email it using the token to the user with the reset password purposes
  resetPasswordExpire: Date, //expiry time for that token we sent to the user by email
});

//encrypting pass
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    next();
  }
  this.password = await bcrypt.hash(this.password, 10);
});
//compare user password

userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};
//return json tokens
userSchema.methods.getJwtToken = function () {
  return jwt.sign({ id: this._id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_TIME,
  });
};
//generate pass reset token
userSchema.methods.getResetPasswordToken = function () {
  //generte token
  const resetToken = crypto.randomBytes(20).toString("hex");
  //hash the token
  this.resetPasswordToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  //token expire time
  this.resetPasswordExpire = Date.now() + 30 * 60 * 1000;
  return resetToken;
};
const User = mongoose.model("User", userSchema);
module.exports = User;
