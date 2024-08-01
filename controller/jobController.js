const jobPost = require("../models/job");
const ErrorHandler = require("../utils/errorHandler");
const catchAsyncError = require("../middlewares/catchAsyncError");
const User = require("../models/user");
const {connectGraphDB} = require("../config/database");
const { session } = require("neo4j-driver");
const {exec} = require("child_process");
// create new job posts /api/v1/product/new

//creating constraint/index on job post
async function createConstraintOnPost(){
  const driver = await connectGraphDB();
  const session = driver.session();
  try{
    const result = await session.run(
      `
      CREATE CONSTRAINT IF NOT EXISTS FOR (n:Post) REQUIRE n.mongoId IS UNIQUE;
      `
    );
    console.log("successfully created consraint on person node");
  }catch(error){
    console.log("failed to create constraint on person node",error);
  }finally{
    await session.close();
  }
}

exports.newJobs = catchAsyncError(async (req, res) => {
  req.body.user_id = req.user.id;
  const userId = req.user.id.toString();
  const job = await jobPost.create(req.body);
  const jobId = job._id.toString();
  const driver = await connectGraphDB();
  const session = driver.session();
  const {position,requiredSkills} = req.body;
  try{
    const result = await session.run(
      `
      MATCH (u:Person) WHERE u.mongoId = $userId
      CREATE (p:Post{
          name:$position,
          mongoId:$jobId
      })
      WITH p,u
      UNWIND $requiredSkills as reqSkill
      MERGE(r:Interest {name:reqSkill})
      MERGE (p)-[:REQUIRED_SKILL]->(r)
      WITH p,u
      MERGE (u)-[:CREATED]->(p)
      RETURN p`,
      {userId,position,jobId,requiredSkills}
    );
    console.log('post created in Neo4j:', result.records[0].get('p').properties);  
  }catch(error){
    console.log("error creating user in neo4j db",error);
  }finally{
    await session.close();
  }
  createConstraintOnPost();
  res.status(201).json({
    success: true,
    job,
  });
});

exports.getJobs = catchAsyncError(async (req, res, next) => {
  const jobs = await jobPost.find();
  res.status(200).json({
    success: true,
    count: jobs.length,
    jobs,
  });
});

//get single product by the id => api/v1/job/:id

exports.getSingleJob = catchAsyncError(async (req, res, next) => {
  const job = await jobPost.findById(req.params.id);
  if (!job) {
    return next(new ErrorHandler("job post not found", 404));
  }

  res.status(200).json({
    success: true,
    job,
  });
});

//update the job => api/v1/admin/job/:id

exports.updateJob = catchAsyncError(async (req, res, next) => {
  let updateJob = await jobPost.findById(req.params.id);
  if (!updateJob) {
    return next(new ErrorHandler("job post not found", 404));
  }
  updateJob = await jobPost.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
    useFindAndModify: false,
  });
  res.status(200).json({
    success: true,
    updateJob,
  });
});

//delete the job => api/v1/admin/job/:id

exports.deleteJob = catchAsyncError(async (req, res, next) => {
  let deleteJob = await jobPost.findById(req.params.id);
  const driver =await connectGraphDB();
  const session = driver.session();
  const deleteJobId = req.params.id.toString();
  if (!deleteJob) {
    return next(new ErrorHandler("job post not found", 404));
  }

  deleteJob = await jobPost.deleteOne({ _id: req.params.id });
  try{
    await session.run(
    `MATCH (n:Post {mongoId:$deleteJobId}) DETACH DELETE n;`,
    {deleteJobId}
    );
    console.log("post deleted successfully in neo4jdb");
  }catch(error){
    console.log("error in deleting post",error);
  }finally{
    await session.close();
  }
  res.status(200).json({
    success: true,
    message: "job post has been deleted",
  });
});

exports.getPostComments = catchAsyncError(async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const job = await jobPost.findById(jobId);
    if (!job) {
      return next(new ErrorHandler("job not found", 404));
    }
    const comments = job.comments;
    res.status(200).json({ success: true, comments });
  } catch (error) {
    next(error);
  }
});

