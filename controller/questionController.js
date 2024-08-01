const express = require("express");
const router = express.Router();
const QuestionPost = require("../models/question");
const User = require("../models/user");
const { body, validationResult } = require("express-validator");
const ErrorHandler = require("../utils/errorHandler");
const catchAsyncError = require("../middlewares/catchAsyncError");
const APIFeatures = require("../utils/apiFeatures");
const {connectGraphDB} = require("../config/database");
const { session } = require("neo4j-driver");

// Validation middleware for creating a new question post
// const validateQuestionPost = [
//   body("title").trim().isLength({ min: 1 }).withMessage("Title is required"),
//   body("description")
//     .trim()
//     .isLength({ min: 1 })
//     .withMessage("Description is required"),
//   body("relatedSkills")
//     .isArray()
//     .withMessage("Related skills must be an array"),
//   body("questionImage")
//     .optional()
//     .isURL()
//     .withMessage("Invalid URL format for question image"),
//   body("user_id").isMongoId().withMessage("Invalid user ID"),
// ];

// POST endpoint for creating a new question post
exports.questionPost = catchAsyncError(async (req, res) => {
  req.body.user_id = req.user.id;
  const userId = req.user.id.toString();
  const driver = await connectGraphDB();
  const session = driver.session();
  const question = await QuestionPost.create(req.body);
  const quesId = question._id.toString();
  const {title,relatedSkills} = req.body;
  try{
    await session.run(`
      MATCH (u:Person{mongoId:$userId})
      CREATE (p:Post{
        mongoId:$quesId,
        name :$title
      })
      WITH p,u
      UNWIND $relatedSkills as relSkill
      MERGE (r:Interest {name:relSkill})
      MERGE (p)-[:REQUIRED_SKILL]->(r)
      WITH p,u
      MERGE (u)-[:CREATED]->(p)
    `,{userId,quesId,relatedSkills,title}
  );
  console.log("success in ques post creation in neo4j db");
  }catch(error){
    console.log(error);
  }finally{
    await session.close();
  }
  res.status(201).json({
    success: true,
    question,
  });
  
});
exports.searchQuestion = catchAsyncError(async (req, res, next) => {
  const apiFeatures = new APIFeatures(
    QuestionPost.find(),
    req.query
  ).searchQuestion();
  const questions = await apiFeatures.query;

  res.status(200).json({
    success: true,
    count: questions.lenght,
    questions,
  });
});

exports.getQuestions = catchAsyncError(async (req, res) => {
  const questions = await QuestionPost.find();
  //pagination, search,filter
  if (questions) {
    res.status(200).json({
      success: true,
      message: "hello",
      count: questions.lenght,
      questions,
    });
  }
});
//we need id to update

exports.updateQuestion = catchAsyncError(async (req, res, next) => {
  let questions = await QuestionPost.findById(req.params.id);
  if (!questions) {
    return next(new ErrorHandler("Question not found", 404));
  }
  questions = await QuestionPost.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
    useFindAndModify: false,
  });
  res.status(200).json({
    sucess: true,
    questions,
  });
});

exports.deleteQuestion = async (req, res) => {
  const question = await QuestionPost.findById(req.params.id);
  const quesId = req.params.id.toString();
  const driver = await connectGraphDB();
  const session = driver.session();
  if (!question) {
    res.status(404).json({
      success: false,
      message: "Question not found",
    });
  }
  try{
    await session.run(
      `MATCH (p:Post{mongoId:$quesId})
      DETACH DELETE p`,
      {quesId}
    );
    console.log("ques post deleted successfully");
  }catch(error){
    console.log(error);
  }finally{
    await session.close();
  }

  //del images too how
  await question.deleteOne(); //think of await
  res.status(200).json({
    sucess: true,
    message: "question deleted",
  });
};

