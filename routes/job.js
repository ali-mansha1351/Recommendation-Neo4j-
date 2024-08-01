const express = require("express");
const router = express.Router();
const { isAuthenticatedUser, authorizeRoles } = require("../middlewares/auth");
const {
  getJobs,
  newJobs,
  getSingleJob,
  updateJob,
  deleteJob,
  getPostComments,
  jobComment,
  deleteComment,
  updateComment,
  likejob,
  dislikejob,
  likeComment,
  dislikeComment,
  replyComment,
  deleteReply,
  updateReply,
  getReplies,
  likeReply,
  dislikeReply,
  getUserLikesAndComments,
  sharePost,
  getSharedPosts,
} = require("../controller/jobController");

//gettign all the jobs
router.route("/job").get(isAuthenticatedUser, getJobs);

router.route("/job/new").post(isAuthenticatedUser, newJobs);

router.route("/job/:id").get(getSingleJob);

router
  .route("/job/:id")
  .put(isAuthenticatedUser, updateJob)
  .delete(isAuthenticatedUser, deleteJob);
//sharing
router
  .route("/share-jobpost/:postId/:recipientId")
  .post(isAuthenticatedUser, sharePost);
//get shared post
router.route("/shared-jobposts").get(isAuthenticatedUser, getSharedPosts);

router.route("/job/:jobId/like").put(isAuthenticatedUser, likejob);
router.route("/job/:jobId/dislike").put(isAuthenticatedUser, dislikejob);
// Route for retrieving comments for a specific  post
router
  .route("/job/:jobId/comments")
  .get(getPostComments)
  .post(isAuthenticatedUser, jobComment);

router
  .route("/job/:jobId/comment/:commentId")
  .delete(isAuthenticatedUser, deleteComment)
  .put(isAuthenticatedUser, updateComment);

router
  .route("/job/:jobId/comment/:commentId/like")
  .put(isAuthenticatedUser, likeComment);
router
  .route("/job/:jobId/comment/:commentId/dislike")
  .put(isAuthenticatedUser, dislikeComment);
router
  .route("/job/:jobId/comment/:commentId/replyComment")
  .put(isAuthenticatedUser, replyComment)
  .get(getReplies);
router
  .route("/job/:jobId/comment/:commentId/replyComment/:replyId")
  .delete(isAuthenticatedUser, deleteReply)
  .put(isAuthenticatedUser, updateReply);
router
  .route("/job/:jobId/comment/:commentId/reply/:replyId/like")
  .put(isAuthenticatedUser, likeReply);

router
  .route("/job/:jobId/comment/:commentId/reply/:replyId/dislike")
  .put(isAuthenticatedUser, dislikeReply);

router.route("/job/activity").get(isAuthenticatedUser, getUserLikesAndComments);

module.exports = router;
