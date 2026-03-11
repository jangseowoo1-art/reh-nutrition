module.exports = {
  apps: [
    {
      name: 'hospital-meal',
      script: '/home/user/webapp/run-server.sh',
      cwd: '/home/user/webapp',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      interpreter: 'bash'
    }
  ]
}
