module.exports = {
  apps: [
    {
      name: process.env.PM2_PROCESS_NAME || "xinyu-h5",
      cwd: __dirname,
      script: "server/server.mjs",
      interpreter: "node",
      node_args: "--env-file-if-exists=.env.production",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      time: true
    }
  ]
};
