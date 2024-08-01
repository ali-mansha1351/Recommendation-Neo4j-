const express = require("express");
const router = express.Router();

const {
  questionPost,
  likePost,
  dislikePost,
  getQuestions,
  updateQuestion,
  deleteQuestion,
  searchQuestion,
  questionComments, // Importing the questionComments controller function
  postComment, // Importing the postComment controller function
  deleteComment,
  updateComment,
  likeComment,
  dislikeComment,
  replyComment,
  deleteReply,
  updateReply,
  getReplies,
  likeReply,
  dislikeReply,
  getTopContributors,
  sharePost,
  getSharedPosts,
} = require("../controller/questionController");
const { isAuthenticatedUser } = require("../middlewares/auth");
router.route("/question/get").get(getQuestions);
router.route("/searchQuestion").get(isAuthenticatedUser, searchQuestion);
router
  .route("/top-contributors/:field")
  .get(isAuthenticatedUser, getTopContributors);

router
  .route("/share-post/:postId/:recipientId")
  .post(isAuthenticatedUser, sharePost);

router.route("/shared-posts").get(isAuthenticatedUser, getSharedPosts);

router.route("/admin/question/posts").post(isAuthenticatedUser, questionPost);
router
  .route("/admin/question/:id")
  .put(isAuthenticatedUser, updateQuestion)
  .delete(isAuthenticatedUser, deleteQuestion);

router.route("/admin/question/:postId/like").put(isAuthenticatedUser, likePost);
router
  .route("/admin/question/:postId/dislike")
  .put(isAuthenticatedUser, dislikePost);
// Route for retrieving comments for a specific question post
router
  .route("/admin/question/:postId/comments")  
  .get(questionComments)
  .post(isAuthenticatedUser, postComment);

router
  .route("/admin/question/:postId/comment/:commentId")
  .delete(isAuthenticatedUser, deleteComment)
  .put(isAuthenticatedUser, updateComment);

router
  .route("/admin/question/:postId/comment/:commentId/like")
  .put(isAuthenticatedUser, likeComment);
router
  .route("/admin/question/:postId/comment/:commentId/dislike")
  .put(isAuthenticatedUser, dislikeComment);
router
  .route("/admin/question/:postId/comment/:commentId/replyComment")
  .put(isAuthenticatedUser, replyComment)
  .get(getReplies);
router
  .route("/admin/question/:postId/comment/:commentId/replyComment/:replyId")
  .delete(isAuthenticatedUser, deleteReply)
  .put(isAuthenticatedUser, updateReply);
router
  .route("/admin/question/:postId/comment/:commentId/reply/:replyId/like")
  .put(isAuthenticatedUser, likeReply);

router
  .route("/admin/question/:postId/comment/:commentId/reply/:replyId/dislike")
  .put(isAuthenticatedUser, dislikeReply);

module.exports = router;
