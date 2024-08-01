const userPost = require("../models/post");
const ErrorHandler = require("../utils/errorHandler");
const catchAsyncError = require("../middlewares/catchAsyncError");
const User = require("../models/user");
const {connectGraphDB} = require("../config/database");
const {session} = require("neo4j-driver");

// POST endpoint for creating a new post post
exports.createPost = catchAsyncError(async (req, res) => {
  req.body.user_id = req.user.id;
  const post = await userPost.create(req.body);
  const userId = req.user.id.toString();
  const userPostId = post._id.toString();
  const driver  = await connectGraphDB();
  const session = driver.session();
  const {description,title} = req.body;
  try{
    await session.run(
      `
      MATCH (u:Person{mongoId:$userId})
      CREATE (p:Post{
        mongoId:$userPostId,
        name:$title
      })
      WITH u,p
      MERGE (u)-[:CREATED]->(p)
      `,{userPostId,userId,title}
    );
    console.log("post created successfully in neo4j db");
  }catch(error){
    console.log(error);
  }finally{
    session.close();
  }
  res.status(201).json({
    success: true,
    post,
  });
});

exports.getPost = catchAsyncError(async (req, res) => {
  const posts = await userPost.find();
  if (posts) {
    res.status(200).json({
      success: true,
      message: "Posts retrieved successfully",
      count: posts.length,
      posts,
    });
  } else {
    res.status(404).json({
      success: false,
      message: "No posts found",
    });
  }
});

exports.updatePost = catchAsyncError(async (req, res, next) => {
  let post = await userPost.findById(req.params.id);
  if (!post) {
    return next(new ErrorHandler("Post not found", 404));
  }
  post = await userPost.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
    useFindAndModify: false,
  });
  res.status(200).json({
    success: true,
    post,
  });
});

exports.deletePost = catchAsyncError(async (req, res) => {
  const post = await userPost.findById(req.params.id);
  const userPostId = req.params.id.toString();
  const driver = await connectGraphDB();
  const session = driver.session();
  if (!post) {
    return res.status(404).json({
      success: false,
      message: "Post not found",
    });
  }
  try{
    await session.run(
      `
      MATCH (p:Post{mongoId:$userPostId})
      DETACH DELETE p;
      `,{userPostId}
      
    );
    console.log("post deleted successfully from neo4j db");
  }catch(error){
    console.log(error);
  }finally{
    await session.close();
  }
  await post.deleteOne();
  res.status(200).json({
    success: true,
    message: "Post deleted",
  });
});

//get comment section
exports.getPostComments = catchAsyncError(async (req, res, next) => {
  const { postId } = req.params;
  const post = await userPost.findById(postId);
  if (!post) {
    return next(new ErrorHandler("Post not found", 404));
  }
  const comments = post.comments;
  res.status(200).json({ success: true, comments });
});

exports.postComment = catchAsyncError(async (req, res, next) => {
  const { postId } = req.params;
  const { text } = req.body;
  const user_id = req.user.id;
  const userPostId = postId.toString();
  const userid = req.user.id;
  const driver = await connectGraphDB();
  const session = driver.session();

  const post = await userPost.findById(postId);
  if (!post) {
    return next(new ErrorHandler("Post not found", 404));
  }

  const newComment = { text, user_id, timeStamp: new Date() };
  post.comments.push(newComment);
  await post.save();
  try {
    await session.run(
      `
      MATCH (u:Person{mongoId:$userid}), (p:Post{mongoId:$userPostId})
      MERGE (u)-[r:COMMENTED_ON]->(p)
      ON CREATE SET r.count = 1
      ON MATCH SET r.count = r.count+1
      WITH u, p, r
  
      // Step 2: Find common skills/interests between the user and the post
      OPTIONAL MATCH (u)-[:HAS_SKILL|IS_INTERESTED_IN]->(csi:Interest)<-[:RELATED_SKILL]-(p)
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
      `,{userPostId,userid}
    );
  } catch (error) {
    console.log(error);
  }finally{
    await session.close();
  }
  res.status(201).json({
    success: true,
    message: "Comment posted successfully",
    comment: newComment,
  });
});

