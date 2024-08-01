const express = require("express");
const router = express.Router();

const {
  registerUser,
  loginUser,
  logout,
  forgotPassword,
  resetPassword,
  getUserProfile,
  updatePassword,
  updateProfile,
  allUsers,
  getUserDetails,
  updateUser,
  deleteUser,
  searchUser,
  followUser,
  unfollowUser,
  getRecommendation,
} = require("../controller/authController");
const { isAuthenticatedUser, authorizeRoles } = require("../middlewares/auth");
router.route("/register").post(registerUser);
router.route("/login").post(loginUser);
router.route("/password/forgot").post(forgotPassword);
router.route("/password/reset/:token").put(resetPassword);
router.route("/logout").get(logout);

router.route("/me").get(isAuthenticatedUser, getUserProfile);
router.route("/password/update").put(isAuthenticatedUser, updatePassword);
router.route("/searchUser").get(isAuthenticatedUser, searchUser);
router.route("/me/update").put(isAuthenticatedUser, updateProfile);
// Follow a user
router.route("/follow/:id").post(isAuthenticatedUser, followUser);

// Unfollow a user
router.route("/unfollow/:id").post(isAuthenticatedUser, unfollowUser);
router
  .route("/admin/users")
  .get(isAuthenticatedUser, authorizeRoles("admin"), allUsers);

router
  .route("/admin/user/:id")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getUserDetails)
  .put(isAuthenticatedUser, authorizeRoles("admin"), updateUser)
  .delete(isAuthenticatedUser, authorizeRoles("admin"), deleteUser);

router.route("/getRecommendations").get(isAuthenticatedUser,getRecommendation);

module.exports = router;