//get comment section
exports.questionComments = catchAsyncError(async (req, res, next) => {
  try {
    const { postId } = req.params;
    const question = await QuestionPost.findById(postId);
    if (!question) {
      return next(new ErrorHandler("Question post not found", 404));
    }
    const comments = question.comments;
    res.status(200).json({ success: true, comments });
  } catch (error) {
    next(error);
  }
});
//function for gwettig new interest and updating mongodb on replying on a comment
async function updateUserInterestsForComment(userId,quesid,userid){
  const driver = await connectGraphDB();
  const session = driver.session();
  try{
    const newInterestResults = await session.run(`MATCH (u:Person{mongoId:$userId})-[:COMMENTED_ON]->(p:Post{mongoId:$quesid})
    OPTIONAL MATCH (p)-[:REQUIRED_SKILL]->(pI:Interest)
    WHERE NOT EXISTS((u)-[:HAS_SKILL|IS_INTERESTED_IN]->(pI)) AND pI IS NOT NULL
    MERGE (u)-[:IS_INTERESTED_IN]->(pI)
    RETURN  collect(DISTINCT pI) AS newInterests`,{userId,quesid});
    

    //geeting new skills from cypher query
    const newUserInterests = newInterestResults.records[0].get("newInterests").map(interest=>interest.properties.name);
    //console.log(newUserInterests);
     await User.findByIdAndUpdate(
       {_id : userid},
       {$addToSet:{userInterests:{$each:newUserInterests}}}
     )
    
  }catch(error){
    console.error(error);
  }finally{
    await session.close();
  }
}
//post comment
exports.postComment = catchAsyncError(async (req, res, next) => {
  try {
    const { postId } = req.params;
    const { text } = req.body;
    const driver = await connectGraphDB();
    const session = driver.session();
    const userId = req.user.id.toString();
    const quesid = req.params.postId.toString();
    // Retrieve the ID of the currently logged-in user
    const user_id = req.user.id;

    // Find the question post by ID
    const question = await QuestionPost.findById(postId);
    if (!question) {
      return next(new ErrorHandler("Question post not found", 404));
    }

    // Create the new comment object
    const newComment = {
      text,
      user_id,
      timeStamp: new Date(), // Optionally, you can add a timestamp for the comment
    };

    // Push the new comment to the question post's comments array
    question.comments.push(newComment);

    // Save the updated question post
    await question.save();

    //establishing comment realtion in neo4j db
    await session.run(`
    MATCH (u:Person{mongoId:$userId}), (p:Post{mongoId:$quesid})
    MERGE (u)-[r:COMMENTED_ON]->(p)
    ON CREATE SET r.count = 1
    ON MATCH SET r.count = r.count+1
    WITH u, p, r

    // Step 2: Find common skills/interests between the user and the post
    OPTIONAL MATCH (u)-[:HAS_SKILL|IS_INTERESTED_IN]->(csi:Interest)<-[:REQUIRED_SKILL]-(p)
    WITH u, p, r, collect(DISTINCT csi) AS commonSkillInterests

    // Step 3: Update scores for matched skills/interests if a comment is added or already exists
    UNWIND commonSkillInterests AS commonSkillInterest
    FOREACH (_ IN CASE WHEN r IS NOT NULL THEN [1] ELSE [] END |
      FOREACH (_ IN CASE WHEN EXISTS((u)-[:HAS_SKILL]->(commonSkillInterest)) THEN [1] ELSE [] END |
          MERGE (u)-[rel:HAS_SKILL]->(commonSkillInterest)
          ON MATCH SET rel.score = COALESCE(rel.score + 1, 1))
      FOREACH (_ IN CASE WHEN EXISTS((u)-[:IS_INTERESTED_IN]->(commonSkillInterest)) THEN [1] ELSE [] END |
          MERGE (u)-[rel:IS_INTERESTED_IN]->(commonSkillInterest)
          ON CREATE SET rel.score = 1
          ON MATCH SET rel.score = COALESCE(rel.score + 1, 1))
      )
      RETURN u, p
    `,
    {userId,quesid}
  );

  updateUserInterestsForComment(userId,quesid,req.user.id);
    // Send a success response
    res.status(201).json({
      success: true,
      message: "Comment posted successfully",
      comment: newComment,
    });
  } catch (error) {
    next(error);
  }finally{
    await session.close();
  }
});

