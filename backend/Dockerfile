FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Clean install dependencies with the correct uuid version
RUN rm -rf node_modules package-lock.json && \
    npm install --only=production

# Copy application code
COPY . .

# Expose backend port
EXPOSE 5629

# Start the server
CMD ["node", "server.js"]
