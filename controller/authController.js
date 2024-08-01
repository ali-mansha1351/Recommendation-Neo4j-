const User = require("../models/user");
const Job = require("../models/job");
const Quest = require("../models/question")
const ErrorHandler = require("../utils/errorHandler");
const catchAsycError = require("../middlewares/catchAsyncError");
const sendToken = require("../utils/jwtToken");
const sendEmail = require("../utils/sendEmail");
const crypto = require("crypto");
const APIFeatures = require("../utils/apiFeatures");
const {connectGraphDB} = require("../config/database");
const catchAsyncError = require("../middlewares/catchAsyncError");
//
//function to create index/constraint in neo4j db on a node
async function createConstraintOnPerson(){
  const driver = await connectGraphDB();
  const session = driver.session();
  try{
    const result = await session.run(
      `
      CREATE CONSTRAINT IF NOT EXISTS FOR (n:Person) REQUIRE n.mongoId IS UNIQUE;
      `
    );
    console.log("successfully created consraint on person node");
  }catch(error){
    console.log("failed to create constraint on person node",error);
  }finally{
    await session.close();
  }
}
exports.registerUser = catchAsycError(async (req, res, next) => {
  const user = await User.create(req.body);
  const postId = user._id.toString();
  // name,
  //   email,
  //   password,
  //   avatar: {
  //     public_id: "Avatars/profile2_s06hd6",
  //     url: "https://res.cloudinary.com/dofw1gtdq/image/upload/v1704882191/shopit/user/Avatars/profile2_s06hd6.jpg",
  //   },
  // const token = user.getJwtToken();
  // res.status(201).json({
  //   success: true,
  //   token,
  // });


  //creating user in neo4j db
  const driver = await connectGraphDB();
  const session = driver.session();
  const {name,user_type,userSkills,userInterests} = req.body;
    try{
        const result = await session.run(
            `CREATE(p:Person{
                name: $name,
                mongoId:$postId,
                user_type:$user_type

            })
            WITH p
            UNWIND $userSkills AS skillName
            MERGE(s:Interest {name:skillName})
            MERGE (p)-[h:HAS_SKILL]->(s) ON CREATE SET h.score=0
            WITH p,collect(s) AS skills
            UNWIND $userInterests AS interestName
            MERGE(i:Interest {name:interestName})
            MERGE (p)-[s:IS_INTERESTED_IN]->(i) ON CREATE SET s.score=0
            RETURN p, skills , collect(i) AS interests
            `,
            {name,postId,user_type,userSkills,userInterests}
        );

        console.log('User created in Neo4j:', result.records[0].get('p').properties);

    }catch(error){
        console.log("error creating user in nodejs",error);
        res.status(500);
    }finally{
        await session.close();
    }
    createConstraintOnPerson();
  sendToken(user, 200, res);
});

//loginuser
exports.loginUser = catchAsycError(async (req, res, next) => {
  const { email, password } = req.body;
  //checking the enterend email and pass
  if (!email || !password) {
    return next(new ErrorHandler("please enter email and password", 401));
  }
  //finding user in database
  const user = await User.findOne({ email }).select("+password");

  if (!user) {
    return next(new ErrorHandler("invalid email or password", 401));
  }
  //checking password

  const isPasswordMatched = await user.comparePassword(password);

  if (!isPasswordMatched) {
    return next(new ErrorHandler("invalid email or password", 401));
  }
  // const token = user.getJwtToken();
  // res.status(200).json({
  //   success: true,
  //   token,
  // });
  sendToken(user, 200, res);
});

//forgot  password
exports.forgotPassword = catchAsycError(async (req, res, next) => {
  const user = await User.findOne({ email: req.body.email });
  if (!user) {
    return next(new ErrorHandler("user not found with this email", 404));
  }
  //get reset token

  const resetToken = user.getResetPasswordToken();
  await user.save({ validateBeforeSave: false });

  //email part
  //reset password url
  const resetUrl = `${req.protocol}://${req.get(
    "host"
  )}/api/v1/password/reset/${resetToken}`;
  const message = `your password reset token is as follow:\n\n ${resetUrl} \n\nIf you have not requested this email, then ignore it.`;
  //now send this token via email

  try {
    await sendEmail({
      email: user.email,
      subject: "DevConnect Password Recovery",
      message,
    });
    res.status(200).json({
      success: true,
      message: `email sent to ${user.email}`,
    });
  } catch (error) {
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    await user.save({ validateBeforeSave: false });
    return next(new ErrorHandler(error.message, 500));
  }
});
exports.resetPassword = catchAsycError(async (req, res, next) => {
  //has url token then check into the db
  const resetPasswordToken = crypto
    .createHash("sha256")
    .update(req.params.token)
    .digest("hex");
  const user = await User.findOne({
    resetPasswordToken,
    resetPasswordExpire: { $gt: Date.now() },
  });
  if (!user) {
    return next(
      new ErrorHandler(
        "password reset token is invalid or has been expired",
        400
      )
    );
  }
  if (req.body.password !== req.body.confirmPassword) {
    return next(new ErrorHandler("password doesnot match", 400));
  }
  //setup new pass
  user.password = req.body.password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;

  await user.save();
  sendToken(user, 200, res);
});
//get currently logged in users
exports.getUserProfile = catchAsycError(async (req, res, next) => {
  const user = await User.findById(req.user.id);

  res.status(200).json({
    success: true,
    user,
  });
});

