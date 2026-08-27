module.exports = {
  testEnvironment: "node",
  collectCoverageFrom: [
    "session/**/*.js",
    "communication/**/*.js",
    "interviewer/**/*.js",
    "question-engine/**/*.js",
    "evaluation/**/*.js",
    "reporting/**/*.js",
    "coding/**/*.js",
    "proctoring/**/*.js",
    "face-tracking/**/*.js",
    "jd-resume/**/*.js",
    "admin/**/*.js",
    "readiness/**/*.js",
    "!**/node_modules/**",
  ],
  testTimeout: 10000,
};