exports.deleteComment = catchAsyncError(async (req, res, next) => {
  const { postId, commentId } = req.params;
  const post = await userPost.findById(postId);
  const userPostId = postId.toString();
  const userid = req.user.id.toString();
  const driver = await connectGraphDB();
  const session = driver.session();
  if (!post) {
    return next(new ErrorHandler("Post not found", 404));
  }

  const commentIndex = post.comments.findIndex(
    (comment) => comment._id.toString() === commentId
  );
  if (commentIndex === -1) {
    return next(new ErrorHandler("Comment not found", 404));
  }

  post.comments.splice(commentIndex, 1);
  try{
    await session.run(
      `
      MATCH (u:Person {mongoId: $userid})-[r:COMMENTED_ON]->(p:Post {mongoId: $userPostId})
      OPTIONAL MATCH (u)-[:HAS_SKILL|IS_INTERESTED_IN]->(csi:Interest)<-[:RELATED_SKILL]-(p)
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
      `,{userid,userPostId}
    );
  }catch(error){
    console.log(error.message);
  }finally{
    await session.close();
  }
  await post.save();

  res
    .status(200)
    .json({ success: true, message: "Comment deleted successfully" });
});

exports.updateComment = catchAsyncError(async (req, res, next) => {
  const { postId, commentId } = req.params;
  const { text } = req.body;

  const post = await userPost.findById(postId);
  if (!post) {
    return next(new ErrorHandler("Post not found", 404));
  }

  const comment = post.comments.id(commentId);
  if (!comment) {
    return next(new ErrorHandler("Comment not found", 404));
  }

  comment.text = text;
  await post.save();

  res.status(200).json({
    success: true,
    message: "Comment updated successfully",
    comment,
  });
});

exports.likePost = catchAsyncError(async (req, res, next) => {
  const { postId } = req.params;
  const userPostId = postId.toString();
  const userid = req.user.id.toString();
  const driver = await connectGraphDB();
  const session = driver.session();

  const post = await userPost.findById(postId);
  if (!post) {
    return next(new ErrorHandler("Post not found", 404));
  }
  try {
    await session.run(
      `
      MATCH (u:Person {mongoId: $userid}), (p:Post {mongoId: $userPostId})
      OPTIONAL MATCH (u)-[likeRel:LIKES]->(p)
      OPTIONAL MATCH (u)-[dislikeRel:DISLIKES]->(p)
      FOREACH (_ IN CASE WHEN likeRel IS NOT NULL THEN [1] ELSE [] END | DELETE likeRel)
      FOREACH (_ IN CASE WHEN dislikeRel IS NOT NULL THEN [1] ELSE [] END | DELETE dislikeRel)
      FOREACH (_ IN CASE WHEN likeRel IS NULL THEN [1] ELSE [] END | CREATE (u)-[:LIKES]->(p))

      // Step 2: Adjust scores based on the like/dislike changes
      WITH u, p, likeRel
      OPTIONAL MATCH (u)-[:HAS_SKILL|IS_INTERESTED_IN]->(csi:Interest)<-[:RELATED_SKILL]-(p)
      WITH u, p, collect(DISTINCT csi) AS commonSkillInterests, likeRel

      // Step 3: Update scores for matched skills and interests if the like was removed
      UNWIND commonSkillInterests AS commonSkillInterest
      FOREACH (_ IN CASE WHEN likeRel IS NOT NULL THEN [1] ELSE [] END |
        FOREACH (_ IN CASE WHEN EXISTS((u)-[:HAS_SKILL]->(commonSkillInterest)) THEN [1] ELSE [] END |
            MERGE (u)-[r:HAS_SKILL]->(commonSkillInterest)
            ON MATCH SET r.score = CASE WHEN r.score > 0 THEN r.score - 1 ELSE 0 END)
        FOREACH (_ IN CASE WHEN EXISTS((u)-[:IS_INTERESTED_IN]->(commonSkillInterest)) THEN [1] ELSE [] END |
            MERGE (u)-[r:IS_INTERESTED_IN]->(commonSkillInterest)
            ON MATCH SET r.score = CASE WHEN r.score > 0 THEN r.score - 1 ELSE 0 END)
      )

      // Step 4: Update scores for matched skills and interests if the like was added
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
      `,{userid,userPostId}
    );
  } catch (error) {
    console.log(error);
  }finally{
    await session.close();
  }
  const dislikeIndex = post.dislikes.indexOf(req.user.id);
  if (dislikeIndex !== -1) {
    post.dislikes.splice(dislikeIndex, 1);
  }

  const likeIndex = post.likes.indexOf(req.user.id);
  if (likeIndex !== -1) {
    post.likes.splice(likeIndex, 1);
    await post.save();
    return res
      .status(200)
      .json({ success: true, message: "Post like removed successfully" });
  }

  post.likes.push(req.user.id);
  await post.save();
  
  res.status(200).json({ success: true, message: "Post liked successfully" });
});