//update/ change password
exports.updatePassword = catchAsycError(async (req, res, next) => {
  const user = await User.findById(req.user.id).select("+password");
  //check previous user password
  const isMatched = await user.comparePassword(req.body.oldPassword);
  if (!isMatched) {
    return next(new ErrorHandler("old password is incorrect", 400));
  }
  user.password = req.body.password;
  await user.save();
  sendToken(user, 200, res);
});

//update user profile
exports.updateProfile = catchAsycError(async (req, res, next) => {
  const newUserData = {
    name: req.body.name,
    email: req.body.email,
  };

  //update avatar todo
  const user = await User.findByIdAndUpdate(req.user.id, newUserData, {
    new: true,
    runValidators: true,
    useFindAndModify: false,
  });
  res.status(200).json({
    success: true,
  });
});

//cookies are sent from server in the http request
//http cookie is not accessed on the FE using any js code
//we dont use local storage to stora the cookies thats why we use http cookie to make it more secure

//logout
exports.logout = catchAsycError(async (req, res, next) => {
  res.cookie("token", null, {
    expires: new Date(Date.now()),
    httpOnly: true,
  });
  res.status(200).json({
    success: true,
    message: "logout",
  });
});

//admin routes

//get all users
exports.allUsers = catchAsycError(async (req, res, next) => {
  const users = await User.find();

  res.status(200).json({
    success: true,
    users,
  });
});

//get specific users
exports.getUserDetails = catchAsycError(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(
      new ErrorHandler(`user doesnot exist with id: ${req.params.id}`)
    );
  }
  res.status(200).json({
    success: true,
    user,
  });
});

//get specific user by keyword
exports.searchUser = catchAsycError(async (req, res, next) => {
  const apiFeatures = new APIFeatures(User.find(), req.query).searchUser();
  const users = await apiFeatures.query;

  res.status(200).json({
    success: true,
    count: users.lenght,
    users,
  });
});

//only admins can acccess this
exports.updateUser = catchAsycError(async (req, res, next) => {
  const newUserData = {
    name: req.body.name,
    email: req.body.email,
    role: req.params.role,
  };

  //update avatar todo
  const user = await User.findByIdAndUpdate(req.params.id, newUserData, {
    new: true,
    runValidators: true,
    useFindAndModify: false,
  });
  res.status(200).json({
    success: true,
  });
});

//del admin
exports.deleteUser = catchAsycError(async (req, res, next) => {
  const user = await User.findById(req.params.id);
  const userId = req.params.id.toString();
  const driver = await connectGraphDB();
  const session = driver.session();

  if (!user) {
    return next(
      new ErrorHandler(`user doesnot exist with id: ${req.params.id}`)
    );
  }
  //remove avatar from clodinary todo
  await user.deleteOne();
  try{
    await session.run(
      `MATCH (n:Person{mongoId:$userId})
      DETACH DELETE n;
      `,
      {userId}
    );
    console.log("user successfuly deleted from neo4j db");
  }catch(error){
    console.log("could not delete user",error);
  }finally{
    await session.close();
  }
  res.status(200).json({
    success: true,
  });
});

exports.followUser = catchAsycError(async (req, res, next) => {
  const userToFollow = await User.findById(req.params.id);
  const currentUser = await User.findById(req.user.id);
  const user_to_follow = req.params.id.toString();
  const current_user = req.user.id.toString();
  const driver = await connectGraphDB();
  const session = driver.session();

  if (!userToFollow) {
    return next(new ErrorHandler("User not found", 404));
  }

  if (userToFollow._id.equals(currentUser._id)) {
    return next(new ErrorHandler("You cannot follow yourself", 400));
  }
  if (currentUser.following.includes(userToFollow._id)) {
    return next(new ErrorHandler("You already follow this user", 400));
  }

  userToFollow.followers.push(currentUser._id);
  currentUser.following.push(userToFollow._id);

  

  await userToFollow.save();
  await currentUser.save();

  console.log(current_user);
  console.log(user_to_follow);
  try{
    const result = await session.run(
      `MATCH (u1:Person{mongoId:$current_user}),(u2:Person{mongoId:$user_to_follow})
      MERGE (u1)-[:FOLLOWING]->(u2)
      RETURN u1,u2`,
      {current_user,user_to_follow}
    );
    console.log("following relationship developed between users in neo4j");
  }catch(error){
    console.log("error following the user",error);
  }finally{
    await session.close();
  }
  
  res.status(200).json({
    success: true,
    message: "Successfully followed the user",
  });
});

