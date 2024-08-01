const express = require("express");
const router = express.Router();
const { isAuthenticatedUser } = require("../middlewares/auth");
const {
  createPost,
  getPost,
  updatePost,
  deletePost,
  getPostComments,
  postComment,
  deleteComment,
  updateComment,
  likePost,
  dislikePost,
  likeComment,
  dislikeComment,
  replyComment,
  deleteReply,
  updateReply,
  getReplies,
  likeReply,
  dislikeReply,
  sharePost,
  getSharedPosts,
} = require("../controller/postController");

router.route("/post/get").get(getPost);
router.route("/admin/posts").post(isAuthenticatedUser, createPost);
router
  .route("/admin/post/:id")
  .put(isAuthenticatedUser, updatePost)
  .delete(isAuthenticatedUser, deletePost);
router
  .route("/share-userpost/:postId/:recipientId")
  .post(isAuthenticatedUser, sharePost);

router.route("/shared-userposts").get(isAuthenticatedUser, getSharedPosts);
router.route("/admin/post/:postId/like").put(isAuthenticatedUser, likePost);
router
  .route("/admin/post/:postId/dislike")
  .put(isAuthenticatedUser, dislikePost);
// Route for retrieving comments for a specific  post
router
  .route("/admin/post/:postId/comments")
  .get(getPostComments)
  .post(isAuthenticatedUser, postComment);

router
  .route("/admin/post/:postId/comment/:commentId")
  .delete(isAuthenticatedUser, deleteComment)
  .put(isAuthenticatedUser, updateComment);

router
  .route("/admin/post/:postId/comment/:commentId/like")
  .put(isAuthenticatedUser, likeComment);
router
  .route("/admin/post/:postId/comment/:commentId/dislike")
  .put(isAuthenticatedUser, dislikeComment);
router
  .route("/admin/post/:postId/comment/:commentId/replyComment")
  .put(isAuthenticatedUser, replyComment)
  .get(getReplies);
router
  .route("/admin/post/:postId/comment/:commentId/replyComment/:replyId")
  .delete(isAuthenticatedUser, deleteReply)
  .put(isAuthenticatedUser, updateReply);
router
  .route("/admin/post/:postId/comment/:commentId/reply/:replyId/like")
  .put(isAuthenticatedUser, likeReply);

router
  .route("/admin/post/:postId/comment/:commentId/reply/:replyId/dislike")
  .put(isAuthenticatedUser, dislikeReply);

module.exports = router;