exports.deleteComment = catchAsyncError(async (req, res, next) => {
  try {
    const { postId, commentId } = req.params;
    const userId = req.user.id.toString();
    const quesid = req.params.postId.toString();
    const driver = await connectGraphDB();
    const session = driver.session();

    // Find the question post by ID
    const question = await QuestionPost.findById(postId);
    if (!question) {
      return next(new ErrorHandler("Question post not found", 404));
    }

    // Find the index of the comment by ID
    const commentIndex = question.comments.findIndex(
      (comment) => comment._id.toString() === commentId
    );
    if (commentIndex === -1) {
      return next(new ErrorHandler("Comment not found", 404));
    }

    // Remove the comment from the question post's comments array
    question.comments.splice(commentIndex, 1);

    // Save the updated question post
    await question.save();

    //deleting comment realtion from question in neo4j db
    await session.run(`
    MATCH (u:Person {mongoId: $userId})-[r:COMMENTED_ON]->(p:Post {mongoId: $quesid})
    OPTIONAL MATCH (u)-[:HAS_SKILL|IS_INTERESTED_IN]->(csi:Interest)<-[:REQUIRED_SKILL]-(p)
    WITH u, p, r, r.count AS count, collect(DISTINCT csi) AS commonSkillInterests
    CALL apoc.do.case(
      [
        count = 1, '
          DELETE r
          WITH u, p, commonSkillInterests
          UNWIND commonSkillInterests AS commonSkillInterest
          FOREACH (_ IN CASE WHEN EXISTS((u)-[:HAS_SKILL]->(commonSkillInterest)) THEN [1] ELSE [] END |
            MERGE (u)-[rel:HAS_SKILL]->(commonSkillInterest)
            ON MATCH SET rel.score = CASE WHEN rel.score > 0 THEN rel.score - 1 ELSE 0 END)
          FOREACH (_ IN CASE WHEN EXISTS((u)-[:IS_INTERESTED_IN]->(commonSkillInterest)) THEN [1] ELSE [] END |
            MERGE (u)-[rel:IS_INTERESTED_IN]->(commonSkillInterest)
            ON MATCH SET rel.score = CASE WHEN rel.score > 0 THEN rel.score - 1 ELSE 0 END)
          RETURN u, p
        '
      ],
      '
        SET r.count = r.count - 1
        WITH u, p, commonSkillInterests
        UNWIND commonSkillInterests AS commonSkillInterest
        FOREACH (_ IN CASE WHEN EXISTS((u)-[:HAS_SKILL]->(commonSkillInterest)) THEN [1] ELSE [] END |
          MERGE (u)-[rel:HAS_SKILL]->(commonSkillInterest)
          ON MATCH SET rel.score = CASE WHEN rel.score > 0 THEN rel.score - 1 ELSE 0 END)
        FOREACH (_ IN CASE WHEN EXISTS((u)-[:IS_INTERESTED_IN]->(commonSkillInterest)) THEN [1] ELSE [] END |
          MERGE (u)-[rel:IS_INTERESTED_IN]->(commonSkillInterest)
          ON MATCH SET rel.score = CASE WHEN rel.score > 0 THEN rel.score - 1 ELSE 0 END)
        RETURN u, p
      ',
      {u: u, p: p, r: r, commonSkillInterests: commonSkillInterests}
    ) YIELD value
    RETURN value.u AS user, value.p AS post
    `,
    {userId,quesid}
  );
    // Send a success response
    res
      .status(200)
      .json({ success: true, message: "Comment deleted successfully" });
  } catch (error) {
    next(error);
  }finally{
    await session.close();
  }
});

