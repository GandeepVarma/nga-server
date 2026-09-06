const asyncHandler = require("express-async-handler");
const Notification = require("../models/Notification");

// @desc    Get the logged-in student's notifications
// @route   GET /api/notifications
// @access  Student
const getMyNotifications = asyncHandler(async (req, res) => {
  const notifications = await Notification.find({ student: req.user._id }).sort({
    createdAt: -1,
  });
  const unreadCount = notifications.filter((n) => !n.isRead).length;
  res.json({ success: true, unreadCount, data: notifications });
});

// @desc    Mark a notification as read
// @route   PUT /api/notifications/:id/read
// @access  Student
const markAsRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOne({
    _id: req.params.id,
    student: req.user._id,
  });
  if (!notification) {
    res.status(404);
    throw new Error("Notification not found");
  }
  notification.isRead = true;
  await notification.save();
  res.json({ success: true, data: notification });
});

module.exports = { getMyNotifications, markAsRead };