exports.dislikePost = catchAsyncError(async (req, res, next) => {
  const { postId } = req.params;
  const driver =  await connectGraphDB();
  const session  = driver.session();
  const userid = req.user.id.toString();
  const userPostId = postId.toString();

  const post = await userPost.findById(postId);
  if (!post) {
    return next(new ErrorHandler("Post not found", 404));
  }
  try {
    await session.run(`
    MATCH (u:Person {mongoId: $userid}), (p:Post {mongoId: $userPostId})
      OPTIONAL MATCH (u)-[likeRel:LIKES]->(p)
      OPTIONAL MATCH (u)-[dislikeRel:DISLIKES]->(p)
      FOREACH (_ IN CASE WHEN likeRel IS NOT NULL THEN [1] ELSE [] END | DELETE likeRel)
      FOREACH (_ IN CASE WHEN dislikeRel IS NOT NULL THEN [1] ELSE [] END | DELETE dislikeRel)
      FOREACH (_ IN CASE WHEN dislikeRel IS NULL THEN [1] ELSE [] END | CREATE (u)-[:DISLIKES]->(p))
      RETURN u, p
    `,{userid,userPostId}
    );
  } catch (error) {
    console.log(error);
  }finally{
    await session.close();
  }
  const likeIndex = post.likes.indexOf(req.user.id);
  if (likeIndex !== -1) {
    post.likes.splice(likeIndex, 1);
  }

  const dislikeIndex = post.dislikes.indexOf(req.user.id);
  if (dislikeIndex !== -1) {
    post.dislikes.splice(dislikeIndex, 1);
    await post.save();
    return res
      .status(200)
      .json({ success: true, message: "Post dislike removed successfully" });
  }

  post.dislikes.push(req.user.id);
  await post.save();

  res
    .status(200)
    .json({ success: true, message: "Post disliked successfully" });
});

exports.likeComment = catchAsyncError(async (req, res, next) => {
  const { postId, commentId } = req.params;

  const post = await userPost.findById(postId);
  if (!post) {
    return next(new ErrorHandler("Post not found", 404));
  }

  const comment = post.comments.id(commentId);
  if (!comment) {
    return next(new ErrorHandler("Comment not found", 404));
  }

  const dislikeIndex = comment.dislikes.indexOf(req.user.id);
  if (dislikeIndex !== -1) {
    comment.dislikes.splice(dislikeIndex, 1);
  }

  const likeIndex = comment.likes.indexOf(req.user.id);
  if (likeIndex !== -1) {
    comment.likes.splice(likeIndex, 1);
    await post.save();
    return res
      .status(200)
      .json({ success: true, message: "Comment like removed successfully" });
  }

  comment.likes.push(req.user.id);
  await post.save();

  res
    .status(200)
    .json({ success: true, message: "Comment liked successfully" });
});

exports.dislikeComment = catchAsyncError(async (req, res, next) => {
  const { postId, commentId } = req.params;

  const post = await userPost.findById(postId);
  if (!post) {
    return next(new ErrorHandler("Post not found", 404));
  }

  const comment = post.comments.id(commentId);
  if (!comment) {
    return next(new ErrorHandler("Comment not found", 404));
  }

  const likeIndex = comment.likes.indexOf(req.user.id);
  if (likeIndex !== -1) {
    comment.likes.splice(likeIndex, 1);
  }

  const dislikeIndex = comment.dislikes.indexOf(req.user.id);
  if (dislikeIndex !== -1) {
    comment.dislikes.splice(dislikeIndex, 1);
    await post.save();
    return res
      .status(200)
      .json({ success: true, message: "Comment dislike removed successfully" });
  }

  comment.dislikes.push(req.user.id);
  await post.save();

  res
    .status(200)
    .json({ success: true, message: "Comment disliked successfully" });
});

