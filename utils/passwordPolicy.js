const PASSWORD_POLICY_MESSAGE =
  "Password must be at least 8 characters and include uppercase, lowercase, and a number";

const isStrongPassword = (password) =>
  typeof password === "string" && /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password);

const getPasswordChangedAt = () => new Date(Math.floor(Date.now() / 1000) * 1000);

const isTokenIssuedBeforePasswordChange = (issuedAt, passwordChangedAt) =>
  Number.isFinite(issuedAt) &&
  passwordChangedAt instanceof Date &&
  issuedAt < Math.floor(passwordChangedAt.getTime() / 1000);

module.exports = {
  PASSWORD_POLICY_MESSAGE,
  isStrongPassword,
  getPasswordChangedAt,
  isTokenIssuedBeforePasswordChange,
};