exports.updateComment = catchAsyncError(async (req, res, next) => {
  try {
    const { postId, commentId } = req.params;
    const { text } = req.body;

    // Find the question post by ID
    const question = await QuestionPost.findById(postId);
    if (!question) {
      return next(new ErrorHandler("Question post not found", 404));
    }

    // Find the comment by ID
    const comment = question.comments.id(commentId);
    if (!comment) {
      return next(new ErrorHandler("Comment not found", 404));
    }

    // Update the text of the comment
    comment.text = text;

    // Save the updated question post
    await question.save();

    // Send a success response
    res.status(200).json({
      success: true,
      message: "Comment updated successfully",
      comment,
    });
  } catch (error) {
    next(error);
  }
});
//function for gwettig new interest and updating mongodb
async function updateUserInterestsForLike(userId,quesid,userid){
  const driver = await connectGraphDB();
  const session = driver.session();
  try{
    const newInterestResults = await session.run(`MATCH (u:Person{mongoId:$userId})-[:LIKES]->(p:Post{mongoId:$quesid})
    OPTIONAL MATCH (p)-[:REQUIRED_SKILL]->(pI:Interest)
    WHERE NOT EXISTS((u)-[:HAS_SKILL|IS_INTERESTED_IN]->(pI))
    MERGE (u)-[:IS_INTERESTED_IN]->(pI)
    RETURN  collect(DISTINCT pI) AS newInterests`,{userId,quesid});
    

    //geeting new skills from cypher query
    const newUserInterests = newInterestResults.records[0].get("newInterests").map(interest=>interest.properties.name);
    //console.log(newUserInterests);
     await User.findByIdAndUpdate(
       {_id : userid},
       {$addToSet:{userInterests:{$each:newUserInterests}}}
     )
    
  }catch(error){
    console.error(error);
  }finally{
    await session.close();
  }
}
exports.likePost = catchAsyncError(async (req, res, next) => {
    const { postId } = req.params;
    const userId = req.user.id.toString();
    const quesid = req.params.postId.toString();
  try {
    const driver = await connectGraphDB();
    const session = driver.session();
    

    // Find the question post by ID
    const question = await QuestionPost.findById(postId);
    if (!question) {
      return next(new ErrorHandler("Question post not found", 404));
    }

    //ceating like relationshp between user and quespost in neo4j db
    const likeResult = await session.run(`
      MATCH (u:Person {mongoId: $userId}), (p:Post {mongoId: $quesid})
      OPTIONAL MATCH (u)-[likeRel:LIKES]->(p)
      OPTIONAL MATCH (u)-[dislikeRel:DISLIKES]->(p)
      FOREACH (_ IN CASE WHEN likeRel IS NOT NULL THEN [1] ELSE [] END | DELETE likeRel)
      FOREACH (_ IN CASE WHEN dislikeRel IS NOT NULL THEN [1] ELSE [] END | DELETE dislikeRel)
      FOREACH (_ IN CASE WHEN likeRel IS NULL THEN [1] ELSE [] END | CREATE (u)-[:LIKES]->(p))

      WITH u, p, likeRel
      OPTIONAL MATCH (u)-[:HAS_SKILL|IS_INTERESTED_IN]->(csi:Interest)<-[:REQUIRED_SKILL]-(p)
      WITH u, p, collect(DISTINCT csi) AS commonSkillInterests, likeRel

      UNWIND commonSkillInterests AS commonSkillInterest
      FOREACH (_ IN CASE WHEN likeRel IS NOT NULL THEN [1] ELSE [] END |
        FOREACH (_ IN CASE WHEN EXISTS((u)-[:HAS_SKILL]->(commonSkillInterest)) THEN [1] ELSE [] END |
            MERGE (u)-[r:HAS_SKILL]->(commonSkillInterest)
            ON MATCH SET r.score = CASE WHEN r.score > 0 THEN r.score - 1 ELSE 0 END)
        FOREACH (_ IN CASE WHEN EXISTS((u)-[:IS_INTERESTED_IN]->(commonSkillInterest)) THEN [1] ELSE [] END |
            MERGE (u)-[r:IS_INTERESTED_IN]->(commonSkillInterest)
            ON MATCH SET r.score = CASE WHEN r.score > 0 THEN r.score - 1 ELSE 0 END)
      )

      FOREACH (_ IN CASE WHEN likeRel IS NULL THEN [1] ELSE [] END |
        FOREACH (_ IN CASE WHEN EXISTS((u)-[:HAS_SKILL]->(commonSkillInterest)) THEN [1] ELSE [] END |
            MERGE (u)-[r:HAS_SKILL]->(commonSkillInterest)
            ON CREATE SET r.score = 1
            ON MATCH SET r.score = r.score + 1)
        FOREACH (_ IN CASE WHEN EXISTS((u)-[:IS_INTERESTED_IN]->(commonSkillInterest)) THEN [1] ELSE [] END |
            MERGE (u)-[r:IS_INTERESTED_IN]->(commonSkillInterest)
            ON CREATE SET r.score = 1
            ON MATCH SET r.score = r.score + 1)
      )
      RETURN u, p
    `,
    {userId,quesid});
    

    

    // Remove user ID from likes if previously disliked
    const likeIndex = question.dislikes.indexOf(req.user.id);
    if (likeIndex !== -1) {
      question.dislikes.splice(likeIndex, 1);
    }
    // Check if user already liked the comment
    const checkLike = question.likes.indexOf(req.user.id);
    if (checkLike !== -1) {
      // If user already liked the comment, remove the like
      question.likes.splice(checkLike, 1);
      // Save the updated question post
      await question.save();
      return res
        .status(200)
        .json({ success: true, message: "Post like removed successfully" });
    }
    
    

    // Ensure likes is an array before using includes
    if (!Array.isArray(question.likes)) {
      question.likes = []; // Initialize as an empty array if not already
    }

    // Update the comment likes
    question.likes.push(req.user.id);

    // Save the updated question post
    await question.save();
    updateUserInterestsForLike(userId,quesid,req.user.id);
    // Send a success response
    res.status(200).json({ success: true, message: "Post Liked successfully" });
  } catch (error) {
    next(error);
  }finally{
    await session.close();
    
  }
  
});