// Unfollow a user
exports.unfollowUser = catchAsycError(async (req, res, next) => {
  const userToUnfollow = await User.findById(req.params.id);
  const currentUser = await User.findById(req.user.id);
  const user_to_unfollow = req.params.id.toString();
  const current_user = req.user.id.toString();
  const driver = await connectGraphDB();
  const session = driver.session();

  if (!userToUnfollow) {
    return next(new ErrorHandler("User not found", 404));
  }

  if (!currentUser.following.includes(userToUnfollow._id)) {
    return next(new ErrorHandler("You do not follow this user", 400));
  }

  userToUnfollow.followers = userToUnfollow.followers.filter(
    (followerId) => !followerId.equals(currentUser._id)
  );
  currentUser.following = currentUser.following.filter(
    (followingId) => !followingId.equals(userToUnfollow._id)
  );

  await userToUnfollow.save();
  await currentUser.save();

  try{
    const result = await session.run(
      `MATCH (u1:Person {mongoId:$current_user})-[r:FOLLOWING]->(u2:Person {mongoId: $user_to_unfollow})
      DELETE r
      RETURN u1, u2`,
      {current_user,user_to_unfollow}
    );
    console.log("user unfollowed successfully in neo4j db");
  }catch(error){
    console.log("error unfollowing user in neo4j db",error);
  }finally{
    await session.close();
  }
  res.status(200).json({
    success: true,
    message: "Successfully unfollowed the user",
  });
});

// /api/v1/getrecommendations
exports.getRecommendation = catchAsyncError(async(req,res,next)=>{
    const driver = await connectGraphDB();
    const session =  driver.session();
    const userid = req.user.id.toString();
    var result;
    var jobPosts;
    var questionPosts;
  try{
    result = await session.run(
      `
      MATCH (user:Person {mongoId:$userid})
      OPTIONAL MATCH (user)-[:HAS_SKILL]->(skill:Interest)
      OPTIONAL MATCH (user)-[:IS_INTERESTED_IN]->(interest:Interest)
      WITH user, collect(DISTINCT skill.name) AS userSkills, collect(DISTINCT interest.name) AS userInterests

      MATCH (post:Post)
      OPTIONAL MATCH (post)-[:RELATED_SKILL]->(postSkill:Interest)
      WITH user, userSkills, userInterests, post, collect(DISTINCT postSkill.name) AS postSkills

      WITH user, userSkills, userInterests, post, postSkills,
          size([s IN userSkills WHERE s IN postSkills]) AS skillIntersectionSize,
          size(userSkills) AS userSkillCount,
          size(postSkills) AS postSkillCount,
          size([i IN userInterests WHERE i IN postSkills]) AS interestIntersectionSize,
          size(userInterests) AS userInterestCount

      WITH user, post,
          CASE WHEN userSkillCount * postSkillCount > 0 THEN
                toFloat(skillIntersectionSize) / (sqrt(toFloat(userSkillCount)) * sqrt(toFloat(postSkillCount)))
          ELSE 0.0 END AS skillSimilarity,
          CASE WHEN userInterestCount * postSkillCount > 0 THEN
                toFloat(interestIntersectionSize) / (sqrt(toFloat(userInterestCount)) * sqrt(toFloat(postSkillCount)))
          ELSE 0.0 END AS interestSimilarity,
          (toFloat(skillIntersectionSize) + toFloat(interestIntersectionSize)) / (toFloat(userSkillCount + userInterestCount + postSkillCount)) AS combinedSimilarity

      WHERE NOT EXISTS{
      MATCH (user)-[:LIKES]->(likedPost:Post)
      WHERE  post = likedPost}

      WITH post, combinedSimilarity
      WHERE combinedSimilarity > 0
      RETURN post.mongoId AS postId, combinedSimilarity AS similarity
      ORDER BY similarity DESC
      LIMIT 16

      `,{userid}
    );
    
    var recommend = result.records.map(record=>({
      postId : record.get('postId'),
      similarity: record.get('similarity')
    }));

    var postIds = recommend.map(item=>item.postId);
    var similaritys = recommend.map(item=>item.similarity);

    jobPosts = await Job.find({_id:{$in:postIds}});
    questionPosts = await Quest.find({_id:{$in:postIds}}).lean();
    //console.log("job posts",jobPosts);
    //console.log("question posts",questionPosts);

    const allPosts = [...jobPosts, ...questionPosts];
    // Create a map to store posts by their IDs
    const postMap = {};
    allPosts.forEach(post => {
      postMap[post._id.toString()] = post;
    });

    // Reorder posts according to the similarity scores
    const orderedPosts = postIds.map(id => ({
      post: postMap[id],
      similarity: similaritys[postIds.indexOf(id)]
    }));

    //maintining order as of similarity score returned by query
    res.status(200).json({
      success: true,
      orderedPosts
    });
   
  }catch(error){
    console.log(error);
  }finally{
    await session.close();
  }




});