exports.replyComment = catchAsyncError(async (req, res, next) => {
  try {
    const { postId, commentId } = req.params;
    const { text } = req.body;
    const driver = await connectGraphDB();
    const session = driver.session();
    const userid = req.user.id.toString();
    const userPostId = postId.toString();

    // Retrieve the ID of the currently logged-in user
    const user_id = req.user.id;
    // Find the post post by ID
    const post = await userPost.findById(postId);
    if (!post) {
      return next(new ErrorHandler("post post not found", 404));
    }
    //find comment by ID
    const commentfind = post.comments.id(commentId);
    if (!commentfind) {
      return next(new ErrorHandler("comment not found", 404));
    }

    // Create the new comment object
    const newReply = {
      text,
      user_id,
      timeStamp: new Date(), // Optionally, you can add a timestamp for the comment
    };

    // Push the new comment to the post post's comments array
    commentfind.replies.push(newReply);

    //creating reply n neo4j db
    await session.run(`
    MATCH (u:Person{mongoId:$userid}), (p:Post{mongoId:$userPostId})
    MERGE (u)-[r:COMMENTED_ON]->(p)
    ON CREATE SET r.count = 1
    ON MATCH SET r.count = r.count+1
    WITH u, p, r

    // Step 2: Find common skills/interests between the user and the post
    OPTIONAL MATCH (u)-[:HAS_SKILL|IS_INTERESTED_IN]->(csi:Interest)<-[:RELATED_SKILL]-(p)
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
    {userid,userPostId}
  );
    // Save the updated post post
    await post.save();

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
    const userid = req.user.id.toString();
    const userPostId = postId.toString();
    const driver = await connectGraphDB();
    const session = driver.session();

    // Find the post post by ID
    const post = await userPost.findById(postId);
    if (!post) {
      return next(new ErrorHandler("post post not found", 404));
    }
    const commentfind = post.comments.id(commentId);
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

    // Remove the comment from the post post's comments array
    commentfind.replies.splice(replyIndex, 1);

    //in neo4j db
    await session.run(
      `MATCH (u:Person {mongoId: $userid})-[r:COMMENTED_ON]->(p:Post {mongoId: $userPostId})
      OPTIONAL MATCH (u)-[:HAS_SKILL|IS_INTERESTED_IN]->(csi:Interest)<-[:RELATED_SKILL]-(p)
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
      {userid,userPostId}
    );

    // Save the updated post post
    await post.save();



    // Send a success response
    res
      .status(200)
      .json({ success: true, message: "Comment deleted successfully" });
  } catch (error) {
    next(error);
  }
});

exports.updateReply = catchAsyncError(async (req, res, next) => {
  try {
    const { postId, commentId, replyId } = req.params;
    const { text } = req.body;

    // Find the post post by ID
    const post = await userPost.findById(postId);
    if (!post) {
      return next(new ErrorHandler("post post not found", 404));
    }
    const commentfind = post.comments.id(commentId);
    if (!commentfind) {
      return next(new ErrorHandler("comment not found", 404));
    }
    const replyfind = commentfind.replies.id(replyId);
    if (!replyfind) {
      return next(new ErrorHandler("reply not found", 404));
    }

    // Update the text of the comment
    replyfind.text = text;

    // Save the updated post post
    await post.save();

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
    const post = await userPost.findById(postId);
    if (!post) {
      return next(new ErrorHandler("post post not found", 404));
    }
    const commentfind = post.comments.id(commentId);
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

    // Find the post post by ID
    const post = await userPost.findById(postId);
    if (!post) {
      return next(new ErrorHandler("post post not found", 404));
    }
    const commentfind = post.comments.id(commentId);
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
      // Save the updated post post
      await post.save();
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

    // Save the updated post post
    await post.save();

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

    // Find the post post by ID
    const post = await userPost.findById(postId);
    if (!post) {
      return next(new ErrorHandler("post post not found", 404));
    }
    const commentfind = post.comments.id(commentId);
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
      // Save the updated post post
      await post.save();
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
    // Save the updated post post
    await post.save();

    // Send a success response
    res.status(200).json({ success: true, message: "reply unliked" });
  } catch (error) {
    next(error);
  }
});

exports.sharePost = catchAsyncError(async (req, res, next) => {
  try {
    const { postId, recipientId } = req.params; // Get the post ID and recipient ID from the URL
    const userId = req.user.id;
    const userid = userId.toString();
    const userPostId = postId.toString(); // Get the ID of the user sharing the post
    const driver = await connectGraphDB();
    const session = driver.session();
    // Find the question post
    const post = await userPost.findById(postId);
    if (!post) {
      return next(new ErrorHandler("Post not found", 404));
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

    await session.run(
      `
      MATCH (u:Person{mongoId:$userid}),(p:Post{mongoId:$userPostId})
      CREATE (u)-[:SHARED]->(p)
      `,
      {userid,userPostId}
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
    const sharedPosts = await userPost
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