exports.dislikePost = catchAsyncError(async (req, res, next) => {
  try {
    const { postId } = req.params;
    const quesid =  req.params.postId.toString();
    const userId = req.user.id.toString();
    const driver= await connectGraphDB();
    const session =driver.session();

    // Find the question post by ID
    const question = await QuestionPost.findById(postId);
    if (!question) {
      return next(new ErrorHandler("Question post not found", 404));
    }

    //disliking question pot in neo4j
    await session.run(`
    MATCH (u:Person {mongoId: $userId}), (p:Post {mongoId: $quesid})
      OPTIONAL MATCH (u)-[likeRel:LIKES]->(p)
      OPTIONAL MATCH (u)-[dislikeRel:DISLIKES]->(p)
      FOREACH (_ IN CASE WHEN likeRel IS NOT NULL THEN [1] ELSE [] END | DELETE likeRel)
      FOREACH (_ IN CASE WHEN dislikeRel IS NOT NULL THEN [1] ELSE [] END | DELETE dislikeRel)
      FOREACH (_ IN CASE WHEN dislikeRel IS NULL THEN [1] ELSE [] END | CREATE (u)-[:DISLIKES]->(p))
      RETURN u, p
    `,
    {userId,quesid}
  );


    // Remove user ID from dislikes if previously liked
    const dislikeIndex = question.likes.indexOf(req.user.id);
    if (dislikeIndex !== -1) {
      question.likes.splice(dislikeIndex, 1);
    }

    // Check if user already disliked the comment
    const checkDisike = question.dislikes.indexOf(req.user.id);
    if (checkDisike !== -1) {
      // If user already liked the comment, remove the like
      question.dislikes.splice(checkDisike, 1);
      // Save the updated question post
      await question.save();
      return res.status(200).json({
        success: true,
        message: "Post dislike removed successfully",
      });
    }

    // Ensure likes is an array before using includes
    if (!Array.isArray(question.dislikes)) {
      question.dislikes = []; // Initialize as an empty array if not already
    }

    // Update the comment likes
    question.dislikes.push(req.user.id);
    // Save the updated question post
    await question.save();

    // Send a success response
    res.status(200).json({ success: true, message: "Post disliked" });
  } catch (error) {
    next(error);
  }finally{
    await session.close();
  }
});

exports.likeComment = catchAsyncError(async (req, res, next) => {
  try {
    const { postId, commentId } = req.params;

    const question = await QuestionPost.findById(postId);
    if (!question) {
      return next(new ErrorHandler("Question post not found", 404));
    }

    const comment = question.comments.id(commentId);
    if (!comment) {
      return next(new ErrorHandler("Comment not found", 404));
    }

    // Remove dislike if it exists
    const likeIndex = comment.dislikes.indexOf(req.user.id);
    if (likeIndex !== -1) {
      comment.dislikes.splice(likeIndex, 1);
    }

    // Check if the user already liked the comment
    const checkLike = comment.likes.indexOf(req.user.id);
    if (checkLike !== -1) {
      comment.likes.splice(checkLike, 1);
      await question.save();
      return res
        .status(200)
        .json({ success: true, message: "Comment like removed successfully" });
    }

    // Ensure the likes array exists
    if (!Array.isArray(comment.likes)) {
      comment.likes = [];
    }

    // Add the like
    comment.likes.push(req.user.id);
    await question.save();

    res
      .status(200)
      .json({ success: true, message: "Comment liked successfully" });
  } catch (error) {
    next(error);
  }
});

// Dislike a comment (improved)
exports.dislikeComment = catchAsyncError(async (req, res, next) => {
  try {
    const { postId, commentId } = req.params;

    // Find the question post by ID
    const question = await QuestionPost.findById(postId);
    if (!question) {
      return next(new ErrorHandler("Question post not found", 404));
    }

    // Find the comment by ID
    const comment = question.comments.id(commentId);
    if (!comment) {
      return next(new ErrorHandler("Comment not found", 404));
    }

    // Remove user ID from dislikes if previously liked
    const dislikeIndex = comment.likes.indexOf(req.user.id);
    if (dislikeIndex !== -1) {
      comment.likes.splice(dislikeIndex, 1);
    }

    // Check if user already disliked the comment
    const checkDisike = comment.dislikes.indexOf(req.user.id);
    if (checkDisike !== -1) {
      // If user already liked the comment, remove the like
      comment.dislikes.splice(checkDisike, 1);
      // Save the updated question post
      await question.save();
      return res.status(200).json({
        success: true,
        message: "Comment dislike removed successfully",
      });
    }

    // Ensure likes is an array before using includes
    if (!Array.isArray(comment.dislikes)) {
      comment.dislikes = []; // Initialize as an empty array if not already
    }

    // Update the comment likes
    comment.dislikes.push(req.user.id);
    // Save the updated question post
    await question.save();

    // Send a success response
    res.status(200).json({ success: true, message: "Comment unliked" });
  } catch (error) {
    next(error);
  }
});