//job comment
exports.jobComment = catchAsyncError(async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { text } = req.body;
    const driver = await connectGraphDB();
    const session = driver.session();
    // Retrieve the ID of the currently logged-in user
    const user_id = req.user.id;
    const userId = req.user.id.toString();
    const jobid = req.params.jobId.toString();
    // Find the job job by ID
    const job = await jobPost.findById(jobId);
    if (!job) {
      return next(new ErrorHandler("job not found", 404));
    }

    // Create the new comment object
    const newComment = {
      text,
      user_id,
      timeStamp: new Date(), // Optionally, you can add a timestamp for the comment
    };

    // Push the new comment to the job job's comments array
    job.comments.push(newComment);

    // Save the updated job job
    await job.save();

    //recording comment in neo4j db
    
      const result = await session.run(
        ` MATCH (u:Person{mongoId:$userId}), (p:Post{mongoId:$jobid})
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
        {jobid,userId}
      );
      console.log("successful creation of comment realtion between user and post in neo4j db");
    



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
    const { jobId, commentId } = req.params;
    const userId = req.user.id.toString();
    
    const driver = await connectGraphDB();
    const session = driver.session();
    const jobid = req.params.jobId.toString();
    // Find the job job by ID
    const job = await jobPost.findById(jobId);
    if (!job) {
      return next(new ErrorHandler("job not found", 404));
    }

    // Find the index of the comment by ID
    const commentIndex = job.comments.findIndex(
      (comment) => comment._id.toString() === commentId
    );
    if (commentIndex === -1) {
      return next(new ErrorHandler("Comment not found", 404));
    }

    // Remove the comment from the job job's comments array
    job.comments.splice(commentIndex, 1);

    //deleting in neo4j database
    
      const result = await session.run(
      `MATCH (u:Person {mongoId: $userId})-[r:COMMENTED_ON]->(p:Post {mongoId: $jobid})
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
          RETURN u, p`,
      {userId,jobid}
    );
    console.log("successfully deleted comment realtion in neo4j data base");
    
     
    
    // Save the updated job job
    await job.save();
    
    

    // Send a success response
    res
      .status(200)
      .json({ success: true, message: "Comment deleted successfully" });
  } catch (error) {
    next(error);
    console.log("error in deleting");
  }finally{
    await session.close();
  }
});
//from here

exports.updateComment = catchAsyncError(async (req, res, next) => {
  try {
    const { jobId, commentId } = req.params;
    const { text } = req.body;

    // Find the job  by ID
    const job = await jobPost.findById(jobId);
    if (!job) {
      return next(new ErrorHandler("job not found", 404));
    }

    // Find the comment by ID
    const comment = job.comments.id(commentId);
    if (!comment) {
      return next(new ErrorHandler("Comment not found", 404));
    }

    // Update the text of the comment
    comment.text = text;

    // Save the updated job job
    await job.save();

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

exports.likejob = catchAsyncError(async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const userId =  req.user.id.toString();
    const jobid = req.params.jobId.toString();
    const driver = await connectGraphDB();
    const session = driver.session();

    // Find the job job by ID
    const job = await jobPost.findById(jobId);
    if (!job) {
      return next(new ErrorHandler("job post not found", 404));
    }
    
     //like relationship in neo4j db 
     await session.run(
      `MATCH (u:Person {mongoId: $userId}), (p:Post {mongoId: $jobid})
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
      `,
      {userId,jobid}
    );


    // Remove user ID from likes if previously disliked
    const likeIndex = job.dislikes.indexOf(req.user.id);
    if (likeIndex !== -1) {
      job.dislikes.splice(likeIndex, 1);
    }
    // Check if user already liked the comment
    const checkLike = job.likes.indexOf(req.user.id);
    if (checkLike !== -1) {
      // If user already liked the comment, remove the like
      job.likes.splice(checkLike, 1);
      // Save the updated job job
      await job.save();
       return res
         .status(200)
        .json({ success: true, message: "job like removed successfully" });
    }

    // Ensure likes is an array before using includes
    if (!Array.isArray(job.likes)) {
      job.likes = []; // Initialize as an empty array if not already
    }

    // Update the comment likes
    job.likes.push(req.user.id);

    // Save the updated job job
    await job.save();
   
    // Send a success response
    return res.status(200).json({ success: true, message: "job Liked successfully" });
  } catch (error) {
   return next(error);
  }finally{
    await session.close();
  }
});

exports.dislikejob = catchAsyncError(async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const jobid = req.params.jobId.toString();
    const userId = req.user.id.toString();
    const driver = await connectGraphDB();
    const session = driver.session();

    const result = await session.run(
      
      `MATCH (u:Person {mongoId: $userId}), (p:Post {mongoId: $jobid})
      OPTIONAL MATCH (u)-[likeRel:LIKES]->(p)
      OPTIONAL MATCH (u)-[dislikeRel:DISLIKES]->(p)
      FOREACH (_ IN CASE WHEN likeRel IS NOT NULL THEN [1] ELSE [] END | DELETE likeRel)
      FOREACH (_ IN CASE WHEN dislikeRel IS NOT NULL THEN [1] ELSE [] END | DELETE dislikeRel)
      FOREACH (_ IN CASE WHEN dislikeRel IS NULL THEN [1] ELSE [] END | CREATE (u)-[:DISLIKES]->(p))
      RETURN u, p
      `,{userId,jobid}
    );

    // Find the job job by ID
    const job = await jobPost.findById(jobId);
    if (!job) {
      return next(new ErrorHandler("job post not found", 404));
    }

    // Remove user ID from dislikes if previously liked
    const dislikeIndex = job.likes.indexOf(req.user.id);
    if (dislikeIndex !== -1) {
      job.likes.splice(dislikeIndex, 1);
    }

    // Check if user already disliked the comment
    const checkDisike = job.dislikes.indexOf(req.user.id);
    if (checkDisike !== -1) {
      // If user already liked the comment, remove the like
      job.dislikes.splice(checkDisike, 1);
      // Save the updated job job
      await job.save();
      return res.status(200).json({
        success: true,
        message: "job dislike removed successfully",
      });
    }

    // Ensure likes is an array before using includes
    if (!Array.isArray(job.dislikes)) {
      job.dislikes = []; // Initialize as an empty array if not already
    }

    // Update the comment likes
    job.dislikes.push(req.user.id);
    // Save the updated job job
    await job.save();

    // Send a success response
    res.status(200).json({ success: true, message: "job disliked" });
  } catch (error) {
     return next(error);
  }finally{
    await session.close();
  }
});

exports.likeComment = catchAsyncError(async (req, res, next) => {
  try {
    const { jobId, commentId } = req.params;

    // Find the job job by ID
    const job = await jobPost.findById(jobId);
    if (!job) {
      return next(new ErrorHandler("job post not found", 404));
    }

    // Find the comment by ID
    const comment = job.comments.id(commentId);
    if (!comment) {
      return next(new ErrorHandler("Comment not found", 404));
    }
    // Remove user ID from likes if previously disliked
    const likeIndex = comment.dislikes.indexOf(req.user.id);
    if (likeIndex !== -1) {
      comment.dislikes.splice(likeIndex, 1);
    }
    // Check if user already liked the comment
    const checkLike = comment.likes.indexOf(req.user.id);
    if (checkLike !== -1) {
      // If user already liked the comment, remove the like
      comment.likes.splice(checkLike, 1);
      // Save the updated job job
      await job.save();
      return res
        .status(200)
        .json({ success: true, message: "Comment like removed successfully" });
    }

    // Ensure likes is an array before using includes
    if (!Array.isArray(comment.likes)) {
      comment.likes = []; // Initialize as an empty array if not already
    }

    // Update the comment likes
    comment.likes.push(req.user.id);

    // Save the updated job job
    await job.save();

    // Send a success response
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
    const { jobId, commentId } = req.params;

    // Find the job job by ID
    const job = await jobPost.findById(jobId);
    if (!job) {
      return next(new ErrorHandler("job post not found", 404));
    }

    // Find the comment by ID
    const comment = job.comments.id(commentId);
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
      // Save the updated job job
      await job.save();
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
    // Save the updated job job
    await job.save();

    // Send a success response
    res.status(200).json({ success: true, message: "Comment unliked" });
  } catch (error) {
    next(error);
  }
});

exports.replyComment = catchAsyncError(async (req, res, next) => {
  try {
    const { jobId, commentId } = req.params;
    const { text } = req.body;
    const jobid = req.params.jobId.toString();
    const userId = req.user.id.toString();
    const driver = await connectGraphDB();
    const session = driver.session();
    // Retrieve the ID of the currently logged-in user
    const user_id = req.user.id;
    // Find the job job by ID
    const job = await jobPost.findById(jobId);
    if (!job) {
      return next(new ErrorHandler("job post not found", 404));
    }
    //find comment by ID
    const commentfind = job.comments.id(commentId);
    if (!commentfind) {
      return next(new ErrorHandler("comment not found", 404));
    }

    // Create the new comment object
    const newReply = {
      text,
      user_id,
      timeStamp: new Date(), // Optionally, you can add a timestamp for the comment
    };

    // Push the new comment to the job job's comments array
    commentfind.replies.push(newReply);

    // Save the updated job job
    await job.save();
    //reply on comment is taken as user commented on the post in neo4j db
    const result = await session.run(`
    MATCH (u:Person{mongoId:$userId}), (p:Post{mongoId:$jobid})
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
    RETURN u, p`,
    {userId,jobid});
    // Send a success response
    res.status(201).json({
      success: true,
      message: "Reply posted successfully",
      reply: newReply,
    });
  } catch (error) {
    return next(error);
  }finally{
    await session.close();
  }
});

exports.deleteReply = catchAsyncError(async (req, res, next) => {
  try {
    const { jobId, commentId, replyId } = req.params;
    const jobid = req.params.jobId.toString();
    const userId = req.user.id.toString();
    const driver = await connectGraphDB();
    const session = driver.session();

    // Find the job job by ID
    const job = await jobPost.findById(jobId);
    if (!job) {
      return next(new ErrorHandler("job post not found", 404));
    }
    const commentfind = job.comments.id(commentId);
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

    // Remove the comment from the job job's comments array
    commentfind.replies.splice(replyIndex, 1);

    // Save the updated job job
    await job.save();
    //deleting reply on comment from  neo4j db
    
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
    const { jobId, commentId, replyId } = req.params;
    const { text } = req.body;

    // Find the job job by ID
    const job = await jobPost.findById(jobId);
    if (!job) {
      return next(new ErrorHandler("job post not found", 404));
    }
    const commentfind = job.comments.id(commentId);
    if (!commentfind) {
      return next(new ErrorHandler("comment not found", 404));
    }
    const replyfind = commentfind.replies.id(replyId);
    if (!replyfind) {
      return next(new ErrorHandler("reply not found", 404));
    }

    // Update the text of the comment
    replyfind.text = text;

    // Save the updated job job
    await job.save();

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
    const { jobId, commentId } = req.params;
    const job = await jobPost.findById(jobId);
    if (!job) {
      return next(new ErrorHandler("job post not found", 404));
    }
    const commentfind = job.comments.id(commentId);
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
    const { jobId, commentId, replyId } = req.params;

    // Find the job job by ID
    const job = await jobPost.findById(jobId);
    if (!job) {
      return next(new ErrorHandler("job post not found", 404));
    }
    const commentfind = job.comments.id(commentId);
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
      // Save the updated job job
      await job.save();
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

    // Save the updated job job
    await job.save();

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
    const { jobId, commentId, replyId } = req.params;

    // Find the job job by ID
    const job = await jobPost.findById(jobId);
    if (!job) {
      return next(new ErrorHandler("job post not found", 404));
    }
    const commentfind = job.comments.id(commentId);
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
      // Save the updated job job
      await job.save();
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
    // Save the updated job job
    await job.save();

    // Send a success response
    res.status(200).json({ success: true, message: "reply unliked" });
  } catch (error) {
    next(error);
  }
});

exports.getUserLikesAndComments = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Find job posts where the user has liked
    const likedJobPosts = await jobPost.find({ likes: userId });

    // Find job posts where the user has commented
    const commentedJobPosts = await jobPost.find({
      $or: [
        { "comments.user_id": userId }, // Check if user ID exists in comments array
        { "comments.replies.user_id": userId }, // Check if user ID exists in replies array
      ],
    });

    // Merge liked and commented job posts
    const userInteractions = likedJobPosts.concat(commentedJobPosts);

    res.status(200).json({
      success: true,
      userInteractions,
    });
  } catch (error) {
    next(error);
  }
};

exports.sharePost = catchAsyncError(async (req, res, next) => {
  try {
    const { postId, recipientId } = req.params; // Get the post ID and recipient ID from the URL
    const userId = req.user.id; // Get the ID of the user sharing the post
    const userid = req.user.id.toString();
    const postid = req.params.postId.toString();
    const driver = await connectGraphDB();
    const session = driver.session();

    // Find the question post
    const post = await jobPost.findById(postId);
    if (!post) {
      return next(new ErrorHandler("Job post not found", 404));
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
          "You can only share posts of your followers or followings",
          400
        )
      );
    }

    // Add the share information to the post
    post.shares.push({ user_id: recipientId });
    await post.save();
    //sharing post in neo4j db
    await session.run(
      `
      MATCH (u:Person{mongoId:$userid}),(p:Post{mongoId:$postid})
      CREATE (u)-[:SHARED]->(p)
      `,
      {userid,postid}
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
    const sharedPosts = await jobPost
      .find({ "shares.user_id": userId })
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