exports.replyComment = catchAsyncError(async (req, res, next) => {
  try {
    const { postId, commentId } = req.params;
    const { text } = req.body;
    const quesid = req.params.postId.toString();
    const userId = req.user.id.toString();
    const driver = await connectGraphDB();
    const session = driver.session();
    // Retrieve the ID of the currently logged-in user
    const user_id = req.user.id;
    // Find the question post by ID
    const question = await QuestionPost.findById(postId);
    if (!question) {
      return next(new ErrorHandler("Question post not found", 404));
    }
    //find comment by ID
    const commentfind = question.comments.id(commentId);
    if (!commentfind) {
      return next(new ErrorHandler("comment not found", 404));
    }

    // Create the new comment object
    const newReply = {
      text,
      user_id,
      timeStamp: new Date(), // Optionally, you can add a timestamp for the comment
    };

    // Push the new comment to the question post's comments array
    commentfind.replies.push(newReply);

    //creating reply in neo4j db
    await session.run(`
    MATCH (u:Person{mongoId:$userId}), (p:Post{mongoId:$quesid})
    MERGE (u)-[r:COMMENTED_ON]->(p)
    ON CREATE SET r.count = 1
    ON MATCH SET r.count = r.count+1
    WITH u, p, r

    // Step 2: Find common skills/interests between the user and the post
    OPTIONAL MATCH (u)-[:HAS_SKILL|IS_INTERESTED_IN]->(csi:Interest)<-[:REQUIRED_SKILL]-(p)
    WITH u, p, r, collect(DISTINCT csi) AS commonSkillInterests

    // Step 3: Update scores for matched skills/interests if a comment is added or already exists
    UNWIND commonSkillInterests AS commonSkillInterest
    FOREACH (_ IN CASE WHEN r IS NOT NULL THEN [1] ELSE [] END |
      FOREACH (_ IN CASE WHEN EXISTS((u)-[:HAS_SKILL]->(commonSkillInterest)) THEN [1] ELSE [] END |
          MERGE (u)-[rel:HAS_SKILL]->(commonSkillInterest)
          ON MATCH SET rel.score = COALESCE(rel.score + 1, 1))
      FOREACH (_ IN CASE WHEN EXISTS((u)-[:IS_INTERESTED_IN]->(commonSkillInterest)) THEN [1] ELSE [] END |
          MERGE (u)-[rel:IS_INTERESTED_IN]->(commonSkillInterest)
          ON CREATE SET rel.score = 1
          ON MATCH SET rel.score = COALESCE(rel.score + 1, 1))
    )
    RETURN u, p
    `,
    {userId,quesid}
  );

    // Save the updated question post
    await question.save();

    updateUserInterestsForComment(userId,quedid,req.user.id);

    // Send a success response
    res.status(201).json({
      success: true,
      message: "Reply posted successfully",
      reply: newReply,
    });
  } catch (error) {
    next(error);
  }finally{
    session.close();
  }
});

exports.deleteReply = catchAsyncError(async (req, res, next) => {
  try {
    const { postId, commentId, replyId } = req.params;
    const userId =req.user.id.toString();
    const quesid = req.params.postId.toString();
    const driver = await connectGraphDB();
    const session =driver.session();

    // Find the question post by ID
    const question = await QuestionPost.findById(postId);
    if (!question) {
      return next(new ErrorHandler("Question post not found", 404));
    }
    const commentfind = question.comments.id(commentId);
    if (!commentfind) {
      return next(new ErrorHandler("comment not found", 404));
    }
    const replyfind = commentfind.replies.id(replyId);
    if (!replyfind) {
      return next(new ErrorHandler("reply not found", 404));
    }

    // Find the index of the comment by ID
    const replyIndex = commentfind.replies.findIndex(
      (reply) => reply._id.toString() === replyId
    );
    if (replyIndex === -1) {
      return next(new ErrorHandler("reply not found", 404));
    }

    // Remove the comment from the question post's comments array
    commentfind.replies.splice(replyIndex, 1);
     
    //deleting relpy in neo4j db
    await session.run(
      `MATCH (u:Person {mongoId: $userId})-[r:COMMENTED_ON]->(p:Post {mongoId: $quesid})
      OPTIONAL MATCH (u)-[:HAS_SKILL|IS_INTERESTED_IN]->(csi:Interest)<-[:REQUIRED_SKILL]-(p)
      WITH u, p, r, r.count AS count, collect(DISTINCT csi) AS commonSkillInterests
      CALL apoc.do.case(
        [
          count = 1, '
            DELETE r
            WITH u, p, commonSkillInterests
            UNWIND commonSkillInterests AS commonSkillInterest
            FOREACH (_ IN CASE WHEN EXISTS((u)-[:HAS_SKILL]->(commonSkillInterest)) THEN [1] ELSE [] END |
              MERGE (u)-[rel:HAS_SKILL]->(commonSkillInterest)
              ON MATCH SET rel.score = CASE WHEN rel.score > 0 THEN rel.score - 1 ELSE 0 END)
            FOREACH (_ IN CASE WHEN EXISTS((u)-[:IS_INTERESTED_IN]->(commonSkillInterest)) THEN [1] ELSE [] END |
              MERGE (u)-[rel:IS_INTERESTED_IN]->(commonSkillInterest)
              ON MATCH SET rel.score = CASE WHEN rel.score > 0 THEN rel.score - 1 ELSE 0 END)
            RETURN u, p
          '
        ],
        '
          SET r.count = r.count - 1
          WITH u, p, commonSkillInterests
          UNWIND commonSkillInterests AS commonSkillInterest
          FOREACH (_ IN CASE WHEN EXISTS((u)-[:HAS_SKILL]->(commonSkillInterest)) THEN [1] ELSE [] END |
            MERGE (u)-[rel:HAS_SKILL]->(commonSkillInterest)
            ON MATCH SET rel.score = CASE WHEN rel.score > 0 THEN rel.score - 1 ELSE 0 END)
          FOREACH (_ IN CASE WHEN EXISTS((u)-[:IS_INTERESTED_IN]->(commonSkillInterest)) THEN [1] ELSE [] END |
            MERGE (u)-[rel:IS_INTERESTED_IN]->(commonSkillInterest)
            ON MATCH SET rel.score = CASE WHEN rel.score > 0 THEN rel.score - 1 ELSE 0 END)
          RETURN u, p
        ',
        {u: u, p: p, r: r, commonSkillInterests: commonSkillInterests}
      ) YIELD value
      RETURN value.u AS user, value.p AS post`,
      {userId,quesid}
    );

    // Save the updated question post
    await question.save();
   
    
    // Send a success response
    res
      .status(200)
      .json({ success: true, message: "Comment deleted successfully" });
  } catch (error) {
    next(error);
  }finally{
    await session.close();
  } 
});

exports.updateReply = catchAsyncError(async (req, res, next) => {
  try {
    const { postId, commentId, replyId } = req.params;
    const { text } = req.body;

    // Find the question post by ID
    const question = await QuestionPost.findById(postId);
    if (!question) {
      return next(new ErrorHandler("Question post not found", 404));
    }
    const commentfind = question.comments.id(commentId);
    if (!commentfind) {
      return next(new ErrorHandler("comment not found", 404));
    }
    const replyfind = commentfind.replies.id(replyId);
    if (!replyfind) {
      return next(new ErrorHandler("reply not found", 404));
    }

    // Update the text of the comment
    replyfind.text = text;

    // Save the updated question post
    await question.save();

    // Send a success response
    res.status(200).json({
      success: true,
      message: "reply updated successfully",
      replyfind,
    });
  } catch (error) {
    next(error);
  }
});

exports.getReplies = catchAsyncError(async (req, res, next) => {
  try {
    const { postId, commentId } = req.params;
    const question = await QuestionPost.findById(postId);
    if (!question) {
      return next(new ErrorHandler("Question post not found", 404));
    }
    const commentfind = question.comments.id(commentId);
    if (!commentfind) {
      return next(new ErrorHandler("comment not found", 404));
    }
    const reply = commentfind.replies;
    res.status(200).json({ success: true, reply });
  } catch (error) {
    next(error);
  }
});

exports.likeReply = catchAsyncError(async (req, res, next) => {
  try {
    const { postId, commentId, replyId } = req.params;

    // Find the question post by ID
    const question = await QuestionPost.findById(postId);
    if (!question) {
      return next(new ErrorHandler("Question post not found", 404));
    }
    const commentfind = question.comments.id(commentId);
    if (!commentfind) {
      return next(new ErrorHandler("comment not found", 404));
    }
    const replyfind = commentfind.replies.id(replyId);
    if (!replyfind) {
      return next(new ErrorHandler("reply not found", 404));
    }
    // Remove user ID from likes if previously disliked
    const dislikeIndex = replyfind.dislikes.indexOf(req.user.id);
    if (dislikeIndex !== -1) {
      replyfind.dislikes.splice(dislikeIndex, 1);
    }
    // Check if user already liked the comment
    const checkLike = replyfind.likes.indexOf(req.user.id);
    if (checkLike !== -1) {
      // If user already liked the comment, remove the like
      replyfind.likes.splice(checkLike, 1);
      // Save the updated question post
      await question.save();
      return res
        .status(200)
        .json({ success: true, message: "reply like removed successfully" });
    }

    // Ensure likes is an array before using includes
    if (!Array.isArray(replyfind.likes)) {
      replyfind.likes = []; // Initialize as an empty array if not already
    }

    // Update the comment likes
    replyfind.likes.push(req.user.id);

    // Save the updated question post
    await question.save();

    // Send a success response
    res
      .status(200)
      .json({ success: true, message: "reply liked successfully" });
  } catch (error) {
    next(error);
  }
});

exports.dislikeReply = catchAsyncError(async (req, res, next) => {
  try {
    const { postId, commentId, replyId } = req.params;

    // Find the question post by ID
    const question = await QuestionPost.findById(postId);
    if (!question) {
      return next(new ErrorHandler("Question post not found", 404));
    }
    const commentfind = question.comments.id(commentId);
    if (!commentfind) {
      return next(new ErrorHandler("comment not found", 404));
    }
    const replyfind = commentfind.replies.id(replyId);
    if (!replyfind) {
      return next(new ErrorHandler("reply not found", 404));
    }

    // Remove user ID from dislikes if previously liked
    const dislikeIndex = replyfind.likes.indexOf(req.user.id);
    if (dislikeIndex !== -1) {
      replyfind.likes.splice(dislikeIndex, 1);
    }

    // Check if user already disliked the comment
    const checkDisike = replyfind.dislikes.indexOf(req.user.id);
    if (checkDisike !== -1) {
      // If user already liked the comment, remove the like
      replyfind.dislikes.splice(checkDisike, 1);
      // Save the updated question post
      await question.save();
      return res.status(200).json({
        success: true,
        message: "reply dislike removed successfully",
      });
    }

    // Ensure likes is an array before using includes
    if (!Array.isArray(replyfind.dislikes)) {
      replyfind.dislikes = []; // Initialize as an empty array if not already
    }

    // Update the comment likes
    replyfind.dislikes.push(req.user.id);
    // Save the updated question post
    await question.save();

    // Send a success response
    res.status(200).json({ success: true, message: "reply unliked" });
  } catch (error) {
    next(error);
  }
});

exports.getTopContributors = catchAsyncError(async (req, res, next) => {
  try {
    const { field } = req.params; // Extract the field from URL parameters

    // Find all question posts related to the specified field
    const questions = await QuestionPost.find({ relatedSkills: field });

    if (!questions || questions.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No questions found for the specified field",
      });
    }

    const userLikesMap = {};

    // Iterate through all comments in the related question posts
    questions.forEach((question) => {
      question.comments.forEach((comment) => {
        const userId = comment.user_id.toString();
        if (!userLikesMap[userId]) {
          userLikesMap[userId] = 0;
        }
        userLikesMap[userId] += comment.likes.length;
      });
    });

    // Convert the map to an array and sort by the number of likes
    const sortedContributors = Object.entries(userLikesMap)
      .sort((a, b) => b[1] - a[1])
      .map((entry) => ({ user_id: entry[0], likes: entry[1] }));

    res.status(200).json({
      success: true,
      contributors: sortedContributors,
    });
  } catch (error) {
    next(error);
  }
});

exports.sharePost = catchAsyncError(async (req, res, next) => {
  try {
    const { postId, recipientId } = req.params; // Get the post ID and recipient ID from the URL
    const userId = req.user.id; // Get the ID of the user sharing the post
    const userid = userId.toString();
    const quesid = req.params.postId.toString();
    const driver = await connectGraphDB();
    const session = driver.session();
    // Find the question post
    const post = await QuestionPost.findById(postId);
    if (!post) {
      return next(new ErrorHandler("Question post not found", 404));
    }

    // Check if the recipient is a follower or following the user
    const user = await User.findById(userId);
    const recipient = await User.findById(recipientId);
    if (!user || !recipient) {
      return next(new ErrorHandler("User not found", 404));
    }

    const isFollower = user.followers.includes(recipientId);
    const isFollowing = user.following.includes(recipientId);

    if (!isFollower && !isFollowing) {
      return next(
        new ErrorHandler(
          "You can only share posts with your followers or followings",
          400
        )
      );
    }

    // Add the share information to the post
    post.shares.push({ user_id: recipientId });
    await post.save();
    //sharing relationship in question post in neo4j
    await session.run(
      `
      MATCH (u:Person{mongoId:$userid}),(p:Post{mongoId:$quesid})
      CREATE (u)-[:SHARED]->(p)
      `,
      {userid,quesid}
    );
    res.status(200).json({
      success: true,
      message: "Post shared successfully",
      post,
    });
  } catch (error) {
    next(error);
  }finally{
    await session.close();
  }
});
exports.getSharedPosts = catchAsyncError(async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Find posts that have been shared with this user
    const sharedPosts = await QuestionPost.find({ "shares.user_id": userId })
      .populate("user_id", "name")
      .populate("shares.user_id", "name");

    res.status(200).json({
      success: true,
      sharedPosts,
    });
  } catch (error) {
    next(error);
  }
});
